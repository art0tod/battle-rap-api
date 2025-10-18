import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { AppError, mapDbError } from '../lib/errors.js';

const s3 = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
});

export const createPresignedUpload = async (params: { filename: string; mime: string; sizeBytes: number; type: 'audio' | 'image' }) => {
  const assetId = randomUUID();
  const storageKey = `${assetId}/${encodeURIComponent(params.filename)}`;

  const putCommand = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: storageKey,
    ContentType: params.mime,
    ContentLength: params.sizeBytes,
  });

  const url = await getSignedUrl(s3, putCommand, { expiresIn: 900 });

  return {
    assetId,
    storageKey,
    uploadUrl: url,
    headers: {
      'Content-Type': params.mime,
    },
  };
};

export const markUploadComplete = async (params: { assetId: string; storageKey: string; kind: 'audio' | 'image'; mime: string; sizeBytes: number }) => {
  try {
    const { rows } = await pool.query(
      `INSERT INTO media_asset(id, kind, storage_key, mime, size_bytes, status, created_at)
       VALUES ($1,$2,$3,$4,$5,'pending',now())
       ON CONFLICT (id) DO UPDATE
       SET storage_key = EXCLUDED.storage_key,
           mime = EXCLUDED.mime,
           size_bytes = EXCLUDED.size_bytes,
           status = 'pending'
       RETURNING id, status`,
      [params.assetId, params.kind, params.storageKey, params.mime, params.sizeBytes]
    );
    return rows[0];
  } catch (err) {
    throw mapDbError(err);
  }
};

export const resolveCdnUrl = (storageKey: string) => `${env.CDN_BASE_URL}/${storageKey}`;
