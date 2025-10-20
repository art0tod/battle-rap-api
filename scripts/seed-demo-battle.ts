import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { tx, closePool } from '../src/db/pool.js';

type Role =
  | 'judge'
  | 'artist'
  | 'listener';

const DEMO_IDS = {
  tournament: 'c0ffee01-0000-4000-8000-000000000001',
  round: 'c0ffee01-0000-4000-8000-000000000002',
  judgeAssignment: 'c0ffee01-0000-4000-8000-000000000003',
  match: 'c0ffee01-0000-4000-8000-000000000004',
  trackA: 'c0ffee01-0000-4000-8000-000000000005',
  trackB: 'c0ffee01-0000-4000-8000-000000000006',
  mediaTrackA: 'c0ffee01-0000-4000-8000-000000000007',
  mediaTrackB: 'c0ffee01-0000-4000-8000-000000000008',
} as const;

const USERS = {
  judge: {
    email: 'judge.demo@example.com',
    displayName: 'Demo Judge',
    password: 'demo-judge-123',
    roles: ['judge'] as Role[],
  },
  artistA: {
    email: 'artist.alpha@example.com',
    displayName: 'MC Alpha',
    password: 'alpha-demo-123',
    roles: ['artist', 'listener'] as Role[],
  },
  artistB: {
    email: 'artist.beta@example.com',
    displayName: 'MC Beta',
    password: 'beta-demo-123',
    roles: ['artist', 'listener'] as Role[],
  },
} as const;

