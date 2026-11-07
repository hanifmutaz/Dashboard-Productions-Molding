import { pino } from 'pino';

export function createLogger(level: string) {
  return pino({
    level,
    base: { app: 'molding-pm-dashboard' },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Never log credentials, cookies or session material.
    redact: { paths: ['req.headers.cookie', 'req.headers.authorization', '*.password', '*.newPassword', '*.currentPassword', '*.token', '*.code'], censor: '[redacted]' },
  });
}
export type Logger = ReturnType<typeof createLogger>;
