import ms, { StringValue } from 'ms';

export const parseDurationMs = (value: string) => {
  const duration = ms(value as StringValue);
  if (typeof duration !== 'number' || Number.isNaN(duration) || duration <= 0) {
    throw new Error(`Invalid duration: ${value}`);
  }
  return duration;
};

export const parseDurationSeconds = (value: string) => Math.floor(parseDurationMs(value) / 1000);
