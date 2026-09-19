import { AuthContext, AuthContextSchema } from '@opslens/contracts';
import { UnauthorizedError } from './errors.js';

/**
 * Reads and verifies AuthContext from the API Gateway request context.
 * Handlers MUST use this helper and MUST NEVER parse or verify a JWT themselves.
 */
export function getAuthContext(event?: {
  requestContext?: {
    authorizer?: Record<string, unknown> | null | undefined;
  } | null | undefined;
} | null): AuthContext {
  if (!event || !event.requestContext || !event.requestContext.authorizer) {
    throw new UnauthorizedError('Missing authorizer context in request');
  }

  // Support both REST API authorizer and HTTP API lambda authorizer nesting
  const authorizer = event.requestContext.authorizer;
  const rawContext = (authorizer.lambda as Record<string, unknown>) || authorizer;

  const parsed = AuthContextSchema.safeParse(rawContext);
  if (!parsed.success) {
    throw new UnauthorizedError(`Invalid auth context shape: ${parsed.error.message}`);
  }

  return parsed.data;
}
