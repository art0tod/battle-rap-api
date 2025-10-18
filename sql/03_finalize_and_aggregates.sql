BEGIN;

-- Стратегия судейства
CREATE OR REPLACE FUNCTION get_round_strategy(p_match_id uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT r.strategy FROM match m JOIN round r ON r.id = m.round_id WHERE m.id = p_match_id
$$;

-- Финализация матча
CREATE OR REPLACE FUNCTION finalize_match(p_match_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_strategy text; v_winner uuid; v_tie boolean := false;
BEGIN
  SELECT get_round_strategy(p_match_id) INTO v_strategy;

  IF v_strategy = 'weighted' THEN
    WITH s AS (
      SELECT mt.id AS match_track_id,
             AVG(e.total_score)::numeric(10,4) AS avg_score
      FROM match_track mt
      LEFT JOIN evaluation e
        ON e.target_type='match' AND e.target_id = p_match_id
       AND e.round_id = (SELECT round_id FROM match WHERE id = p_match_id)
      WHERE mt.match_id = p_match_id
      GROUP BY mt.id
    ),
    ranked AS (
      SELECT *, RANK() OVER (ORDER BY avg_score DESC NULLS LAST) rnk FROM s
    )
    SELECT CASE WHEN COUNT(*) FILTER (WHERE rnk=1) > 1 THEN NULL
                ELSE MAX(match_track_id) FILTER (WHERE rnk=1) END,
           (COUNT(*) FILTER (WHERE rnk=1) > 1)
    INTO v_winner, v_tie
    FROM ranked;
  ELSE
    WITH per_judge AS (
      SELECT e.judge_id,
             (ARRAY_AGG(mt.id ORDER BY COALESCE(e.total_score,-1) DESC))[1] AS winner_track
      FROM match_track mt
      LEFT JOIN evaluation e
        ON e.target_type='match' AND e.target_id = p_match_id
       AND e.round_id = (SELECT round_id FROM match WHERE id = p_match_id)
      WHERE mt.match_id = p_match_id
      GROUP BY e.judge_id
    ),
    tally AS (
      SELECT winner_track AS match_track_id, COUNT(*) AS votes
      FROM per_judge WHERE winner_track IS NOT NULL
      GROUP BY winner_track
    ),
    ranked AS (SELECT *, RANK() OVER (ORDER BY votes DESC) rnk FROM tally)
    SELECT CASE WHEN COUNT(*) FILTER (WHERE rnk=1) > 1 THEN NULL
                ELSE MAX(match_track_id) FILTER (WHERE rnk=1) END,
           (COUNT(*) FILTER (WHERE rnk=1) > 1)
    INTO v_winner, v_tie
    FROM ranked;
  END IF;

  UPDATE match
     SET winner_match_track_id = v_winner,
         status = CASE WHEN v_tie OR v_winner IS NULL THEN 'tie' ELSE 'finished' END,
         ends_at = COALESCE(ends_at, now())
   WHERE id = p_match_id;
END$$;

-- Матвью: средние по трекам
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_match_track_scores AS
SELECT
  mt.id AS match_track_id,
  mt.match_id,
  AVG(e.total_score)::numeric(6,2) AS avg_total
FROM match_track mt
LEFT JOIN evaluation e
  ON e.target_type='match' AND e.target_id = mt.match_id
GROUP BY mt.id, mt.match_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_match_track_scores ON mv_match_track_scores(match_track_id);

-- Матвью: лидерборд побед
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_tournament_leaderboard AS
WITH winners AS (
  SELECT m.winner_match_track_id AS match_track_id
  FROM match m
  WHERE m.winner_match_track_id IS NOT NULL
), track_part AS (
  SELECT mt.id AS match_track_id, mp.participant_id, r.tournament_id
  FROM match_track mt
  JOIN match m ON m.id = mt.match_id
  JOIN round r ON r.id = m.round_id
  JOIN match_participant mp ON mp.match_id = m.id AND mp.participant_id = mt.participant_id
)
SELECT
  tp.tournament_id,
  tp.participant_id,
  COUNT(w.match_track_id) AS wins
FROM track_part tp
LEFT JOIN winners w ON w.match_track_id = tp.match_track_id
GROUP BY tp.tournament_id, tp.participant_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_tl ON mv_tournament_leaderboard(tournament_id, participant_id);

-- Утилита для рефреша
CREATE OR REPLACE FUNCTION refresh_public_views()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW mv_match_track_scores;
  REFRESH MATERIALIZED VIEW mv_tournament_leaderboard;
END$$;

COMMIT;
