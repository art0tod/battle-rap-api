import { FastifyReply } from 'fastify';
import { z } from 'zod';

export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly detail?: string;
  public readonly fieldErrors?: Record<string, string>;

  constructor(opts: {
    status: number;
    code: string;
    message: string;
    detail?: string;
    fieldErrors?: Record<string, string>;
  }) {
    super(opts.message);
    this.status = opts.status;
    this.code = opts.code;
    this.detail = opts.detail;
    this.fieldErrors = opts.fieldErrors;
  }
}

export const mapDbError = (err: unknown): AppError => {
  if (err instanceof AppError) {
    return err;
  }
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    const msg = err.message;
    if (msg.includes('round is not accepting submissions')) {
      return new AppError({ status: 403, code: 'submission_window_closed', message: 'Round is not accepting submissions.' });
    }
    if (msg.includes('submission deadline passed')) {
      return new AppError({ status: 422, code: 'submission_deadline_passed', message: 'Submission deadline has passed.' });
    }
    if (msg.includes('round is not in judging state') || msg.includes('judging deadline passed')) {
      return new AppError({ status: 422, code: 'judging_window_closed', message: 'Judging window is closed.' });
    }
    if (msg.includes('judge is not assigned to this match')) {
      return new AppError({ status: 403, code: 'judge_not_assigned', message: 'Judge is not assigned to this match.' });
    }
    if (msg.includes('rubric missing key') || msg.includes('out of bounds')) {
      return new AppError({ status: 422, code: 'rubric_invalid', message: 'Rubric payload is invalid.' });
    }
    if (msg.includes('audio media must be ready') || msg.includes('media not ready')) {
      return new AppError({ status: 422, code: 'media_not_ready', message: 'Media asset must be ready.' });
    }
    if (msg.includes('only admin') || msg.includes('moderator cannot')) {
      return new AppError({ status: 403, code: 'role_forbidden', message: 'Insufficient permissions for role change.' });
    }
    if (msg.includes('duplicate key value violates unique constraint')) {
      return new AppError({ status: 409, code: 'conflict', message: 'Resource already exists.' });
    }
  }

  return new AppError({
    status: 500,
    code: 'internal_server_error',
    message: 'Internal server error.',
  });
};

export const formatProblemJson = (error: AppError) => ({
  type: `https://httpstatuses.com/${error.status}`,
  title: error.message,
  detail: error.detail ?? error.message,
  status: error.status,
  field_errors: error.fieldErrors ?? undefined,
});

export const handleZodError = (error: z.ZodError): AppError => {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.');
    fieldErrors[path] = issue.message;
  }
  return new AppError({
    status: 422,
    code: 'validation_failed',
    message: 'Payload validation failed.',
    fieldErrors,
  });
};

export const replyWithError = (reply: FastifyReply, error: AppError) => {
  reply.status(error.status).send(formatProblemJson(error));
};
