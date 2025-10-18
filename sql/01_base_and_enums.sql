BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ===== ENUM TYPES =====
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('admin','moderator','judge','artist','listener');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'oauth_provider') THEN
    CREATE TYPE oauth_provider AS ENUM ('vk');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'media_kind') THEN
    CREATE TYPE media_kind AS ENUM ('audio','image');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'round_kind') THEN
    CREATE TYPE round_kind AS ENUM ('qualifier1','qualifier2','bracket');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'scoring_mode') THEN
    CREATE TYPE scoring_mode AS ENUM ('pass_fail','points','rubric');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'submission_status') THEN
    CREATE TYPE submission_status AS ENUM ('draft','submitted','approved','locked','disqualified','published');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'judge_target') THEN
    CREATE TYPE judge_target AS ENUM ('submission','match');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'judge_assignment_status') THEN
    CREATE TYPE judge_assignment_status AS ENUM ('assigned','completed','skipped');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'comment_status') THEN
    CREATE TYPE comment_status AS ENUM ('active','hidden');
  END IF;
END$$;

-- ===== USERS & ROLES =====
CREATE TABLE IF NOT EXISTS app_user (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  email_norm    TEXT GENERATED ALWAYS AS (lower(email)) STORED,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_email UNIQUE (email_norm)
);

CREATE TABLE IF NOT EXISTS app_user_role (
  user_id UUID REFERENCES app_user(id) ON DELETE CASCADE,
  role    user_role NOT NULL,
  PRIMARY KEY (user_id, role)
);

-- РОВНО один admin на всю систему
CREATE UNIQUE INDEX IF NOT EXISTS uq_single_admin
  ON app_user_role(role) WHERE role = 'admin';

CREATE TABLE IF NOT EXISTS external_identity (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  provider     oauth_provider NOT NULL,
  external_uid TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_provider_uid UNIQUE (provider, external_uid)
);

-- ===== ARTIST PROFILE =====
CREATE TABLE IF NOT EXISTS artist_profile (
  user_id    UUID PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  avatar_key TEXT,
  bio        TEXT,
  socials    JSONB DEFAULT '{}'::jsonb,
  -- поля из анкеты, чтобы их можно было хранить в профиле
  city       TEXT,
  age        SMALLINT CHECK (age IS NULL OR age BETWEEN 12 AND 120),
  vk_id      TEXT,
  full_name  TEXT
);

