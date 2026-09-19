import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { AuthContext } from '@opslens/contracts';
import { getAuthContext } from './auth.js';
import { apiError, ApiResponse } from './response.js';
import { logger } from './logger.js';

export interface HandlerContext {
  authContext: AuthContext;
  correlationId: string;
}

export type ApiHandlerFunction = (
  event: APIGatewayProxyEvent,
  context: HandlerContext,
) => Promise<ApiResponse>;

/**
 * Shared API Gateway Lambda handler wrapper that:
 * 1. Extracts or generates a correlation ID from headers
 * 2. Resolves and validates AuthContext from API Gateway authorizer
 * 3. Emits structured JSON logs for request lifecycle
 * 4. Maps typed AppError instances and unhandled errors to standard HTTP error envelopes
 */
export function createApiHandler(fn: ApiHandlerFunction) {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const correlationId =
      event.headers?.['x-correlation-id'] ||
      event.headers?.['X-Correlation-Id'] ||
      `req-${Math.random().toString(36).substring(2, 10)}`;

    const startTime = Date.now();

    try {
      const authContext = getAuthContext(event);

      logger.info('API request started', {
        correlationId,
        tenantId: authContext.tenantId,
        userId: authContext.userId,
        role: authContext.role,
        httpMethod: event.httpMethod,
        path: event.path,
      });

      const response = await fn(event, { authContext, correlationId });

      logger.info('API request completed', {
        correlationId,
        tenantId: authContext.tenantId,
        statusCode: response.statusCode,
        durationMs: Date.now() - startTime,
      });

      return response;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      logger.error('API request failed', {
        correlationId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        durationMs,
      });

      return apiError(err, correlationId);
    }
  };
}
