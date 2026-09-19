import {
  S3Client,
  S3ClientConfig,
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ulid } from 'ulid';
import { IncidentAttachment } from '@opslens/contracts';
import { AttachmentRepository } from '@opslens/data';
import { BadRequestError } from '@opslens/platform';

export const PRESIGNED_GET_EXPIRY_SECONDS = 15 * 60; // 15 minutes

export function getMediaBucket(): string {
  return process.env.MEDIA_BUCKET || 'opslens-media-local';
}

export function isLocal(): boolean {
  return (
    process.env.STAGE === 'local' ||
    Boolean(process.env.LOCALSTACK_HOSTNAME) ||
    Boolean(process.env.AWS_ENDPOINT_URL) ||
    !process.env.STAGE
  );
}

export function createS3Client(config: S3ClientConfig = {}): S3Client {
  const isLocalEnv = isLocal();
  const endpoint =
    process.env.LOCALSTACK_ENDPOINT ||
    process.env.AWS_ENDPOINT_URL ||
    (isLocalEnv ? 'http://localhost:4566' : undefined);

  const region = process.env.AWS_REGION || 'us-east-1';

  const clientConfig: S3ClientConfig = {
    region,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    ...config,
  };

  if (endpoint) {
    clientConfig.endpoint = endpoint;
  }

  if (isLocalEnv) {
    clientConfig.forcePathStyle = true;
    clientConfig.credentials = clientConfig.credentials || {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
    };
  }

  return new S3Client(clientConfig);
}

let defaultS3Client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (!defaultS3Client) {
    defaultS3Client = createS3Client();
  }
  return defaultS3Client;
}

function guessContentType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'webm':
      return 'audio/webm';
    case 'mp4':
      return 'audio/mp4';
    case 'mp3':
      return 'audio/mpeg';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Moves an uploaded attachment from the staging prefix to the permanent incident folder:
 *   staging:   tenants/<tenantId>/incidents/staging/<fileName>
 *   permanent: tenants/<tenantId>/incidents/<incidentId>/<fileName>
 *
 * Enforces tenant isolation: staging key MUST match the caller's tenantId.
 * Persists an IncidentAttachment record via AttachmentRepository.
 */
export async function moveStagingAttachment(options: {
  tenantId: string;
  incidentId: string;
  stagingKey: string;
  uploadedBy: string;
  s3Client?: S3Client;
  attachmentRepo?: AttachmentRepository;
}): Promise<IncidentAttachment> {
  const {
    tenantId,
    incidentId,
    stagingKey,
    uploadedBy,
    s3Client = getS3Client(),
    attachmentRepo = new AttachmentRepository(),
  } = options;

  const expectedPrefix = `tenants/${tenantId}/incidents/staging/`;
  if (!stagingKey.startsWith(expectedPrefix)) {
    throw new BadRequestError(
      `Invalid staging key: Attachment does not belong to tenant '${tenantId}' staging directory`,
    );
  }

  const fileName = stagingKey.substring(expectedPrefix.length);
  const targetKey = `tenants/${tenantId}/incidents/${incidentId}/${fileName}`;
  const bucket = getMediaBucket();

  // Copy object to permanent location
  await s3Client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${stagingKey}`,
      Key: targetKey,
    }),
  );

  // Delete from staging
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: stagingKey,
    }),
  );

  // Determine size and content type if available
  let sizeBytes = 0;
  let contentType = guessContentType(fileName);
  try {
    const head = await s3Client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: targetKey,
      }),
    );
    if (head.ContentLength) sizeBytes = head.ContentLength;
    if (head.ContentType) contentType = head.ContentType;
  } catch {
    // If HeadObject fails (e.g. mocked S3), fallback gracefully
  }

  const attachment: IncidentAttachment = {
    id: ulid(),
    incidentId,
    tenantId,
    fileName,
    contentType,
    s3Key: targetKey,
    sizeBytes,
    uploadedBy,
    createdAt: new Date().toISOString(),
  };

  await attachmentRepo.createAttachment(tenantId, attachment);
  return attachment;
}

/**
 * Generates a short-lived presigned GET URL for an attachment in S3.
 */
export async function generatePresignedGetUrl(
  s3Key: string,
  expiresInSeconds = PRESIGNED_GET_EXPIRY_SECONDS,
  s3Client = getS3Client(),
): Promise<string> {
  const bucket = getMediaBucket();
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: s3Key,
  });

  return getSignedUrl(s3Client, command, {
    expiresIn: expiresInSeconds,
  });
}
