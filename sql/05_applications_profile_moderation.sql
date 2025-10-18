BEGIN;

-- ===== PARTICIPATION APPLICATION (анкета) =====
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'application_status') THEN
    CREATE TYPE application_status AS ENUM ('draft','submitted','under_review','approved','rejected','withdrawn');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS participation_application (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  round_id UUID REFERENCES round(id) ON DELETE SET NULL,
  status application_status NOT NULL DEFAULT 'draft',
  city TEXT,
  age SMALLINT CHECK (age IS NULL OR age BETWEEN 12 AND 120),
  vk_id TEXT,
  full_name TEXT,
  beat_author TEXT,
  audio_id UUID REFERENCES media_asset(id) ON DELETE SET NULL,
  lyrics TEXT,
  moderator_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  reject_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_user ON participation_application(user_id);
CREATE INDEX IF NOT EXISTS idx_app_status ON participation_application(status);

-- ===== PROFILE CHANGE REQUEST =====
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'profile_change_status') THEN
    CREATE TYPE profile_change_status AS ENUM ('pending','approved','rejected');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS profile_change_request (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  changes JSONB NOT NULL, -- e.g. {"display_name":"...", "city":"...", "age":23, "vk_id":"...","bio":"...","socials":{...}}
  status profile_change_status NOT NULL DEFAULT 'pending',
  moderator_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  reject_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_changes_object CHECK (jsonb_typeof(changes) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_pcr_user ON profile_change_request(user_id);
CREATE INDEX IF NOT EXISTS idx_pcr_status ON profile_change_request(status);

-- ===== Audit helper =====
CREATE OR REPLACE FUNCTION write_audit(_actor UUID, _action TEXT, _table TEXT, _id UUID, _payload JSONB)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO audit_log(actor_user_id, action, target_table, target_id, payload)
  VALUES ($1,$2,$3,$4,$5)
$$;

-- ===== Helper: ensure artist role =====
CREATE OR REPLACE FUNCTION grant_role_if_absent(_user UUID, _role user_role)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO app_user_role(user_id, role) VALUES (_user, _role)
  ON CONFLICT DO NOTHING;
END$$;

-- ===== On APPROVE application: issue artist role, create participant, publish submission =====
CREATE OR REPLACE FUNCTION process_application_approval()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_tournament UUID; v_part UUID; v_audio_ready BOOLEAN;
BEGIN
  -- запишем аудит
  PERFORM write_audit(NEW.moderator_id, 'application.approve', 'participation_application', NEW.id,
                      jsonb_build_object('user_id',NEW.user_id,'round_id',NEW.round_id));

  -- роль artist
  PERFORM grant_role_if_absent(NEW.user_id, 'artist');

  -- Протолкнуть профильные поля (upsert в artist_profile)
  INSERT INTO artist_profile(user_id, city, age, vk_id, full_name)
  VALUES (NEW.user_id, NEW.city, NEW.age, NEW.vk_id, NEW.full_name)
  ON CONFLICT (user_id) DO UPDATE
  SET city = COALESCE(EXCLUDED.city, artist_profile.city),
      age  = COALESCE(EXCLUDED.age,  artist_profile.age),
      vk_id = COALESCE(EXCLUDED.vk_id, artist_profile.vk_id),
      full_name = COALESCE(EXCLUDED.full_name, artist_profile.full_name);

  -- Если round_id есть — создаём участника и сабмит
  IF NEW.round_id IS NOT NULL THEN
    SELECT tournament_id INTO v_tournament FROM round WHERE id = NEW.round_id;

    INSERT INTO tournament_participant(tournament_id, user_id)
    VALUES (v_tournament, NEW.user_id)
    ON CONFLICT (tournament_id, user_id) DO UPDATE SET tournament_id = EXCLUDED.tournament_id
    RETURNING id INTO v_part;

    -- проверим, что медиа ready (если указано)
    IF NEW.audio_id IS NOT NULL THEN
      SELECT TRUE FROM media_asset WHERE id = NEW.audio_id AND status='ready' LIMIT 1 INTO v_audio_ready;
      IF NOT COALESCE(v_audio_ready, FALSE) THEN
        RAISE EXCEPTION 'application audio must be ready';
      END IF;
    END IF;

    -- создаём или обновляем submission
    INSERT INTO submission(round_id, participant_id, audio_id, lyrics, status, submitted_at, published_at)
    VALUES (NEW.round_id, v_part, NEW.audio_id, NEW.lyrics, 'published', now(), now())
    ON CONFLICT (round_id, participant_id) DO UPDATE
      SET audio_id = COALESCE(EXCLUDED.audio_id, submission.audio_id),
          lyrics = COALESCE(EXCLUDED.lyrics, submission.lyrics),
          submitted_at = COALESCE(submission.submitted_at, now()),
          status = 'published',
          published_at = now(),
          updated_at = now();
  END IF;

  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_on_application_approve ON participation_application;
CREATE TRIGGER trg_on_application_approve
AFTER UPDATE OF status ON participation_application
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM 'approved' AND NEW.status = 'approved')
EXECUTE FUNCTION process_application_approval();

-- ===== On APPROVE profile change: apply JSON changes to app_user / artist_profile =====
CREATE OR REPLACE FUNCTION apply_profile_changes()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v JSONB := NEW.changes;
BEGIN
  -- Контролируем допустимые ключи
  -- app_user.display_name
  IF v ? 'display_name' THEN
    UPDATE app_user SET display_name = v->>'display_name', updated_at = now()
    WHERE id = NEW.user_id;
  END IF;

  -- artist_profile upsert
  INSERT INTO artist_profile(user_id) VALUES (NEW.user_id)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE artist_profile ap
  SET bio = COALESCE(v->>'bio', ap.bio),
      avatar_key = COALESCE(v->>'avatar_key', ap.avatar_key),
      city = COALESCE(v->>'city', ap.city),
      vk_id = COALESCE(v->>'vk_id', ap.vk_id),
      full_name = COALESCE(v->>'full_name', ap.full_name),
      age = COALESCE(NULLIF((v->>'age')::text, '')::smallint, ap.age),
      socials = COALESCE(NULLIF(v->'socials','null'), ap.socials)
  WHERE ap.user_id = NEW.user_id;

  PERFORM write_audit(NEW.moderator_id, 'profile.approve', 'profile_change_request', NEW.id, v);

  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_on_profile_change_approve ON profile_change_request;
CREATE TRIGGER trg_on_profile_change_approve
AFTER UPDATE OF status ON profile_change_request
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM 'approved' AND NEW.status = 'approved')
EXECUTE FUNCTION apply_profile_changes();

COMMIT;
