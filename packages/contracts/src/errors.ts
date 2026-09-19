import { z } from 'zod';

/**
 * Standard application error codes used across HTTP responses and system failures.
 */
export const ErrorCodeEnum = z.enum([
  'INCIDENT_INVALID_TRANSITION',
  'INCIDENT_NOT_FOUND',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'VALIDATION_ERROR',
  'TENANT_MISMATCH',
  'RATE_LIMIT_EXCEEDED',
  'INTERNAL_SERVER_ERROR',
  'CONFLICT',
  'BAD_REQUEST',
  'TOKEN_BUDGET_EXCEEDED',
  'S3_PRESIGN_ERROR',
]);

/**
 * Inferred TypeScript type for standardized error codes.
 */
export type ErrorCode = z.infer<typeof ErrorCodeEnum>;

/**
 * Runtime Zod schema for granular field-level validation issue details.
 */
export const ErrorDetailSchema = z.object({
  field: z.string().optional().describe('Field or attribute path that failed validation'),
  message: z.string().describe('Descriptive error explanation for the specific field'),
  code: z.string().optional().describe('Specific validation code'),
});

/**
 * Inferred TypeScript type for validation error details.
 */
export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;

/**
 * Runtime Zod schema for the standard error payload containing code, message, details, and correlationId.
 */
export const ErrorPayloadSchema = z.object({
  code: ErrorCodeEnum.describe('Standard application error code'),
  message: z.string().min(1).describe('Human-readable description of error cause'),
  details: z
    .union([z.record(z.string(), z.unknown()), z.array(ErrorDetailSchema)])
    .optional()
    .describe('Optional error context or array of validation issues'),
  correlationId: z.string().min(1).describe('Distributed trace or request correlation ID'),
  timestamp: z.string().datetime().describe('UTC ISO-8601 timestamp when error occurred'),
});

/**
 * Inferred TypeScript type for error payload data.
 */
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;

/**
 * Runtime Zod schema for the standard API error response envelope.
 */
export const ErrorEnvelopeSchema = z.object({
  success: z.literal(false).describe('Always false for error responses'),
  error: ErrorPayloadSchema.describe('Standard error object with error code and trace details'),
});

/**
 * Inferred TypeScript type for standard HTTP error response wrapper.
 */
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
