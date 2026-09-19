import { S3Client, S3ClientConfig, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ulid } from 'ulid';
import { PresignUploadResult } from './types.js';

export const PRESIGNED_URL_EXPIRY_SECONDS = 15 * 60; // 15 minutes

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

/**
 * Builds the canonical S3 object key for staging incident media:
 * tenants/<tenantId>/incidents/staging/<ulid>.<ext>
 */
export function buildStagingS3Key(tenantId: string, ext: string, customUlid?: string): string {
  const fileId = customUlid || ulid();
  return `tenants/${tenantId}/incidents/staging/${fileId}.${ext}`;
}

/**
 * Generates an S3 presigned PUT URL expiring in 15 minutes and the final staging S3 key.
 */
export async function createPresignedUploadUrl(options: {
  tenantId: string;
  contentType: string;
  fileExtension: string;
  customUlid?: string;
  client?: S3Client;
}): Promise<PresignUploadResult> {
  const { tenantId, contentType, fileExtension, customUlid, client = getS3Client() } = options;

  const bucket = getMediaBucket();
  const key = buildStagingS3Key(tenantId, fileExtension, customUlid);

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
  });

  const expiresAt = new Date(Date.now() + PRESIGNED_URL_EXPIRY_SECONDS * 1000).toISOString();

  return {
    uploadUrl,
    s3Key: key,
    key,
    expiresAt,
  };
}

/**
 * Retrieves metadata for an S3 object (useful for verification and integration testing).
 */
export async function headObject(bucket: string, key: string, client = getS3Client()) {
  const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
  return client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
}

