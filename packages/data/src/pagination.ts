/**
 * Base64url cursor encoding and decoding helpers for DynamoDB LastEvaluatedKey.
 */

export function encodeCursor(lastEvaluatedKey?: Record<string, unknown> | null): string | null {
  if (!lastEvaluatedKey || Object.keys(lastEvaluatedKey).length === 0) {
    return null;
  }
  const json = JSON.stringify(lastEvaluatedKey);
  return Buffer.from(json, 'utf-8').toString('base64url');
}

export function decodeCursor(cursor?: string | null): Record<string, unknown> | undefined {
  if (!cursor || typeof cursor !== 'string' || cursor.trim() === '') {
    return undefined;
  }
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf-8');
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}
