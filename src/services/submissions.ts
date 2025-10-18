import { randomUUID } from 'node:crypto';
import { pool, tx } from '../db/pool.js';
import { AppError, mapDbError } from '../lib/errors.js';

export type SubmissionInput = {
  roundId: string;
  participantId: string;
  audioId: string;
  lyrics?: string;
};

export const createOrUpdateSubmission = async (input: SubmissionInput, actorId: string) => {
  return tx(async (client) => {
    try {
      const { rows } = await client.query(
        `INSERT INTO submission(id, round_id, participant_id, audio_id, lyrics, status, submitted_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'draft',NULL, now())
         ON CONFLICT (round_id, participant_id) DO UPDATE
           SET audio_id = EXCLUDED.audio_id,
               lyrics = EXCLUDED.lyrics,
               updated_at = now()
         RETURNING id, status`,
        [randomUUID(), input.roundId, input.participantId, input.audioId, input.lyrics ?? null]
      );
      return rows[0];
    } catch (err) {
      throw mapDbError(err);
    }
  });
};

export const submitSubmission = async (submissionId: string, actorId: string) => {
  try {
    const { rowCount, rows } = await pool.query(
      `UPDATE submission
       SET status='submitted',
           submitted_at = COALESCE(submitted_at, now()),
           updated_at = now()
       WHERE id = $1
       RETURNING id, status`,
      [submissionId]
    );
    if (rowCount === 0) {
      throw new AppError({ status: 404, code: 'submission_not_found', message: 'Submission not found.' });
    }
    return rows[0];
  } catch (err) {
    throw mapDbError(err);
  }
};

export const publishSubmission = async (moderatorId: string, submissionId: string) => {
  try {
    await pool.query('SELECT publish_submission($1,$2)', [moderatorId, submissionId]);
  } catch (err) {
    throw mapDbError(err);
  }
};

export const findParticipantForRound = async (userId: string, roundId: string) => {
  const { rows } = await pool.query(
    `SELECT tp.id
     FROM tournament_participant tp
     JOIN round r ON r.tournament_id = tp.tournament_id
     WHERE tp.user_id = $1 AND r.id = $2
     LIMIT 1`,
    [userId, roundId]
  );
  return rows[0]?.id ?? null;
};

export const getSubmissionById = async (submissionId: string) => {
  const { rows } = await pool.query(
    `SELECT s.*, tp.user_id
     FROM submission s
     JOIN tournament_participant tp ON tp.id = s.participant_id
     WHERE s.id = $1`,
    [submissionId]
  );
  return rows[0] ?? null;
};
