import jwt, { SignOptions, JwtPayload as JwtPayloadBase } from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { parseDurationSeconds } from '../lib/time.js';

type JwtPayload = {
  sub: string;
  jti: string;
  type: 'access' | 'refresh';
  roles: string[];
};

const sign = (payload: JwtPayload, options: SignOptions) => {
  return jwt.sign(payload, env.JWT_SECRET, options);
};

export const signAccessToken = (userId: string, roles: string[]) => {
  const payload: JwtPayload = {
    sub: userId,
    jti: randomUUID(),
    type: 'access',
    roles,
  };
  return sign(payload, {
    expiresIn: parseDurationSeconds(env.JWT_ACCESS_TTL),
  });
};

export const signRefreshToken = (userId: string, roles: string[]) => {
  const payload: JwtPayload = {
    sub: userId,
    jti: randomUUID(),
    type: 'refresh',
    roles,
  };
  return {
    token: sign(payload, { expiresIn: parseDurationSeconds(env.JWT_REFRESH_TTL) }),
    jti: payload.jti,
  };
};

export const verifyToken = (token: string) => {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload & JwtPayloadBase;
};
