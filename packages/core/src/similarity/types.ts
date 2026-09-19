import type { LinkType } from '@opslens/contracts';

export type LinkClassification = 'DUPLICATE_CANDIDATE' | 'RELATED' | 'UNRELATED';

export interface SimilarityThresholds {
  /**
   * Threshold for flagging duplicate candidates on identical asset (default 0.85, PRD default 0.93)
   */
  duplicateThreshold?: number;

  /**
   * Threshold for flagging related incidents (default 0.70, PRD default 0.86)
   */
  relatedThreshold?: number;
}

export interface CandidateTarget {
  id: string;
  embedding: number[];
  assetId?: string | null;
  locationId?: string | null;
  category?: string;
  status?: string;
  createdAt: string | Date;
}

export interface CandidateIncident {
  id: string;
  embedding?: number[];
  assetId?: string | null;
  locationId?: string | null;
  category?: string;
  status: string;
  createdAt: string | Date;
  title?: string;
  description?: string;
}

export interface RankedCandidate {
  incidentId: string;
  similarity: number;
  classification: LinkClassification;
  linkType?: LinkType;
  isDuplicateCandidate: boolean;
  isRelated: boolean;
  reason: string;
  candidate: CandidateIncident;
}
