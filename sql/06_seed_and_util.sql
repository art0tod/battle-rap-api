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

-- Расширенный сид для тестовых сущностей по основным таблицам
DO $$
DECLARE
  v_admin UUID;
  v_moderator UUID;
  v_judge UUID;
  v_artist1 UUID;
  v_artist2 UUID;
  v_listener UUID;
  v_now TIMESTAMPTZ := now();
  v_tournament UUID := '11111111-1111-1111-1111-111111111111';
  v_round_submission UUID := '22222222-1111-1111-1111-111111111111';
  v_round_judging UUID := '22222222-2222-2222-2222-222222222222';
  v_round_finished UUID := '22222222-3333-3333-3333-333333333333';
  v_match UUID := '33333333-1111-1111-1111-111111111111';
  v_audio_application UUID := '44444444-1111-1111-1111-111111111111';
  v_audio_artist2 UUID := '44444444-2222-2222-2222-222222222222';
  v_audio_match1 UUID := '44444444-3333-3333-3333-333333333333';
  v_audio_match2 UUID := '44444444-4444-4444-4444-444444444444';
  v_audio_pending UUID := '44444444-5555-5555-5555-555555555555';
  v_image_avatar UUID := '44444444-6666-6666-6666-666666666666';
  v_submission_artist2 UUID := '55555555-1111-1111-1111-111111111111';
  v_match_track1 UUID := '66666666-1111-1111-1111-111111111111';
  v_match_track2 UUID := '66666666-2222-2222-2222-222222222222';
  v_application_artist1 UUID := '77777777-1111-1111-1111-111111111111';
  v_application_artist2 UUID := '77777777-2222-2222-2222-222222222222';
  v_profile_request1 UUID := '88888888-1111-1111-1111-111111111111';
  v_profile_request2 UUID := '88888888-2222-2222-2222-222222222222';
  v_external_identity UUID := '99999999-1111-1111-1111-111111111111';
  v_comment_id UUID := 'aaaaaaa1-1111-1111-1111-111111111111';
  v_participant_artist1 UUID;
  v_participant_artist2 UUID;
