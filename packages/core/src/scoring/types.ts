import type { ScoringWeights } from '@opslens/contracts';

export type AssetCriticalityTier = 'TIER_1' | 'TIER_2' | 'TIER_3';

export const ASSET_CRITICALITY_MULTIPLIERS: Record<AssetCriticalityTier, number> = {
  TIER_1: 1.0, // Core facility artery (e.g. main sorter, primary conveyor)
  TIER_2: 0.7, // Zone / branch equipment (e.g. secondary forklift, packaging line)
  TIER_3: 0.4, // Peripheral / redundant equipment (e.g. handheld scanner, spare cart)
};

export interface BusinessImpactInput {
  affectedOrders?: number;
  blockedThroughputSignals?: string[];
  assetCriticality?: AssetCriticalityTier | number;
  description?: string;
}

export interface SafetyRiskInput {
  category?: string;
  severity?: string;
  safetySignals?: string[];
  description?: string;
}

export interface SlaUrgencyInput {
  createdAt: string | Date;
  resolveDueAt?: string | Date | null;
  ackDueAt?: string | Date | null;
}

export interface RecurrenceInput {
  sameCategoryIncidentCount30Days: number;
  assetId?: string | null;
  category?: string;
}

export interface DowntimeInput {
  estimatedStoppageMinutes?: number;
  impactSignals?: string[];
  description?: string;
}

export interface PriorityCalculationInput {
  category?: string;
  severity?: string;
  assetId?: string | null;
  locationId?: string | null;
  createdAt: string | Date;
  resolveDueAt?: string | Date | null;
  ackDueAt?: string | Date | null;
  impactSignals?: string[];
  affectedOrders?: number;
  estimatedStoppageMinutes?: number;
  sameCategoryIncidentCount30Days?: number;
  assetCriticality?: AssetCriticalityTier | number;
  description?: string;
}

/**
 * Standard default scoring weights per PRD §FR-3.1.
 */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  businessImpact: 0.3,
  safetyRisk: 0.25,
  slaUrgency: 0.2,
  recurrence: 0.15,
  downtime: 0.1,
};

/**
 * Typed error thrown when tenant scoring weights do not sum to 1.0 (±0.001)
 * or individual weights are out of range.
 */
export class InvalidWeightsError extends Error {
  public readonly sum: number;
  public readonly weights: ScoringWeights;

  constructor(message: string, sum: number, weights: ScoringWeights) {
    super(message);
    this.name = 'InvalidWeightsError';
    this.sum = sum;
    this.weights = weights;
  }
}

/**
 * Validates that scoring weights sum to 1.0 (±0.001) and all values are between 0 and 1.
 */
export function validateWeights(weights: ScoringWeights): void {
  const values = [
    weights.businessImpact,
    weights.safetyRisk,
    weights.slaUrgency,
    weights.recurrence,
    weights.downtime,
  ];

  for (const [key, val] of Object.entries(weights)) {
    if (typeof val !== 'number' || Number.isNaN(val) || val < 0 || val > 1) {
      throw new InvalidWeightsError(
        `Invalid weight for factor '${key}': must be a number between 0 and 1 (received ${val})`,
        values.reduce((a, b) => a + b, 0),
        weights,
      );
    }
  }

  const sum = values.reduce((acc, v) => acc + v, 0);
  const diff = Math.abs(sum - 1.0);

  if (diff > 0.001) {
    throw new InvalidWeightsError(
      `Scoring weights must sum to 1.0 (±0.001); current sum is ${sum.toFixed(4)}`,
      sum,
      weights,
    );
  }
}