-- ===== MEDIA =====
CREATE TABLE IF NOT EXISTS media_asset (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          media_kind NOT NULL,
  storage_key   TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL CHECK (size_bytes > 0),
  duration_sec  NUMERIC(8,2),
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== TOURNAMENTS =====
CREATE TABLE IF NOT EXISTS tournament (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT NOT NULL,
  max_bracket_size INT CHECK (max_bracket_size IS NULL OR max_bracket_size > 0),
  status           TEXT NOT NULL DEFAULT 'draft',
  registration_open_at   TIMESTAMPTZ,
  submission_deadline_at TIMESTAMPTZ,
  judging_deadline_at    TIMESTAMPTZ,
  public_at              TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tournament_participant (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournament(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  UNIQUE (tournament_id, user_id)
);

CREATE TABLE IF NOT EXISTS tournament_judge (
  tournament_id UUID REFERENCES tournament(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES app_user(id) ON DELETE CASCADE,
  PRIMARY KEY (tournament_id, user_id)
);

-- ===== ROUNDS =====
CREATE TABLE IF NOT EXISTS round (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournament(id) ON DELETE CASCADE,
  kind          round_kind NOT NULL,
  number        INT NOT NULL,
  scoring       scoring_mode NOT NULL,
  rubric_keys   TEXT[] DEFAULT NULL,
  status        TEXT NOT NULL DEFAULT 'draft', -- draft|submission|judging|finished
  starts_at     TIMESTAMPTZ,
  submission_deadline_at TIMESTAMPTZ,
  judging_deadline_at    TIMESTAMPTZ,
  strategy      TEXT NOT NULL DEFAULT 'weighted', -- weighted|majority
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, kind, number)
);

-- ===== SUBMISSIONS (QUALS) =====
CREATE TABLE IF NOT EXISTS submission (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id       UUID NOT NULL REFERENCES round(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES tournament_participant(id) ON DELETE CASCADE,
  audio_id       UUID NOT NULL REFERENCES media_asset(id) ON DELETE RESTRICT,
  lyrics         TEXT,
  status         submission_status NOT NULL DEFAULT 'draft',
  submitted_at   TIMESTAMPTZ,
  locked_by_admin BOOLEAN NOT NULL DEFAULT false,
  rejected_reason TEXT,
  published_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (round_id, participant_id),
  CHECK ((submitted_at IS NULL) = (status='draft'))
);

-- ===== MATCHES =====
CREATE TABLE IF NOT EXISTS match (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id      UUID NOT NULL REFERENCES round(id) ON DELETE CASCADE,
  starts_at     TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'scheduled', -- scheduled|finished|tie|...
  ends_at       TIMESTAMPTZ,
  winner_match_track_id UUID
);

CREATE TABLE IF NOT EXISTS match_participant (
  match_id       UUID REFERENCES match(id) ON DELETE CASCADE,
  participant_id UUID REFERENCES tournament_participant(id) ON DELETE CASCADE,
  seed           INT,
  PRIMARY KEY (match_id, participant_id),
  UNIQUE (match_id, seed)
);

CREATE TABLE IF NOT EXISTS match_track (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id       UUID NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL,
  audio_id       UUID NOT NULL REFERENCES media_asset(id) ON DELETE RESTRICT,
  lyrics         TEXT,
  submitted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (match_id, participant_id),
  CONSTRAINT fk_match_track_participant
    FOREIGN KEY (match_id, participant_id)
    REFERENCES match_participant(match_id, participant_id)
    DEFERRABLE INITIALLY DEFERRED
);

DO $$
BEGIN
  ALTER TABLE match
    ADD CONSTRAINT fk_match_winner_track
    FOREIGN KEY (winner_match_track_id)
    REFERENCES match_track(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END$$;

-- ===== EVALUATIONS =====
CREATE TABLE IF NOT EXISTS evaluation (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  judge_id     UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  target_type  judge_target NOT NULL,
  target_id    UUID NOT NULL,
  round_id     UUID NOT NULL REFERENCES round(id) ON DELETE CASCADE,
  pass         BOOLEAN,
  score        SMALLINT,
  rubric       JSONB,
  total_score  SMALLINT,
  comment      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (judge_id, target_type, target_id),
  CHECK (score IS NULL OR (score BETWEEN 0 AND 100)),
  CHECK (rubric IS NULL OR jsonb_typeof(rubric) = 'object')
);

CREATE TABLE IF NOT EXISTS judge_assignment (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  judge_id   UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  match_id   UUID NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  status     judge_assignment_status NOT NULL DEFAULT 'assigned',
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (judge_id, match_id)
);

-- ===== LIKES & COMMENTS =====
CREATE TABLE IF NOT EXISTS track_like (
  user_id        UUID REFERENCES app_user(id) ON DELETE CASCADE,
  match_track_id UUID REFERENCES match_track(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, match_track_id)
);

CREATE TABLE IF NOT EXISTS comment (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  match_id       UUID NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  match_track_id UUID REFERENCES match_track(id) ON DELETE CASCADE,
  body           TEXT NOT NULL,
  status         comment_status NOT NULL DEFAULT 'active',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_comment_track
    FOREIGN KEY (match_track_id)
    REFERENCES match_track(id)
    DEFERRABLE INITIALLY DEFERRED
);

-- ===== INDEXES =====
CREATE INDEX IF NOT EXISTS idx_submission_round ON submission(round_id);
CREATE INDEX IF NOT EXISTS idx_match_round ON match(round_id);
CREATE INDEX IF NOT EXISTS idx_eval_round ON evaluation(round_id);
CREATE INDEX IF NOT EXISTS idx_eval_target ON evaluation(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_like_track ON track_like(match_track_id);
CREATE INDEX IF NOT EXISTS idx_comment_match ON comment(match_id);
CREATE INDEX IF NOT EXISTS idx_round_status ON round(status);
CREATE INDEX IF NOT EXISTS idx_round_deadlines ON round(judging_deadline_at, submission_deadline_at);
CREATE INDEX IF NOT EXISTS idx_tournament_status ON tournament(status);

COMMIT;
