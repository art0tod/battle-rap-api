BEGIN;

-- Нормализованные критерии (веса/границы/позиция)
CREATE TABLE IF NOT EXISTS round_rubric_criterion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES round(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  weight NUMERIC(5,2) NOT NULL CHECK (weight > 0),
  min_value NUMERIC(6,2) NOT NULL DEFAULT 0,
  max_value NUMERIC(6,2) NOT NULL DEFAULT 100,
  position INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_round_rubric_criterion_key UNIQUE (round_id, key),
  CONSTRAINT chk_round_rubric_bounds CHECK (max_value >= min_value)
);
CREATE INDEX IF NOT EXISTS idx_round_rubric_criterion_round
  ON round_rubric_criterion(round_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rrc_round_pos
  ON round_rubric_criterion(round_id, position) WHERE position IS NOT NULL;

-- Бэкфилл из старых ключей (если были)
INSERT INTO round_rubric_criterion (round_id, key, name, weight, min_value, max_value)
SELECT r.id, lower(k), initcap(regexp_replace(k, '_',' ','g')), 1.0, 0, 100
FROM round r
CROSS JOIN LATERAL unnest(COALESCE(r.rubric_keys,'{}')) t(k)
ON CONFLICT (round_id, key) DO NOTHING;

-- Сабмит только с audio:ready
CREATE OR REPLACE FUNCTION check_submission_audio_ready()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_kind media_kind; v_status text;
BEGIN
  SELECT kind, status INTO v_kind, v_status FROM media_asset WHERE id = NEW.audio_id;
  IF v_kind IS DISTINCT FROM 'audio'::media_kind THEN
    RAISE EXCEPTION 'submission.audio_id must reference audio media';
  END IF;
  IF v_status <> 'ready' THEN
    RAISE EXCEPTION 'audio media must be ready before submission';
  END IF;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_submission_media_ready ON submission;
CREATE TRIGGER trg_submission_media_ready
BEFORE INSERT OR UPDATE OF audio_id ON submission
FOR EACH ROW EXECUTE FUNCTION check_submission_audio_ready();

-- Окна сабмита
CREATE OR REPLACE FUNCTION guard_submission_window()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text; v_deadline timestamptz;
BEGIN
  SELECT status, submission_deadline_at INTO v_status, v_deadline
  FROM round WHERE id = NEW.round_id;
  IF v_status <> 'submission' THEN
    RAISE EXCEPTION 'round is not accepting submissions';
  END IF;
  IF v_deadline IS NOT NULL AND now() > v_deadline THEN
    RAISE EXCEPTION 'submission deadline passed';
  END IF;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_submission_window ON submission;
CREATE TRIGGER trg_submission_window
BEFORE INSERT OR UPDATE OF status ON submission
FOR EACH ROW
WHEN (NEW.status IN ('submitted','approved','published'))
EXECUTE FUNCTION guard_submission_window();

-- Окна судейства + назначение судьи
CREATE OR REPLACE FUNCTION guard_evaluation_window()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text; v_deadline timestamptz; v_match uuid;
BEGIN
  SELECT status, judging_deadline_at INTO v_status, v_deadline
  FROM round WHERE id = NEW.round_id;
  IF v_status <> 'judging' THEN
    RAISE EXCEPTION 'round is not in judging state';
  END IF;
  IF v_deadline IS NOT NULL AND now() > v_deadline THEN
    RAISE EXCEPTION 'judging deadline passed';
  END IF;
  IF NEW.target_type = 'match' THEN
    v_match := NEW.target_id;
    IF NOT EXISTS (SELECT 1 FROM judge_assignment
                   WHERE judge_id = NEW.judge_id AND match_id = v_match) THEN
      RAISE EXCEPTION 'judge is not assigned to this match';
    END IF;
  END IF;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_eval_window ON evaluation;
CREATE TRIGGER trg_eval_window
BEFORE INSERT OR UPDATE OF pass,score,rubric,total_score ON evaluation
FOR EACH ROW EXECUTE FUNCTION guard_evaluation_window();

-- Подсчет total_score (rubric/points)
CREATE OR REPLACE FUNCTION calc_rubric_total(p_round uuid, p_rubric jsonb)
RETURNS smallint LANGUAGE plpgsql AS $$
DECLARE r record; v_sum numeric := 0; v_wsum numeric := 0;
        v_val numeric; v_norm numeric;
BEGIN
  IF p_rubric IS NULL THEN RETURN NULL; END IF;
  FOR r IN SELECT key, weight, min_value, max_value FROM round_rubric_criterion WHERE round_id = p_round
  LOOP
    IF NOT p_rubric ? r.key THEN
      RAISE EXCEPTION 'rubric missing key %', r.key;
    END IF;
    v_val := (p_rubric ->> r.key)::numeric;
    IF v_val < r.min_value OR v_val > r.max_value THEN
      RAISE EXCEPTION 'rubric value % out of bounds for key % (%,%)',
        v_val, r.key, r.min_value, r.max_value;
    END IF;
    v_norm := CASE WHEN r.max_value = r.min_value THEN 0
                   ELSE (v_val - r.min_value) * 100.0 / (r.max_value - r.min_value) END;
    v_sum  := v_sum  + v_norm * r.weight;
    v_wsum := v_wsum + r.weight;
  END LOOP;
  IF v_wsum = 0 THEN RETURN 0; END IF;
  RETURN LEAST(100, GREATEST(0, ROUND((v_sum / v_wsum)::numeric)))::smallint;
END$$;

CREATE OR REPLACE FUNCTION evaluation_auto_total()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_scoring scoring_mode;
BEGIN
  SELECT scoring INTO v_scoring FROM round WHERE id = NEW.round_id;
  IF v_scoring = 'rubric' THEN
    NEW.total_score := calc_rubric_total(NEW.round_id, NEW.rubric);
  ELSIF v_scoring = 'points' THEN
    IF NEW.score IS NULL THEN RAISE EXCEPTION 'score required for points mode'; END IF;
    IF NEW.score < 0 OR NEW.score > 100 THEN RAISE EXCEPTION 'score must be 0..100'; END IF;
    NEW.total_score := NEW.score;
  ELSE
    NEW.total_score := NULL; -- pass_fail
  END IF;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_eval_autototal ON evaluation;
CREATE TRIGGER trg_eval_autototal
BEFORE INSERT OR UPDATE OF rubric,score ON evaluation
FOR EACH ROW EXECUTE FUNCTION evaluation_auto_total();

-- Консистентность: участник ↔ тот же турнир
CREATE OR REPLACE FUNCTION guard_participant_round_consistency()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_round_tourn uuid; v_part_tourn uuid;
BEGIN
  SELECT r.tournament_id INTO v_round_tourn FROM round r WHERE r.id = NEW.round_id;
  SELECT tp.tournament_id INTO v_part_tourn FROM tournament_participant tp WHERE tp.id = NEW.participant_id;
  IF v_round_tourn IS DISTINCT FROM v_part_tourn THEN
    RAISE EXCEPTION 'participant must belong to the same tournament as round';
  END IF;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_submission_consistency ON submission;
CREATE TRIGGER trg_submission_consistency
BEFORE INSERT OR UPDATE OF round_id, participant_id ON submission
FOR EACH ROW EXECUTE FUNCTION guard_participant_round_consistency();

CREATE OR REPLACE FUNCTION guard_match_participant_consistency()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_round_tourn uuid; v_part_tourn uuid;
BEGIN
  SELECT r.tournament_id INTO v_round_tourn
  FROM match m JOIN round r ON r.id = m.round_id
  WHERE m.id = NEW.match_id;
  SELECT tournament_id INTO v_part_tourn FROM tournament_participant WHERE id = NEW.participant_id;
  IF v_round_tourn IS DISTINCT FROM v_part_tourn THEN
    RAISE EXCEPTION 'match participant belongs to a different tournament';
  END IF;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_match_participant_consistency ON match_participant;
CREATE TRIGGER trg_match_participant_consistency
BEFORE INSERT OR UPDATE OF participant_id ON match_participant
FOR EACH ROW EXECUTE FUNCTION guard_match_participant_consistency();

-- Публикация сабмита = выставить published_at и требовать ready-медиа
CREATE OR REPLACE FUNCTION guard_publish_submission()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'published' AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;
  IF NEW.status = 'published' AND NEW.submitted_at IS NULL THEN
    NEW.submitted_at := now();
  END IF;
  PERFORM 1 FROM media_asset ma WHERE ma.id = NEW.audio_id AND ma.status='ready';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cannot publish submission: media not ready';
  END IF;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_publish_submission ON submission;
CREATE TRIGGER trg_publish_submission
BEFORE UPDATE OF status ON submission
FOR EACH ROW
WHEN (NEW.status = 'published')
EXECUTE FUNCTION guard_publish_submission();

COMMIT;