async function ensureUser(
  client: import('pg').PoolClient,
  adminId: string,
  user: (typeof USERS)[keyof typeof USERS]
) {
  const passwordHash = await bcrypt.hash(user.password, 10);
  await client.query(
    `INSERT INTO app_user (email, password_hash, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (email_norm)
       DO UPDATE SET password_hash = EXCLUDED.password_hash,
                     display_name = EXCLUDED.display_name`,
    [user.email, passwordHash, user.displayName]
  );

  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM app_user WHERE email_norm = lower($1) LIMIT 1`,
    [user.email]
  );
  if (!rows[0]) {
    throw new Error(`Failed to resolve user id for ${user.email}`);
  }
  const userId = rows[0].id;

  for (const role of user.roles) {
    await client.query(`SELECT set_user_role($1, $2, $3::user_role, 'grant')`, [adminId, userId, role]);
  }

  return userId;
}

async function ensureTournamentStructure(
  client: import('pg').PoolClient,
  judgeId: string,
  artistAId: string,
  artistBId: string
) {
  const now = new Date();
  const addDays = (days: number) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  await client.query(
    `INSERT INTO tournament (id, title, max_bracket_size, status, registration_open_at, submission_deadline_at, judging_deadline_at, public_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE
       SET title = EXCLUDED.title,
           max_bracket_size = EXCLUDED.max_bracket_size,
           status = EXCLUDED.status,
           registration_open_at = EXCLUDED.registration_open_at,
           submission_deadline_at = EXCLUDED.submission_deadline_at,
           judging_deadline_at = EXCLUDED.judging_deadline_at,
           public_at = EXCLUDED.public_at`,
    [
      DEMO_IDS.tournament,
      'Demo Clash Invitational',
      16,
      'ongoing',
      addDays(-10),
      addDays(-2),
      addDays(5),
      addDays(-3),
    ]
  );

  await client.query(
    `INSERT INTO round (id, tournament_id, kind, number, scoring, status, starts_at, submission_deadline_at, judging_deadline_at, strategy)
     VALUES ($1, $2, 'bracket', 1, 'rubric', 'judging', $3, $4, $5, 'weighted')
     ON CONFLICT (id) DO UPDATE
       SET tournament_id = EXCLUDED.tournament_id,
           kind = EXCLUDED.kind,
           number = EXCLUDED.number,
           scoring = EXCLUDED.scoring,
           status = EXCLUDED.status,
           starts_at = EXCLUDED.starts_at,
           submission_deadline_at = EXCLUDED.submission_deadline_at,
           judging_deadline_at = EXCLUDED.judging_deadline_at,
           strategy = EXCLUDED.strategy`,
    [
      DEMO_IDS.round,
      DEMO_IDS.tournament,
      addDays(-5),
      addDays(-1),
      addDays(5),
    ]
  );

  await client.query(
    `INSERT INTO round_rubric_criterion (round_id, key, name, weight, min_value, max_value, position)
     VALUES
       ($1, 'flow', 'Подача и флоу', 1.0, 0, 10, 1),
       ($1, 'lyrics', 'Тексты и панчи', 1.2, 0, 10, 2),
       ($1, 'charisma', 'Харизма и образ', 0.8, 0, 10, 3)
     ON CONFLICT (round_id, key) DO UPDATE
       SET name = EXCLUDED.name,
           weight = EXCLUDED.weight,
           min_value = EXCLUDED.min_value,
           max_value = EXCLUDED.max_value,
           position = EXCLUDED.position`,
    [DEMO_IDS.round]
  );

  await client.query(
    `INSERT INTO tournament_judge (tournament_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [DEMO_IDS.tournament, judgeId]
  );

  const participantIds: string[] = [];
  for (const userId of [artistAId, artistBId]) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO tournament_participant (tournament_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (tournament_id, user_id) DO UPDATE SET tournament_id = EXCLUDED.tournament_id
       RETURNING id`,
      [DEMO_IDS.tournament, userId]
    );
    participantIds.push(rows[0].id);
  }
  const [participantAId, participantBId] = participantIds;

  await client.query(
    `INSERT INTO match (id, round_id, starts_at, status)
     VALUES ($1, $2, $3, 'scheduled')
     ON CONFLICT (id) DO UPDATE
       SET round_id = EXCLUDED.round_id,
           starts_at = EXCLUDED.starts_at,
           status = EXCLUDED.status`,
    [DEMO_IDS.match, DEMO_IDS.round, addDays(-0.5)]
  );

  await client.query(
    `INSERT INTO match_participant (match_id, participant_id, seed)
     VALUES
       ($1, $2, 1),
       ($1, $3, 2)
     ON CONFLICT (match_id, participant_id) DO UPDATE SET seed = EXCLUDED.seed`,
    [DEMO_IDS.match, participantAId, participantBId]
  );

  await client.query(
    `INSERT INTO media_asset (id, kind, storage_key, mime, size_bytes, duration_sec, status)
     VALUES
       ($1, 'audio', 'demo/judge-battle/mc-alpha.mp3', 'audio/mpeg', 540000, 180, 'ready'),
       ($2, 'audio', 'demo/judge-battle/mc-beta.mp3', 'audio/mpeg', 560000, 174, 'ready')
     ON CONFLICT (id) DO UPDATE
       SET storage_key = EXCLUDED.storage_key,
           mime = EXCLUDED.mime,
           size_bytes = EXCLUDED.size_bytes,
           duration_sec = EXCLUDED.duration_sec,
           status = EXCLUDED.status`,
    [DEMO_IDS.mediaTrackA, DEMO_IDS.mediaTrackB]
  );

  await client.query(
    `INSERT INTO match_track (id, match_id, participant_id, audio_id, lyrics, submitted_at)
     VALUES
       ($1, $3, $5, $7, $9, now() - INTERVAL '2 hours'),
       ($2, $4, $6, $8, $10, now() - INTERVAL '90 minutes')
     ON CONFLICT (id) DO UPDATE
       SET audio_id = EXCLUDED.audio_id,
           lyrics = EXCLUDED.lyrics,
           submitted_at = EXCLUDED.submitted_at`,
    [
      DEMO_IDS.trackA,
      DEMO_IDS.trackB,
      DEMO_IDS.match,
      DEMO_IDS.match,
      participantAId,
      participantBId,
      DEMO_IDS.mediaTrackA,
      DEMO_IDS.mediaTrackB,
      'MC Alpha заливает бар за баром — без права на промах.',
      'MC Beta отвечает панчем и холодным расчётом на бит.',
    ]
  );

  await client.query(
    `INSERT INTO judge_assignment (id, judge_id, match_id, status, assigned_at)
     VALUES ($1, $2, $3, 'assigned', now())
     ON CONFLICT (judge_id, match_id) DO UPDATE
       SET status = 'assigned',
           assigned_at = EXCLUDED.assigned_at`,
    [DEMO_IDS.judgeAssignment, judgeId, DEMO_IDS.match]
  );
}

async function main() {
  try {
    await tx(async (client) => {
      const { rows: adminRows } = await client.query<{ user_id: string }>(
        `SELECT user_id FROM app_user_role WHERE role = 'admin' LIMIT 1`
      );
      const adminId = adminRows[0]?.user_id;
      if (!adminId) {
        throw new Error('Admin user not found. Please create an admin before seeding demo data.');
      }

      const judgeId = await ensureUser(client, adminId, USERS.judge);
      const artistAId = await ensureUser(client, adminId, USERS.artistA);
      const artistBId = await ensureUser(client, adminId, USERS.artistB);

      await ensureTournamentStructure(client, judgeId, artistAId, artistBId);
    });
    // eslint-disable-next-line no-console
    console.log(
      [
        'Demo judge battle seeded successfully.',
        `Judge account: ${USERS.judge.email} (password: ${USERS.judge.password})`,
        `Artists: ${USERS.artistA.displayName}, ${USERS.artistB.displayName}`,
      ].join('\n')
    );
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[seed-demo-battle] failed', error);
  process.exitCode = 1;
});
