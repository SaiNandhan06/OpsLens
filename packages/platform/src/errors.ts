import { ErrorCode } from '@opslens/contracts';

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown> | unknown[];

  constructor(message: string, code: ErrorCode, statusCode = 500, details?: Record<string, unknown> | unknown[]) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized: Authentication context is missing or invalid') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden: Access denied by authorization policy') {
    super(message, 'FORBIDDEN', 403);
  }
}

export class TenantMismatchError extends AppError {
  constructor(message = 'Forbidden: Cross-tenant access is strictly forbidden') {
    super(message, 'TENANT_MISMATCH', 403);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: Record<string, unknown> | unknown[]) {
    super(message, 'VALIDATION_ERROR', 400, details);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', details?: Record<string, unknown> | unknown[]) {
    super(message, 'BAD_REQUEST', 400, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', code: ErrorCode = 'INCIDENT_NOT_FOUND') {
    super(message, code, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict with current resource state', code: ErrorCode = 'CONFLICT') {
    super(message, code, 409);
  }
}

export class InvalidTransitionError extends AppError {
  constructor(message = 'Illegal state transition', details?: Record<string, unknown> | unknown[]) {
    super(message, 'INCIDENT_INVALID_TRANSITION', 409, details);
  }
}

