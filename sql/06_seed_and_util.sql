BEGIN;

-- Сид админа (если не создан в 04)
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

-- Утилита: безопасная публикация сабмита (для ручной модерации)
CREATE OR REPLACE FUNCTION publish_submission(_moderator UUID, _submission UUID)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ready BOOLEAN;
BEGIN
  SELECT TRUE FROM submission s
  JOIN media_asset ma ON ma.id = s.audio_id
  WHERE s.id=_submission AND ma.status='ready' INTO v_ready;

  IF NOT COALESCE(v_ready,FALSE) THEN
    RAISE EXCEPTION 'media not ready';
  END IF;

  UPDATE submission
    SET status='published',
        submitted_at = COALESCE(submitted_at, now()),
        published_at = now(),
        updated_at = now()
  WHERE id = _submission;

  INSERT INTO audit_log(actor_user_id, action, target_table, target_id, payload)
  VALUES (_moderator, 'submission.publish', 'submission', _submission, '{}'::jsonb);
END$$;

COMMIT;
