import { ValidationError } from '@opslens/platform';
import type { PresignUploadInput } from './types.js';

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024; // 5MB
export const AUDIO_MAX_BYTES = 10 * 1024 * 1024; // 10MB

export const PHOTO_ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const AUDIO_ALLOWED_TYPES: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3',
};

/**
 * Validates the presign upload request according to PRD constraints:
 * - Photo: <= 5MB and image/jpeg | image/png | image/webp
 * - Audio: <= 10MB and audio/webm | audio/mp4 | audio/mpeg
 * Rejects any deviation with a 400 ValidationError.
 */
export function validatePresignUpload(raw: unknown): {
  input: PresignUploadInput;
  normalizedContentType: string;
  fileExtension: string;
} {
  let body = raw;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      throw new ValidationError('Invalid JSON body');
    }
  }

  if (!body || typeof body !== 'object') {
    throw new ValidationError('Request body must be a JSON object');
  }

  const { kind, contentType, sizeBytes } = body as Record<string, unknown>;

  if (kind !== 'photo' && kind !== 'audio') {
    throw new ValidationError('kind must be either "photo" or "audio"', {
      allowedValues: ['photo', 'audio'],
      received: kind,
    });
  }

  if (typeof contentType !== 'string' || !contentType.trim()) {
    throw new ValidationError('contentType must be a non-empty string');
  }

  if (typeof sizeBytes !== 'number' || !Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new ValidationError('sizeBytes must be a positive integer', {
      received: sizeBytes,
    });
  }

  const cleanContentType = contentType.split(';')[0]!.trim().toLowerCase();

  if (kind === 'photo') {
    if (sizeBytes > PHOTO_MAX_BYTES) {
      throw new ValidationError(`Photo size exceeds 5MB limit (${sizeBytes} bytes provided)`, {
        maxSizeBytes: PHOTO_MAX_BYTES,
        receivedSizeBytes: sizeBytes,
      });
    }

    const ext = PHOTO_ALLOWED_TYPES[cleanContentType];
    if (!ext) {
      throw new ValidationError(
        `Invalid contentType for photo: "${contentType}". Allowed: image/jpeg, image/png, image/webp`,
        {
          allowedContentTypes: Object.keys(PHOTO_ALLOWED_TYPES),
          received: contentType,
        },
      );
    }

    return {
      input: { kind, contentType: cleanContentType, sizeBytes },
      normalizedContentType: cleanContentType,
      fileExtension: ext,
    };
  } else {
    // kind === 'audio'
    if (sizeBytes > AUDIO_MAX_BYTES) {
      throw new ValidationError(`Audio size exceeds 10MB limit (${sizeBytes} bytes provided)`, {
        maxSizeBytes: AUDIO_MAX_BYTES,
        receivedSizeBytes: sizeBytes,
      });
    }

    const ext = AUDIO_ALLOWED_TYPES[cleanContentType];
    if (!ext) {
      throw new ValidationError(
        `Invalid contentType for audio: "${contentType}". Allowed: audio/webm, audio/mp4, audio/mpeg`,
        {
          allowedContentTypes: Object.keys(AUDIO_ALLOWED_TYPES),
          received: contentType,
        },
      );
    }

    return {
      input: { kind, contentType: cleanContentType, sizeBytes },
      normalizedContentType: cleanContentType,
      fileExtension: ext,
    };
  }
}
