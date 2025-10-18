BEGIN;

-- Запретить прямой DML на роли всем, кроме владельца (обычно owner = миграционный пользователь)
REVOKE INSERT, UPDATE, DELETE ON app_user_role FROM PUBLIC;
GRANT SELECT ON app_user_role TO PUBLIC;

-- Аудит-лог
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  action TEXT NOT NULL,           -- e.g. 'role.grant', 'role.revoke', 'application.approve'
  target_table TEXT NOT NULL,
  target_id UUID,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_table ON audit_log(target_table);

-- Безопасная функция изменения ролей: админ — любые, модератор — только artist/judge/listener
CREATE OR REPLACE FUNCTION set_user_role(
  _actor_user_id UUID,
  _target_user_id UUID,
  _role user_role,
  _op TEXT  -- 'grant' | 'revoke'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_is_actor_admin boolean;
        v_is_actor_moderator boolean;
        v_target_is_admin boolean;
        v_target_is_moderator boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM app_user_role WHERE user_id=_actor_user_id AND role='admin') INTO v_is_actor_admin;
  SELECT EXISTS (SELECT 1 FROM app_user_role WHERE user_id=_actor_user_id AND role='moderator') INTO v_is_actor_moderator;

  IF NOT (v_is_actor_admin OR v_is_actor_moderator) THEN
    RAISE EXCEPTION 'only admin or moderator may change roles';
  END IF;

  SELECT EXISTS (SELECT 1 FROM app_user_role WHERE user_id=_target_user_id AND role='admin') INTO v_target_is_admin;
  SELECT EXISTS (SELECT 1 FROM app_user_role WHERE user_id=_target_user_id AND role='moderator') INTO v_target_is_moderator;

  -- модератор не может трогать админа/модератора, и не может выдавать/снимать admin/moderator
  IF v_is_actor_moderator AND NOT v_is_actor_admin THEN
    IF v_target_is_admin OR v_target_is_moderator THEN
      RAISE EXCEPTION 'moderator cannot change roles of admin/moderator';
    END IF;
    IF _role IN ('admin','moderator') THEN
      RAISE EXCEPTION 'moderator cannot grant/revoke admin or moderator';
    END IF;
  END IF;

  IF _op = 'grant' THEN
    IF _role = 'admin' AND NOT v_is_actor_admin THEN
      RAISE EXCEPTION 'only admin may grant admin';
    END IF;
    INSERT INTO app_user_role(user_id, role) VALUES (_target_user_id, _role)
    ON CONFLICT DO NOTHING;

    INSERT INTO audit_log(actor_user_id, action, target_table, target_id, payload)
    VALUES (_actor_user_id, 'role.grant', 'app_user', _target_user_id, jsonb_build_object('role', _role::text));
  ELSIF _op = 'revoke' THEN
    IF _role = 'admin' THEN
      RAISE EXCEPTION 'admin role cannot be revoked via API';
    END IF;
    DELETE FROM app_user_role WHERE user_id=_target_user_id AND role=_role;

    INSERT INTO audit_log(actor_user_id, action, target_table, target_id, payload)
    VALUES (_actor_user_id, 'role.revoke', 'app_user', _target_user_id, jsonb_build_object('role', _role::text));
  ELSE
    RAISE EXCEPTION 'unknown op %, expected grant|revoke', _op;
  END IF;
END$$;

COMMIT;

-- Сид первого админа, если ещё нет
DO $$
DECLARE v_admin_exists boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM app_user_role WHERE role='admin') INTO v_admin_exists;
  IF NOT v_admin_exists THEN
    INSERT INTO app_user (email, password_hash, display_name)
    VALUES ('admin@example.com', '$2b$12$REPLACE_WITH_BCRYPT', 'Admin')
    ON CONFLICT DO NOTHING;

    INSERT INTO app_user_role(user_id, role)
    SELECT id, 'admin'::user_role FROM app_user WHERE email_norm='admin@example.com'
    ON CONFLICT DO NOTHING;

    INSERT INTO audit_log(actor_user_id, action, target_table, target_id, payload)
    SELECT id, 'role.grant', 'app_user', id, jsonb_build_object('role','admin')
    FROM app_user WHERE email_norm='admin@example.com';
  END IF;
END$$;

