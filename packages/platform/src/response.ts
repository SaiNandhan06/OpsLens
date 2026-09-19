import { AppError } from './errors.js';
import { ErrorEnvelope } from '@opslens/contracts';

export interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export const DEFAULT_CORS_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'OPTIONS,GET,POST,PUT,PATCH,DELETE',
};

/**
 * Creates a standardized 2xx/3xx API Gateway response with JSON serialization and CORS headers.
 */
export function apiSuccess<T>(
  data: T,
  statusCode = 200,
  customHeaders: Record<string, string> = {},
): ApiResponse {
  return {
    statusCode,
    headers: { ...DEFAULT_CORS_HEADERS, ...customHeaders },
    body: JSON.stringify(data),
  };
}

/**
 * Creates a standardized error API Gateway response conforming to ErrorEnvelopeSchema.
 */
export function apiError(
  err: unknown,
  correlationId = `req-${Math.random().toString(36).substring(2, 10)}`,
  customHeaders: Record<string, string> = {},
): ApiResponse {
  const timestamp = new Date().toISOString();

  if (err instanceof AppError) {
    const errorBody: ErrorEnvelope = {
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details as Record<string, unknown> | undefined,
        correlationId,
        timestamp,
      },
    };
    return {
      statusCode: err.statusCode,
      headers: { ...DEFAULT_CORS_HEADERS, ...customHeaders },
      body: JSON.stringify(errorBody),
    };
  }

  const message = err instanceof Error ? err.message : 'Internal server error';
  const errorBody: ErrorEnvelope = {
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message,
      correlationId,
      timestamp,
    },
  };

  return {
    statusCode: 500,
    headers: { ...DEFAULT_CORS_HEADERS, ...customHeaders },
    body: JSON.stringify(errorBody),
  };
}
