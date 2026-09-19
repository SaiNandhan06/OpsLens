export interface StructuredLog {
  timestamp?: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  correlationId?: string;
  tenantId?: string;
  userId?: string;
  [key: string]: unknown;
}

export function log(entry: StructuredLog): void {
  const payload = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

  const line = JSON.stringify(payload);
  if (entry.level === 'error') {
    console.error(line);
  } else if (entry.level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) =>
    log({ level: 'debug', message, ...context }),
  info: (message: string, context?: Record<string, unknown>) =>
    log({ level: 'info', message, ...context }),
  warn: (message: string, context?: Record<string, unknown>) =>
    log({ level: 'warn', message, ...context }),
  error: (message: string, context?: Record<string, unknown>) =>
    log({ level: 'error', message, ...context }),
};