BEGIN
  SELECT id INTO v_admin FROM app_user WHERE email_norm = 'admin@example.com';

  INSERT INTO app_user(email, password_hash, display_name)
  VALUES ('moderator@example.com', '$2b$12$REPLACE_WITH_BCRYPT', 'Moderator Max')
  ON CONFLICT (email_norm) DO NOTHING;
  INSERT INTO app_user(email, password_hash, display_name)
  VALUES ('judge@example.com', '$2b$12$REPLACE_WITH_BCRYPT', 'Judge Judy')
  ON CONFLICT (email_norm) DO NOTHING;
  INSERT INTO app_user(email, password_hash, display_name)
  VALUES ('artist@example.com', '$2b$12$REPLACE_WITH_BCRYPT', 'MC Sample')
  ON CONFLICT (email_norm) DO NOTHING;
  INSERT INTO app_user(email, password_hash, display_name)
  VALUES ('artist2@example.com', '$2b$12$REPLACE_WITH_BCRYPT', 'Flow Master')
  ON CONFLICT (email_norm) DO NOTHING;
  INSERT INTO app_user(email, password_hash, display_name)
  VALUES ('listener@example.com', '$2b$12$REPLACE_WITH_BCRYPT', 'Fan Tony')
  ON CONFLICT (email_norm) DO NOTHING;

  SELECT id INTO v_moderator FROM app_user WHERE email_norm = 'moderator@example.com';
  SELECT id INTO v_judge FROM app_user WHERE email_norm = 'judge@example.com';
  SELECT id INTO v_artist1 FROM app_user WHERE email_norm = 'artist@example.com';
  SELECT id INTO v_artist2 FROM app_user WHERE email_norm = 'artist2@example.com';
  SELECT id INTO v_listener FROM app_user WHERE email_norm = 'listener@example.com';

  IF v_admin IS NOT NULL THEN
    IF v_moderator IS NOT NULL THEN
      PERFORM set_user_role(v_admin, v_moderator, 'moderator', 'grant');
      PERFORM set_user_role(v_admin, v_moderator, 'listener', 'grant');
    END IF;
    IF v_judge IS NOT NULL THEN
      PERFORM set_user_role(v_admin, v_judge, 'judge', 'grant');
    END IF;
    IF v_artist1 IS NOT NULL THEN
      PERFORM set_user_role(v_admin, v_artist1, 'artist', 'grant');
      PERFORM set_user_role(v_admin, v_artist1, 'listener', 'grant');
    END IF;
    IF v_artist2 IS NOT NULL THEN
      PERFORM set_user_role(v_admin, v_artist2, 'artist', 'grant');
      PERFORM set_user_role(v_admin, v_artist2, 'listener', 'grant');
    END IF;
    IF v_listener IS NOT NULL THEN
      PERFORM set_user_role(v_admin, v_listener, 'listener', 'grant');
    END IF;
  ELSE
    RAISE NOTICE 'Admin user missing; default roles were not assigned';
  END IF;

  INSERT INTO media_asset(id, kind, storage_key, mime, size_bytes, duration_sec, status)
  VALUES (v_audio_application, 'audio', 'seed/audio/mc-sample-qualifier.mp3', 'audio/mpeg', 512000, 185.20, 'ready')
  ON CONFLICT (id) DO UPDATE
    SET storage_key = EXCLUDED.storage_key,
        mime = EXCLUDED.mime,
        size_bytes = EXCLUDED.size_bytes,
        duration_sec = EXCLUDED.duration_sec,
        status = EXCLUDED.status;
  INSERT INTO media_asset(id, kind, storage_key, mime, size_bytes, duration_sec, status)
  VALUES (v_audio_artist2, 'audio', 'seed/audio/flow-master-draft.mp3', 'audio/mpeg', 498000, 172.40, 'ready')
  ON CONFLICT (id) DO UPDATE
    SET storage_key = EXCLUDED.storage_key,
        mime = EXCLUDED.mime,
        size_bytes = EXCLUDED.size_bytes,
        duration_sec = EXCLUDED.duration_sec,
        status = EXCLUDED.status;
  INSERT INTO media_asset(id, kind, storage_key, mime, size_bytes, duration_sec, status)
  VALUES (v_audio_match1, 'audio', 'seed/audio/mc-sample-match.mp3', 'audio/mpeg', 530000, 165.00, 'ready')
  ON CONFLICT (id) DO UPDATE
    SET storage_key = EXCLUDED.storage_key,
        mime = EXCLUDED.mime,
        size_bytes = EXCLUDED.size_bytes,
        duration_sec = EXCLUDED.duration_sec,
        status = EXCLUDED.status;
  INSERT INTO media_asset(id, kind, storage_key, mime, size_bytes, duration_sec, status)
  VALUES (v_audio_match2, 'audio', 'seed/audio/flow-master-match.mp3', 'audio/mpeg', 540000, 169.50, 'ready')
  ON CONFLICT (id) DO UPDATE
    SET storage_key = EXCLUDED.storage_key,
        mime = EXCLUDED.mime,
        size_bytes = EXCLUDED.size_bytes,
        duration_sec = EXCLUDED.duration_sec,
        status = EXCLUDED.status;
  INSERT INTO media_asset(id, kind, storage_key, mime, size_bytes, status)
  VALUES (v_audio_pending, 'audio', 'seed/audio/pending-track.mp3', 'audio/mpeg', 420000, 'pending')
  ON CONFLICT (id) DO UPDATE
    SET storage_key = EXCLUDED.storage_key,
        mime = EXCLUDED.mime,
        size_bytes = EXCLUDED.size_bytes,
        status = EXCLUDED.status,
        duration_sec = NULL;
  INSERT INTO media_asset(id, kind, storage_key, mime, size_bytes, status)
  VALUES (v_image_avatar, 'image', 'seed/image/mc-sample-avatar.jpg', 'image/jpeg', 82000, 'ready')
  ON CONFLICT (id) DO UPDATE
    SET storage_key = EXCLUDED.storage_key,
        mime = EXCLUDED.mime,
        size_bytes = EXCLUDED.size_bytes,
        status = EXCLUDED.status;

  INSERT INTO tournament(id, title, max_bracket_size, status, registration_open_at, submission_deadline_at, judging_deadline_at, public_at)
  VALUES (
    v_tournament,
    'Sample Battle Tournament',
    16,
    'ongoing',
    v_now - INTERVAL '10 days',
    v_now + INTERVAL '20 days',
    v_now + INTERVAL '30 days',
    v_now - INTERVAL '2 days'
  )
  ON CONFLICT (id) DO UPDATE
    SET title = EXCLUDED.title,
        max_bracket_size = EXCLUDED.max_bracket_size,
        status = EXCLUDED.status,
        registration_open_at = EXCLUDED.registration_open_at,
        submission_deadline_at = EXCLUDED.submission_deadline_at,
        judging_deadline_at = EXCLUDED.judging_deadline_at,
        public_at = EXCLUDED.public_at;

  INSERT INTO round(id, tournament_id, kind, number, scoring, rubric_keys, status, starts_at, submission_deadline_at, judging_deadline_at, strategy)
  VALUES (
    v_round_submission,
    v_tournament,
    'qualifier1',
    1,
    'rubric',
    ARRAY['flow','lyrics','delivery'],
    'submission',
    v_now - INTERVAL '1 day',
    v_now + INTERVAL '7 days',
    v_now + INTERVAL '14 days',
    'weighted'
  )
  ON CONFLICT (id) DO UPDATE
    SET scoring = EXCLUDED.scoring,
        rubric_keys = EXCLUDED.rubric_keys,
        status = EXCLUDED.status,
        starts_at = EXCLUDED.starts_at,
        submission_deadline_at = EXCLUDED.submission_deadline_at,
        judging_deadline_at = EXCLUDED.judging_deadline_at,
        strategy = EXCLUDED.strategy;

  INSERT INTO round(id, tournament_id, kind, number, scoring, status, starts_at, submission_deadline_at, judging_deadline_at, strategy)
  VALUES (
    v_round_judging,
    v_tournament,
    'bracket',
    1,
    'points',
    'judging',
    v_now - INTERVAL '8 days',
    v_now - INTERVAL '2 days',
    v_now + INTERVAL '5 days',
    'weighted'
  )
  ON CONFLICT (id) DO UPDATE
    SET scoring = EXCLUDED.scoring,
        status = EXCLUDED.status,
        starts_at = EXCLUDED.starts_at,
        submission_deadline_at = EXCLUDED.submission_deadline_at,
        judging_deadline_at = EXCLUDED.judging_deadline_at,
        strategy = EXCLUDED.strategy;

  INSERT INTO round(id, tournament_id, kind, number, scoring, status, starts_at, submission_deadline_at, judging_deadline_at, strategy)
  VALUES (
    v_round_finished,
    v_tournament,
    'bracket',
    2,
    'pass_fail',
    'finished',
    v_now - INTERVAL '40 days',
    v_now - INTERVAL '30 days',
    v_now - INTERVAL '10 days',
    'majority'
  )
  ON CONFLICT (id) DO UPDATE
    SET scoring = EXCLUDED.scoring,
        status = EXCLUDED.status,
        starts_at = EXCLUDED.starts_at,
        submission_deadline_at = EXCLUDED.submission_deadline_at,
        judging_deadline_at = EXCLUDED.judging_deadline_at,
        strategy = EXCLUDED.strategy;

  INSERT INTO round_rubric_criterion(round_id, key, name, weight, min_value, max_value, position)
  VALUES
    (v_round_submission, 'flow', 'Flow', 1.0, 0, 10, 1),
    (v_round_submission, 'lyrics', 'Lyrics', 1.0, 0, 10, 2),
    (v_round_submission, 'delivery', 'Delivery', 1.0, 0, 10, 3)
  ON CONFLICT (round_id, key) DO UPDATE
    SET name = EXCLUDED.name,
        weight = EXCLUDED.weight,
        min_value = EXCLUDED.min_value,
        max_value = EXCLUDED.max_value,
        position = EXCLUDED.position;

  IF v_judge IS NOT NULL THEN
    INSERT INTO tournament_judge(tournament_id, user_id)
    VALUES (v_tournament, v_judge)
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_artist1 IS NOT NULL THEN
    INSERT INTO participation_application(
      id, user_id, round_id, status, city, age, vk_id, full_name, beat_author, audio_id, lyrics, created_at, updated_at
    ) VALUES (
      v_application_artist1, v_artist1, v_round_submission, 'submitted',
      'Moscow', 25, 'vk12345', 'MC Sample', 'DJ Seed', v_audio_application,
      'Я тот самый MC, что качает толпу', v_now - INTERVAL '3 days', v_now - INTERVAL '3 days'
    )
    ON CONFLICT (id) DO UPDATE
      SET city = EXCLUDED.city,
          age = EXCLUDED.age,
          vk_id = EXCLUDED.vk_id,
          full_name = EXCLUDED.full_name,
          beat_author = EXCLUDED.beat_author,
          audio_id = EXCLUDED.audio_id,
          lyrics = EXCLUDED.lyrics;

    UPDATE participation_application
      SET status = 'approved',
          moderator_id = COALESCE(v_moderator, moderator_id),
          reviewed_at = v_now,
          updated_at = v_now
    WHERE id = v_application_artist1 AND status <> 'approved';
  END IF;

  IF v_artist2 IS NOT NULL THEN
    INSERT INTO participation_application(
      id, user_id, round_id, status, city, age, full_name, lyrics, created_at, updated_at
    ) VALUES (
      v_application_artist2, v_artist2, v_round_submission, 'submitted',
      'Saint Petersburg', 22, 'Flow Master', 'Скоро ворвусь в игру',
      v_now - INTERVAL '1 day', v_now - INTERVAL '1 day'
    )
    ON CONFLICT (id) DO UPDATE
      SET city = EXCLUDED.city,
          age = EXCLUDED.age,
          full_name = EXCLUDED.full_name,
          lyrics = EXCLUDED.lyrics;
  END IF;

  IF v_artist1 IS NOT NULL THEN
    SELECT id INTO v_participant_artist1
    FROM tournament_participant
    WHERE tournament_id = v_tournament AND user_id = v_artist1
    LIMIT 1;
  END IF;

  IF v_artist2 IS NOT NULL THEN
    INSERT INTO tournament_participant(tournament_id, user_id)
    VALUES (v_tournament, v_artist2)
    ON CONFLICT (tournament_id, user_id) DO NOTHING;
    SELECT id INTO v_participant_artist2
    FROM tournament_participant
    WHERE tournament_id = v_tournament AND user_id = v_artist2
    LIMIT 1;
  END IF;

  IF v_participant_artist2 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM submission WHERE round_id = v_round_submission AND participant_id = v_participant_artist2
  ) THEN
    INSERT INTO submission(
      id, round_id, participant_id, audio_id, lyrics, status, created_at, updated_at
    ) VALUES (
      v_submission_artist2, v_round_submission, v_participant_artist2, v_audio_artist2,
      'Черновик трека для квалификации', 'draft', v_now - INTERVAL '20 hours', v_now - INTERVAL '20 hours'
    );
  END IF;

  IF v_artist1 IS NOT NULL THEN
    INSERT INTO artist_profile(user_id, avatar_key, bio, socials, city, age, vk_id, full_name)
    VALUES (
      v_artist1,
      'avatars/mc-sample.jpg',
      'MC Sample — участник тестового турнира.',
      jsonb_build_object('instagram', 'https://instagram.com/mc_sample'),
      'Moscow',
      25,
      'vk12345',
      'MC Sample'
    )
    ON CONFLICT (user_id) DO UPDATE
      SET avatar_key = EXCLUDED.avatar_key,
          bio = EXCLUDED.bio,
          socials = EXCLUDED.socials,
          city = COALESCE(EXCLUDED.city, artist_profile.city),
          age = COALESCE(EXCLUDED.age, artist_profile.age),
          vk_id = COALESCE(EXCLUDED.vk_id, artist_profile.vk_id),
          full_name = COALESCE(EXCLUDED.full_name, artist_profile.full_name);
  END IF;

  IF v_artist2 IS NOT NULL THEN
    INSERT INTO artist_profile(user_id, avatar_key, bio, socials, city, age, vk_id, full_name)
    VALUES (
      v_artist2,
      'avatars/flow-master.jpg',
      'Flow Master готовится к своему дебюту.',
      jsonb_build_object('youtube', 'https://youtube.com/@flowmaster'),
      'Saint Petersburg',
      22,
      'vk98765',
      'Flow Master'
    )
    ON CONFLICT (user_id) DO UPDATE
      SET avatar_key = EXCLUDED.avatar_key,
          bio = EXCLUDED.bio,
          socials = EXCLUDED.socials,
          city = COALESCE(EXCLUDED.city, artist_profile.city),
          age = COALESCE(EXCLUDED.age, artist_profile.age),
          vk_id = COALESCE(EXCLUDED.vk_id, artist_profile.vk_id),
          full_name = COALESCE(EXCLUDED.full_name, artist_profile.full_name);
  END IF;

  IF v_artist1 IS NOT NULL THEN
    INSERT INTO external_identity(id, user_id, provider, external_uid)
    VALUES (v_external_identity, v_artist1, 'vk', 'vk-uid-seed-001')
    ON CONFLICT (provider, external_uid) DO NOTHING;
  END IF;

  INSERT INTO match(id, round_id, starts_at, status)
  VALUES (v_match, v_round_judging, v_now - INTERVAL '1 day', 'scheduled')
  ON CONFLICT (id) DO UPDATE
    SET round_id = EXCLUDED.round_id,
        starts_at = EXCLUDED.starts_at,
        status = EXCLUDED.status;

  IF v_participant_artist1 IS NOT NULL THEN
    INSERT INTO match_participant(match_id, participant_id, seed)
    VALUES (v_match, v_participant_artist1, 1)
    ON CONFLICT (match_id, participant_id) DO UPDATE
      SET seed = EXCLUDED.seed;
  END IF;
  IF v_participant_artist2 IS NOT NULL THEN
    INSERT INTO match_participant(match_id, participant_id, seed)
    VALUES (v_match, v_participant_artist2, 2)
    ON CONFLICT (match_id, participant_id) DO UPDATE
      SET seed = EXCLUDED.seed;
  END IF;

  IF v_participant_artist1 IS NOT NULL THEN
    INSERT INTO match_track(id, match_id, participant_id, audio_id, lyrics, submitted_at)
    VALUES (
      v_match_track1, v_match, v_participant_artist1, v_audio_match1,
      'MC Sample вступает в матч с боевым куплетом.', v_now - INTERVAL '3 hours'
    )
    ON CONFLICT (id) DO UPDATE
      SET audio_id = EXCLUDED.audio_id,
          lyrics = EXCLUDED.lyrics;
  END IF;
  IF v_participant_artist2 IS NOT NULL THEN
    INSERT INTO match_track(id, match_id, participant_id, audio_id, lyrics, submitted_at)
    VALUES (
      v_match_track2, v_match, v_participant_artist2, v_audio_match2,
      'Flow Master отвечает мощной рифмовкой.', v_now - INTERVAL '2 hours'
    )
    ON CONFLICT (id) DO UPDATE
      SET audio_id = EXCLUDED.audio_id,
          lyrics = EXCLUDED.lyrics;
  END IF;

  IF v_judge IS NOT NULL THEN
    INSERT INTO judge_assignment(judge_id, match_id)
    VALUES (v_judge, v_match)
    ON CONFLICT (judge_id, match_id) DO NOTHING;

    INSERT INTO evaluation(judge_id, target_type, target_id, round_id, score, comment)
    VALUES (v_judge, 'match', v_match, v_round_judging, 87, 'Сильная энергетика, есть куда расти по тексту.')
    ON CONFLICT (judge_id, target_type, target_id) DO UPDATE
      SET score = EXCLUDED.score,
          comment = EXCLUDED.comment,
          round_id = EXCLUDED.round_id;
  END IF;

  IF v_listener IS NOT NULL THEN
    INSERT INTO track_like(user_id, match_track_id, created_at)
    VALUES (v_listener, v_match_track1, v_now - INTERVAL '1 hour')
    ON CONFLICT (user_id, match_track_id) DO NOTHING;

    INSERT INTO comment(id, user_id, match_id, match_track_id, body, created_at)
    VALUES (
      v_comment_id, v_listener, v_match, v_match_track1,
      'Отличный куплет, жду релиз!', v_now - INTERVAL '50 minutes'
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;

  IF v_moderator IS NOT NULL AND v_artist2 IS NOT NULL THEN
    INSERT INTO profile_change_request(
      id, user_id, changes, status, created_at, updated_at
    ) VALUES (
      v_profile_request1, v_artist2,
      jsonb_build_object('bio','Обновляю профиль перед выходом в эфир','city','Kazan'),
      'pending', v_now - INTERVAL '6 hours', v_now - INTERVAL '6 hours'
    )
    ON CONFLICT (id) DO UPDATE
      SET changes = EXCLUDED.changes,
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at;
  END IF;

  IF v_moderator IS NOT NULL AND v_artist1 IS NOT NULL THEN
    INSERT INTO profile_change_request(
      id, user_id, changes, status, created_at, updated_at
    ) VALUES (
      v_profile_request2, v_artist1,
      jsonb_build_object('display_name','MC Sample Deluxe','bio','Апдейт профиля после победы'),
      'pending', v_now - INTERVAL '12 hours', v_now - INTERVAL '12 hours'
    )
    ON CONFLICT (id) DO NOTHING;

    UPDATE profile_change_request
      SET status = 'approved',
          moderator_id = v_moderator,
          reviewed_at = v_now,
          updated_at = v_now
    WHERE id = v_profile_request2 AND status <> 'approved';
  END IF;

  PERFORM refresh_public_views();
END$$;

COMMIT;
