import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  rankCandidates,
  type CandidateTarget,
  type CandidateIncident,
} from '../src/similarity/index.js';

describe('packages/core/src/similarity', () => {
  describe('cosineSimilarity', () => {
    it('returns 1.0 for identical unit vectors', () => {
      const a = [0.6, 0.8, 0.0];
      const b = [0.6, 0.8, 0.0];
      expect(cosineSimilarity(a, b)).toBe(1.0);
    });

    it('returns 1.0 for collinear vectors with different magnitudes', () => {
      const a = [1, 2, 3];
      const b = [2, 4, 6];
      expect(cosineSimilarity(a, b)).toBe(1.0);
    });

    it('returns 0.0 for orthogonal vectors', () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      expect(cosineSimilarity(a, b)).toBe(0.0);
    });

    it('returns -1.0 for opposite vectors', () => {
      const a = [1, 0];
      const b = [-1, 0];
      expect(cosineSimilarity(a, b)).toBe(-1.0);
    });

    it('returns 0.0 for mismatched lengths or empty vectors', () => {
      expect(cosineSimilarity([], [])).toBe(0.0);
      expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0.0);
      expect(cosineSimilarity([0, 0], [1, 1])).toBe(0.0);
    });

    it('correctly calculates known angle (45 degrees -> ~0.7071)', () => {
      const a = [1, 0];
      const b = [1, 1];
      const sim = cosineSimilarity(a, b);
      expect(sim).toBeCloseTo(0.7071, 3);
    });
  });

  describe('rankCandidates', () => {
    const targetVector = [1, 0, 0, 0];
    const target: CandidateTarget = {
      id: '01TARGET',
      embedding: targetVector,
      assetId: 'CONV-01',
      locationId: 'LOC-DOCK-1',
      category: 'EQUIPMENT',
      status: 'TRIAGING',
      createdAt: '2026-09-19T06:00:00Z',
    };

    it('excludes the target incident itself', () => {
      const candidates: CandidateIncident[] = [
        {
          id: '01TARGET',
          embedding: targetVector,
          assetId: 'CONV-01',
          locationId: 'LOC-DOCK-1',
          status: 'NEW',
          createdAt: '2026-09-19T06:00:00Z',
        },
      ];

      const ranked = rankCandidates(target, candidates);
      expect(ranked).toHaveLength(0);
    });

    it('skips candidates without embeddings', () => {
      const candidates: CandidateIncident[] = [
        {
          id: '01NOEMBED',
          assetId: 'CONV-01',
          locationId: 'LOC-DOCK-1',
          status: 'NEW',
          createdAt: '2026-09-19T06:00:00Z',
        },
      ];

      const ranked = rankCandidates(target, candidates);
      expect(ranked).toHaveLength(0);
    });

    it('classifies as DUPLICATE_CANDIDATE when similarity >= 0.85, same asset, and open', () => {
      const duplicateCandidate: CandidateIncident = {
        id: '01DUP',
        embedding: [0.95, 0.05, 0, 0], // Sim > 0.95
        assetId: 'CONV-01',
        locationId: 'LOC-DOCK-1',
        status: 'NEW',
        createdAt: '2026-09-19T05:00:00Z',
      };

      const ranked = rankCandidates(target, [duplicateCandidate], {
        duplicateThreshold: 0.85,
        relatedThreshold: 0.70,
      });

      expect(ranked).toHaveLength(1);
      expect(ranked[0]?.classification).toBe('DUPLICATE_CANDIDATE');
      expect(ranked[0]?.isDuplicateCandidate).toBe(true);
      expect(ranked[0]?.isRelated).toBe(false);
      expect(ranked[0]?.linkType).toBe('DUPLICATE_CANDIDATE');
      expect(ranked[0]?.reason).toContain('Potential duplicate');
      expect(ranked[0]?.reason).toContain('CONV-01');
    });

    it('downgrades to RELATED if similarity >= 0.85 and same asset but candidate is RESOLVED/CLOSED/MERGED', () => {
      const resolvedCandidate: CandidateIncident = {
        id: '01RESOLVED',
        embedding: [0.95, 0.05, 0, 0],
        assetId: 'CONV-01',
        locationId: 'LOC-DOCK-1',
        status: 'RESOLVED',
        createdAt: '2026-09-18T05:00:00Z',
      };

      const ranked = rankCandidates(target, [resolvedCandidate]);
      expect(ranked[0]?.classification).toBe('RELATED');
      expect(ranked[0]?.isDuplicateCandidate).toBe(false);
      expect(ranked[0]?.isRelated).toBe(true);
      expect(ranked[0]?.linkType).toBe('RELATED');
    });

    it('classifies as RELATED when similarity >= 0.70 but on different asset or location', () => {
      const relatedCandidate: CandidateIncident = {
        id: '01RELATED',
        embedding: [0.75, 0.25, 0, 0], // Sim ~0.75
        assetId: 'CONV-02',
        locationId: 'LOC-DOCK-1',
        status: 'NEW',
        createdAt: '2026-09-19T05:00:00Z',
      };

      const ranked = rankCandidates(target, [relatedCandidate]);
      expect(ranked[0]?.classification).toBe('RELATED');
      expect(ranked[0]?.isRelated).toBe(true);
      expect(ranked[0]?.isDuplicateCandidate).toBe(false);
      expect(ranked[0]?.reason).toContain('Related incident');
    });

    it('classifies as UNRELATED when similarity < 0.70', () => {
      const unrelatedCandidate: CandidateIncident = {
        id: '01UNRELATED',
        embedding: [0.2, 0.8, 0, 0], // Sim ~0.2
        assetId: 'FORK-09',
        locationId: 'LOC-AISLE-3',
        status: 'NEW',
        createdAt: '2026-09-19T05:00:00Z',
      };

      const ranked = rankCandidates(target, [unrelatedCandidate]);
      expect(ranked[0]?.classification).toBe('UNRELATED');
      expect(ranked[0]?.isDuplicateCandidate).toBe(false);
      expect(ranked[0]?.isRelated).toBe(false);
      expect(ranked[0]?.linkType).toBeUndefined();
    });

    it('sorts candidates descending by similarity score', () => {
      const candidates: CandidateIncident[] = [
        { id: 'LOW', embedding: [0.5, 0.5, 0, 0], status: 'NEW', createdAt: '2026-09-19T05:00:00Z' },
        { id: 'HIGH', embedding: [0.95, 0.05, 0, 0], status: 'NEW', createdAt: '2026-09-19T05:00:00Z' },
        { id: 'MED', embedding: [0.75, 0.25, 0, 0], status: 'NEW', createdAt: '2026-09-19T05:00:00Z' },
      ];

      const ranked = rankCandidates(target, candidates);
      expect(ranked.map((r) => r.incidentId)).toEqual(['HIGH', 'MED', 'LOW']);
      expect(ranked[0]!.similarity).toBeGreaterThan(ranked[1]!.similarity);
      expect(ranked[1]!.similarity).toBeGreaterThan(ranked[2]!.similarity);
    });
  });
});
