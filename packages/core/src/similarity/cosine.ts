/**
 * Pure cosine similarity calculation between two numeric vectors.
 *
 * Returns a value between -1.0 and 1.0 (typically 0.0 to 1.0 for normalized embeddings).
 * Returns 0.0 if vectors are empty, mismatched in length, or have zero magnitude.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const valA = a[i]!;
    const valB = b[i]!;
    dot += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }

  if (normA <= 0 || normB <= 0) {
    return 0;
  }

  const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB));

  // Clamp floating point rounding anomalies
  const clamped = Math.max(-1, Math.min(1, similarity));
  return Math.round(clamped * 10000) / 10000;
}
