import { cosineSimilarity } from './cosine.js';
import type {
  CandidateTarget,
  CandidateIncident,
  RankedCandidate,
  SimilarityThresholds,
  LinkClassification,
} from './types.js';

const TERMINAL_STATUSES = new Set(['RESOLVED', 'CLOSED', 'MERGED']);

/**
 * Pure candidate ranking and relationship classification function.
 *
 * Classification rules (per PRD §FR-4.3):
 * 1. Exclude the target incident itself.
 * 2. If cosine similarity >= duplicateThreshold AND same asset AND candidate is still open (not resolved/closed/merged):
 *    -> DUPLICATE_CANDIDATE
 * 3. Else if cosine similarity >= relatedThreshold:
 *    -> RELATED
 * 4. Else:
 *    -> UNRELATED
 *
 * Generates a one-line human-readable explanation and sorts results descending by similarity score.
 */
export function rankCandidates(
  target: CandidateTarget,
  candidates: CandidateIncident[],
  thresholds: SimilarityThresholds = {},
): RankedCandidate[] {
  const duplicateThreshold = thresholds.duplicateThreshold ?? 0.85;
  const relatedThreshold = thresholds.relatedThreshold ?? 0.70;

  const results: RankedCandidate[] = [];

  for (const candidate of candidates) {
    // Skip self
    if (candidate.id === target.id) {
      continue;
    }

    if (!candidate.embedding || candidate.embedding.length === 0) {
      continue;
    }

    const similarity = cosineSimilarity(target.embedding, candidate.embedding);
    const simPct = (similarity * 100).toFixed(1);

    const sameAsset = Boolean(
      target.assetId && candidate.assetId && target.assetId === candidate.assetId,
    );
    const sameLocation = Boolean(
      target.locationId && candidate.locationId && target.locationId === candidate.locationId,
    );
    const isCandidateOpen = !TERMINAL_STATUSES.has(candidate.status.toUpperCase());

    let classification: LinkClassification;
    let reason: string;

    if (similarity >= duplicateThreshold && sameAsset && isCandidateOpen) {
      classification = 'DUPLICATE_CANDIDATE';
      reason = `Potential duplicate: ${simPct}% semantic similarity on same asset ${target.assetId} with open incident ${candidate.id} (${candidate.status})`;
    } else if (similarity >= relatedThreshold) {
      classification = 'RELATED';
      if (sameAsset) {
        reason = `Related incident: ${simPct}% semantic match on identical asset ${target.assetId}`;
      } else if (sameLocation) {
        reason = `Related incident: ${simPct}% semantic match in common location ${target.locationId}`;
      } else {
        reason = `Related incident: ${simPct}% semantic similarity across operational cues`;
      }
    } else {
      classification = 'UNRELATED';
      reason = `Low similarity (${simPct}%) below correlation threshold`;
    }

    results.push({
      incidentId: candidate.id,
      similarity,
      classification,
      linkType:
        classification === 'DUPLICATE_CANDIDATE'
          ? 'DUPLICATE_CANDIDATE'
          : classification === 'RELATED'
            ? 'RELATED'
            : undefined,
      isDuplicateCandidate: classification === 'DUPLICATE_CANDIDATE',
      isRelated: classification === 'RELATED',
      reason,
      candidate,
    });
  }

  // Sort descending by similarity score
  return results.sort((a, b) => b.similarity - a.similarity);
}
