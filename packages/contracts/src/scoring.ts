import { z } from 'zod';

/**
 * Runtime Zod schema for an individual factor in the priority score breakdown.
 */
export const ScoreFactorSchema = z.object({
  rawValue: z.number().describe('Original input value for the scoring factor'),
  normalisedValue: z
    .number()
    .min(0)
    .max(100)
    .describe('Scaled normalized factor score between 0 and 100'),
  weight: z
    .number()
    .min(0)
    .max(1)
    .describe('Configured factor weight multiplier (0 to 1)'),
  contribution: z
    .number()
    .min(0)
    .max(100)
    .describe('Points contributed by this factor to the total priority score'),
  explanation: z
    .string()
    .min(1)
    .describe('Human-readable explanation of why this factor was scored this way'),
});

/**
 * Inferred TypeScript type for a single factor within the priority score breakdown.
 */
export type ScoreFactor = z.infer<typeof ScoreFactorSchema>;

/**
 * Runtime Zod schema for the full priority score breakdown across all five core factors.
 */
export const ScoreBreakdownSchema = z.object({
  businessImpact: ScoreFactorSchema.describe('Calculated business disruption and cost impact'),
  safetyRisk: ScoreFactorSchema.describe('Calculated worker and warehouse safety hazard severity'),
  slaUrgency: ScoreFactorSchema.describe('Urgency based on target time to breach and customer SLAs'),
  recurrence: ScoreFactorSchema.describe('Historical frequency and repeat incident penalty'),
  downtime: ScoreFactorSchema.describe('Direct impact on active operational and line throughput'),
  total: z
    .number()
    .min(0)
    .max(100)
    .describe('Final weighted composite priority score (0 to 100)'),
});

/**
 * Inferred TypeScript type representing the 5-factor priority score calculation breakdown.
 */
export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>;

/**
 * Runtime Zod schema for configurable scoring factor weights.
 */
export const ScoringWeightsSchema = z.object({
  businessImpact: z.number().min(0).max(1),
  safetyRisk: z.number().min(0).max(1),
  slaUrgency: z.number().min(0).max(1),
  recurrence: z.number().min(0).max(1),
  downtime: z.number().min(0).max(1),
});

/**
 * Inferred TypeScript type for tenant scoring weight configuration.
 */
export type ScoringWeights = z.infer<typeof ScoringWeightsSchema>;
