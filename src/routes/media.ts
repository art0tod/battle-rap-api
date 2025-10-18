import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createPresignedUpload, markUploadComplete } from '../services/media.js';

const mediaRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/presign', { preHandler: fastify.requireAuth }, async (request) => {
    const body = z.object({
      filename: z.string().min(1),
      mime: z.string().min(1),
      size_bytes: z.number().int().positive(),
      type: z.enum(['audio', 'image']),
    }).parse(request.body);

    const presign = await createPresignedUpload({
      filename: body.filename,
      mime: body.mime,
      sizeBytes: body.size_bytes,
      type: body.type,
    });
    return presign;
  });

  fastify.post('/complete', { preHandler: fastify.requireAuth }, async (request) => {
    const body = z.object({
      asset_id: z.string().uuid(),
      storage_key: z.string().min(1),
      mime: z.string().min(1),
      size_bytes: z.number().int().positive(),
      kind: z.enum(['audio', 'image']),
    }).parse(request.body);

    return markUploadComplete({
      assetId: body.asset_id,
      storageKey: body.storage_key,
      mime: body.mime,
      sizeBytes: body.size_bytes,
      kind: body.kind,
    });
  });
};

export default mediaRoutes;
