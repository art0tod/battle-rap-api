import { pool } from '../db/pool.js';
import { AppError, mapDbError } from '../lib/errors.js';

export type EvaluationPayload = {
  judgeId: string;
  matchId: string;
  roundId: string;
  pass?: boolean;
  score?: number;
  rubric?: Record<string, number>;
  comment?: string;
};

export const upsertEvaluation = async (payload: EvaluationPayload) => {
  try {
    await pool.query(
      `INSERT INTO evaluation(judge_id, target_type, target_id, round_id, pass, score, rubric, comment)
       VALUES ($1,'match',$2,$3,$4,$5,$6,$7)
       ON CONFLICT (judge_id, target_type, target_id)
       DO UPDATE SET pass=EXCLUDED.pass,
                     score=EXCLUDED.score,
                     rubric=EXCLUDED.rubric,
                     comment=EXCLUDED.comment`,
      [
        payload.judgeId,
        payload.matchId,
        payload.roundId,
        payload.pass ?? null,
        payload.score ?? null,
        payload.rubric ? JSON.stringify(payload.rubric) : null,
        payload.comment ?? null,
      ]
    );
  } catch (err) {
    throw mapDbError(err);
  }
};

export const finalizeMatch = async (matchId: string) => {
  try {
    await pool.query('SELECT finalize_match($1)', [matchId]);
  } catch (err) {
    throw mapDbError(err);
  }
};

export const refreshPublicViews = async () => {
  try {
    await pool.query('SELECT refresh_public_views()');
  } catch (err) {
    throw mapDbError(err);
  }
};

export const listJudgeAssignments = async (judgeId: string) => {
  const { rows } = await pool.query(
    `SELECT ja.id, ja.match_id, ja.status, ja.assigned_at,
            m.round_id, m.starts_at, m.status AS match_status
     FROM judge_assignment ja
     JOIN match m ON m.id = ja.match_id
     WHERE ja.judge_id = $1`,
    [judgeId]
  );
  return rows;
};

export const getMatchRound = async (matchId: string) => {
  const { rows } = await pool.query(
    `SELECT m.id, m.round_id
     FROM match m WHERE m.id = $1`,
    [matchId]
  );
  return rows[0] ?? null;
};
