import type { ScoreBreakdown, ScoringWeights } from '@opslens/contracts';
import {
  DEFAULT_SCORING_WEIGHTS,
  validateWeights,
  type PriorityCalculationInput,
} from './types.js';
import {
  calculateBusinessImpact,
  calculateSafetyRisk,
  calculateSlaUrgency,
  calculateRecurrence,
  calculateDowntime,
} from './factors.js';

/**
 * Pure calculation function that determines the composite priority score and 5-factor breakdown.
 * Time ("now") is passed explicitly; zero I/O or side effects.
 *
 * @param input Incident signals, entity references, and operational details
 * @param weights Configured scoring factor weights (must sum to 1.0 ±0.001)
 * @param now Current point in time for SLA urgency calculation
 * @returns Complete ScoreBreakdown with raw, normalised, weight, contribution, explanation, and total
 */
export function calculatePriority(
  input: PriorityCalculationInput,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
  now: Date = new Date(),
): ScoreBreakdown {
  // Validate weights sum to 1.0 (±0.001)
  validateWeights(weights);

  // 1. Business Impact
  const businessImpact = calculateBusinessImpact(
    {
      affectedOrders: input.affectedOrders,
      blockedThroughputSignals: input.impactSignals,
      assetCriticality: input.assetCriticality,
      description: input.description,
    },
    weights.businessImpact,
  );

  // 2. Safety Risk
  const safetyRisk = calculateSafetyRisk(
    {
      category: input.category,
      severity: input.severity,
      safetySignals: input.impactSignals,
      description: input.description,
    },
    weights.safetyRisk,
  );

  // 3. SLA Urgency
  const slaUrgency = calculateSlaUrgency(
    {
      createdAt: input.createdAt,
      resolveDueAt: input.resolveDueAt,
      ackDueAt: input.ackDueAt,
    },
    weights.slaUrgency,
    now,
  );

  // 4. Recurrence
  // Infer recurrence count from text if not provided explicitly (e.g. "third time this week" -> 3)
  let count30d = input.sameCategoryIncidentCount30Days;
  if (typeof count30d !== 'number') {
    const desc = (input.description || '').toLowerCase();
    if (desc.includes('third time') || desc.includes('3rd time')) {
      count30d = 3;
    } else if (desc.includes('second time') || desc.includes('2nd time') || desc.includes('again')) {
      count30d = 2;
    } else {
      count30d = 0;
    }
  }

  const recurrence = calculateRecurrence(
    {
      sameCategoryIncidentCount30Days: count30d,
      assetId: input.assetId,
      category: input.category,
    },
    weights.recurrence,
  );

  // 5. Downtime
  const downtime = calculateDowntime(
    {
      estimatedStoppageMinutes: input.estimatedStoppageMinutes,
      impactSignals: input.impactSignals,
      description: input.description,
    },
    weights.downtime,
  );

  // Total composite score rounded to integer (0 - 100)
  const sumContribution =
    businessImpact.contribution +
    safetyRisk.contribution +
    slaUrgency.contribution +
    recurrence.contribution +
    downtime.contribution;

  const total = Math.min(100, Math.max(0, Math.round(sumContribution)));

  return {
    businessImpact,
    safetyRisk,
    slaUrgency,
    recurrence,
    downtime,
    total,
  };
}
