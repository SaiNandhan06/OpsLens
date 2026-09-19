import { describe, it, expect } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  validatePresignUpload,
  PHOTO_MAX_BYTES,
  AUDIO_MAX_BYTES,
} from '../src/validation.js';
import { buildStagingS3Key, createPresignedUploadUrl } from '../src/s3.js';
import { handler } from '../src/handler.js';

describe('API Uploads Service', () => {
  describe('validatePresignUpload', () => {
    it('accepts valid photo formats within 5MB', () => {
      const jpeg = validatePresignUpload({
        kind: 'photo',
        contentType: 'image/jpeg',
        sizeBytes: 1024 * 1024,
      });
      expect(jpeg.fileExtension).toBe('jpg');
      expect(jpeg.normalizedContentType).toBe('image/jpeg');

      const png = validatePresignUpload({
        kind: 'photo',
        contentType: 'image/png',
        sizeBytes: PHOTO_MAX_BYTES,
      });
      expect(png.fileExtension).toBe('png');

      const webp = validatePresignUpload({
        kind: 'photo',
        contentType: 'image/webp; charset=utf-8',
        sizeBytes: 500,
      });
      expect(webp.fileExtension).toBe('webp');
      expect(webp.normalizedContentType).toBe('image/webp');
    });

    it('rejects photo uploads exceeding 5MB', () => {
      expect(() =>
        validatePresignUpload({
          kind: 'photo',
          contentType: 'image/jpeg',
          sizeBytes: PHOTO_MAX_BYTES + 1,
        }),
      ).toThrowError(/Photo size exceeds 5MB limit/);
    });

    it('rejects photo uploads with disallowed content types', () => {
      expect(() =>
        validatePresignUpload({
          kind: 'photo',
          contentType: 'image/gif',
          sizeBytes: 1024,
        }),
      ).toThrowError(/Invalid contentType for photo/);

      expect(() =>
        validatePresignUpload({
          kind: 'photo',
          contentType: 'application/pdf',
          sizeBytes: 1024,
        }),
      ).toThrowError(/Invalid contentType for photo/);
    });

    it('accepts valid audio formats within 10MB', () => {
      const webm = validatePresignUpload({
        kind: 'audio',
        contentType: 'audio/webm',
        sizeBytes: 2 * 1024 * 1024,
      });
      expect(webm.fileExtension).toBe('webm');

      const mp4 = validatePresignUpload({
        kind: 'audio',
        contentType: 'audio/mp4',
        sizeBytes: AUDIO_MAX_BYTES,
      });
      expect(mp4.fileExtension).toBe('mp4');

      const mpeg = validatePresignUpload({
        kind: 'audio',
        contentType: 'audio/mpeg',
        sizeBytes: 5 * 1024 * 1024,
      });
      expect(mpeg.fileExtension).toBe('mp3');
    });

    it('rejects audio uploads exceeding 10MB', () => {
      expect(() =>
        validatePresignUpload({
          kind: 'audio',
          contentType: 'audio/mpeg',
          sizeBytes: AUDIO_MAX_BYTES + 1,
        }),
      ).toThrowError(/Audio size exceeds 10MB limit/);
    });

    it('rejects audio uploads with disallowed content types', () => {
      expect(() =>
        validatePresignUpload({
          kind: 'audio',
          contentType: 'audio/wav',
          sizeBytes: 1024,
        }),
      ).toThrowError(/Invalid contentType for audio/);

      expect(() =>
        validatePresignUpload({
          kind: 'audio',
          contentType: 'audio/ogg',
          sizeBytes: 1024,
        }),
      ).toThrowError(/Invalid contentType for audio/);
    });

    it('rejects invalid kind or malformed payloads', () => {
      expect(() =>
        validatePresignUpload({
          kind: 'video',
          contentType: 'video/mp4',
          sizeBytes: 1024,
        }),
      ).toThrowError(/kind must be either "photo" or "audio"/);

      expect(() =>
        validatePresignUpload({
          kind: 'photo',
          contentType: 'image/jpeg',
          sizeBytes: 0,
        }),
      ).toThrowError(/sizeBytes must be a positive integer/);

      expect(() =>
        validatePresignUpload({
          kind: 'photo',
          contentType: 'image/jpeg',
          sizeBytes: -100,
        }),
      ).toThrowError(/sizeBytes must be a positive integer/);

      expect(() => validatePresignUpload('invalid-json')).toThrowError(/Invalid JSON body/);
    });
  });

  describe('buildStagingS3Key', () => {
    it('generates an S3 key conforming to tenants/<tenantId>/incidents/staging/<ulid>.<ext>', () => {
      const tenantId = 'north-hub';
      const key = buildStagingS3Key(tenantId, 'jpg');

      const regex = /^tenants\/north-hub\/incidents\/staging\/[0-9A-HJKMNP-TV-Z]{26}\.jpg$/;
      expect(key).toMatch(regex);
    });

    it('respects a custom ULID when supplied', () => {
      const key = buildStagingS3Key('south-hub', 'png', '01HRX1000INCIDENTTEST00');
      expect(key).toBe('tenants/south-hub/incidents/staging/01HRX1000INCIDENTTEST00.png');
    });
  });

  describe('createPresignedUploadUrl', () => {
    it('creates a signed PUT URL expiring in 15 minutes', async () => {
      const result = await createPresignedUploadUrl({
        tenantId: 'north-hub',
        contentType: 'image/jpeg',
        fileExtension: 'jpg',
      });

      expect(result.uploadUrl).toBeDefined();
      expect(result.s3Key).toMatch(/^tenants\/north-hub\/incidents\/staging\/[0-9A-HJKMNP-TV-Z]{26}\.jpg$/);
      expect(result.key).toBe(result.s3Key);

      // Verify expiration is approximately 15 minutes in the future (within 30 seconds tolerance)
      const expiresAtDate = new Date(result.expiresAt).getTime();
      const expectedDate = Date.now() + 15 * 60 * 1000;
      expect(Math.abs(expiresAtDate - expectedDate)).toBeLessThan(30000);
    });
  });

  describe('handler', () => {
    const mockAuthContext = {
      tenantId: 'north-hub',
      userId: 'usr-worker-01',
      role: 'worker',
      email: 'worker@north-hub.opslens.internal',
    };

    function createMockEvent(
      body: unknown,
      auth: Record<string, unknown> | null = mockAuthContext,
      correlationId = 'test-corr-123',
    ): APIGatewayProxyEvent {
      return {
        body: typeof body === 'string' ? body : JSON.stringify(body),
        headers: {
          'x-correlation-id': correlationId,
        },
        requestContext: {
          authorizer: auth ? auth : undefined,
        },
      } as unknown as APIGatewayProxyEvent;
    }

    it('returns 401 when requestContext authorizer is missing', async () => {
      const event = createMockEvent({ kind: 'photo', contentType: 'image/jpeg', sizeBytes: 1024 }, null);
      const res = await handler(event);

      expect(res.statusCode).toBe(401);
      const parsed = JSON.parse(res.body);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 200 with presigned PUT URL and staging key for valid photo upload', async () => {
      const event = createMockEvent({
        kind: 'photo',
        contentType: 'image/jpeg',
        sizeBytes: 2 * 1024 * 1024,
      });

      const res = await handler(event);
      expect(res.statusCode).toBe(200);

      const parsed = JSON.parse(res.body);
      expect(parsed.uploadUrl).toBeDefined();
      expect(parsed.s3Key).toMatch(/^tenants\/north-hub\/incidents\/staging\/[0-9A-HJKMNP-TV-Z]{26}\.jpg$/);
      expect(parsed.key).toBe(parsed.s3Key);
      expect(parsed.expiresAt).toBeDefined();
    });

    it('returns 200 with presigned PUT URL and staging key for valid audio upload', async () => {
      const event = createMockEvent({
        kind: 'audio',
        contentType: 'audio/webm',
        sizeBytes: 4 * 1024 * 1024,
      });

      const res = await handler(event);
      expect(res.statusCode).toBe(200);

      const parsed = JSON.parse(res.body);
      expect(parsed.uploadUrl).toBeDefined();
      expect(parsed.s3Key).toMatch(/^tenants\/north-hub\/incidents\/staging\/[0-9A-HJKMNP-TV-Z]{26}\.webm$/);
    });

    it('returns 400 when photo exceeds 5MB', async () => {
      const event = createMockEvent({
        kind: 'photo',
        contentType: 'image/png',
        sizeBytes: 6 * 1024 * 1024,
      });

      const res = await handler(event);
      expect(res.statusCode).toBe(400);

      const parsed = JSON.parse(res.body);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
      expect(parsed.error.message).toContain('5MB limit');
    });

    it('returns 400 when audio exceeds 10MB', async () => {
      const event = createMockEvent({
        kind: 'audio',
        contentType: 'audio/mpeg',
        sizeBytes: 12 * 1024 * 1024,
      });

      const res = await handler(event);
      expect(res.statusCode).toBe(400);

      const parsed = JSON.parse(res.body);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
      expect(parsed.error.message).toContain('10MB limit');
    });

    it('returns 400 when contentType is disallowed', async () => {
      const event = createMockEvent({
        kind: 'photo',
        contentType: 'image/bmp',
        sizeBytes: 1024,
      });

      const res = await handler(event);
      expect(res.statusCode).toBe(400);

      const parsed = JSON.parse(res.body);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
      expect(parsed.error.message).toContain('Invalid contentType for photo');
    });

    it('forwards correlationId and sets CORS headers', async () => {
      const event = createMockEvent(
        {
          kind: 'photo',
          contentType: 'image/jpeg',
          sizeBytes: 1024,
        },
        mockAuthContext,
        'my-custom-trace-id',
      );

      const res = await handler(event);
      expect(res.statusCode).toBe(200);
      expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(res.headers['Content-Type']).toBe('application/json');
    });
  });
});
