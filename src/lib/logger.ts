import pino, { LoggerOptions } from 'pino';
import { env } from '../config/env.js';

export const loggerOptions: LoggerOptions = {
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport:
    env.NODE_ENV === 'production'
      ? undefined
      : {
          target: 'pino-pretty',
          options: {
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
};

export const logger = pino(loggerOptions);
