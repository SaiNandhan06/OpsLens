import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getAuthContext, apiSuccess, apiError } from '@opslens/platform';
import { validatePresignUpload } from './validation.js';
import { createPresignedUploadUrl } from './s3.js';

/**
 * AWS Lambda handler for POST /v1/uploads/presign.
 *
 * Validates request payload against size and content-type rules:
 * - Photo: <= 5MB and image/jpeg | image/png | image/webp
 * - Audio: <= 10MB and audio/webm | audio/mp4 | audio/mpeg
 *
 * Generates an S3 staging key:
 *   tenants/<tenantId>/incidents/staging/<ulid>.<ext>
 *
 * Returns a presigned PUT URL expiring in 15 minutes plus the final S3 key.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const correlationId =
    event.headers?.['x-correlation-id'] ||
    event.headers?.['X-Correlation-Id'] ||
    `req-${Math.random().toString(36).substring(2, 10)}`;

  try {
    // 1. Authenticate using authorizer context (claims from Cognito / Cedar)
    const authContext = getAuthContext(event);
    const { tenantId } = authContext;

    // 2. Validate request body and media constraints
    const { normalizedContentType, fileExtension } = validatePresignUpload(event.body);

    // 3. Generate presigned S3 PUT URL and final S3 key
    const presignedResult = await createPresignedUploadUrl({
      tenantId,
      contentType: normalizedContentType,
      fileExtension,
    });

    return apiSuccess(presignedResult, 200);
  } catch (err) {
    return apiError(err, correlationId);
  }
}
