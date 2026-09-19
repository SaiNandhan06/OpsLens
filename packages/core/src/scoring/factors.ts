import type { ScoreFactor } from '@opslens/contracts';
import {
  ASSET_CRITICALITY_MULTIPLIERS,
  type BusinessImpactInput,
  type SafetyRiskInput,
  type SlaUrgencyInput,
  type RecurrenceInput,
  type DowntimeInput,
} from './types.js';

function clamp(val: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, val));
}

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

/**
 * 1. Business Impact Factor (Weight: 0.30 default)
 * Derived from affected orders/shipments, blocked throughput signals, and asset criticality.
 */
export function calculateBusinessImpact(
  input: BusinessImpactInput,
  weight = 0.3,
): ScoreFactor {
  const normDesc = (input.description || '').toLowerCase();
  const signals = (input.blockedThroughputSignals || []).map((s) => s.toLowerCase());

  // Determine affected orders count
  let affectedOrders = input.affectedOrders;
  if (typeof affectedOrders !== 'number' || affectedOrders < 0) {
    if (
      normDesc.includes('packages piling up') ||
      normDesc.includes('conveyor stopped') ||
      signals.some((s) => s.includes('piling') || s.includes('backlog'))
    ) {
      affectedOrders = 150; // Major line obstruction on primary sorter
    } else if (normDesc.includes('stopped') || normDesc.includes('blocked')) {
      affectedOrders = 80;
    } else if (normDesc.includes('delay') || normDesc.includes('slow') || normDesc.includes('warning')) {
      affectedOrders = 35;
    } else {
      affectedOrders = 5;
    }
  }

  // Base score from affected orders count
  let base: number;
  if (affectedOrders >= 100) {
    base = clamp(85 + Math.round(((affectedOrders - 100) / 50) * 15), 85, 100);
  } else if (affectedOrders >= 50) {
    base = clamp(65 + Math.round(((affectedOrders - 50) / 50) * 19), 65, 84);
  } else if (affectedOrders >= 15) {
    base = clamp(35 + Math.round(((affectedOrders - 15) / 35) * 29), 35, 64);
  } else if (affectedOrders >= 1) {
    base = clamp(15 + Math.round((affectedOrders / 14) * 19), 15, 34);
  } else {
    base = 10;
  }

  // Asset Criticality Tier Multiplier
  let critMultiplier = 1.0;
  if (typeof input.assetCriticality === 'number') {
    critMultiplier = clamp(input.assetCriticality, 0.1, 1.5);
  } else if (input.assetCriticality && input.assetCriticality in ASSET_CRITICALITY_MULTIPLIERS) {
    critMultiplier = ASSET_CRITICALITY_MULTIPLIERS[input.assetCriticality];
  } else if (normDesc.includes('conveyor') || normDesc.includes('conv-d4') || normDesc.includes('sorter')) {
    critMultiplier = ASSET_CRITICALITY_MULTIPLIERS.TIER_1;
  }

  const normalisedValue = clamp(Math.round(base * critMultiplier));
  const contribution = round1(normalisedValue * weight);

  let explanation: string;
  if (normalisedValue >= 80) {
    explanation = `Major bottleneck: line stoppage with backlog exceeding ${affectedOrders} packages on critical sorting equipment.`;
  } else if (normalisedValue >= 50) {
    explanation = `Moderate throughput disruption affecting an estimated ${affectedOrders} orders on the operational line.`;
  } else if (normalisedValue >= 25) {
    explanation = `Localized throughput delay affecting approximately ${affectedOrders} orders with minimal line disruption.`;
  } else {
    explanation = `Negligible business impact with no active orders obstructed on the warehouse floor.`;
  }

  return {
    rawValue: affectedOrders,
    normalisedValue,
    weight,
    contribution,
    explanation,
  };
}

/**
 * 2. Safety Risk Factor (Weight: 0.25 default)
 * Derived from safety signals and category.
 * STRICT RULE: Any SAFETY or SAFETY_INCIDENT category floors safetyRisk at 70.
 */
export function calculateSafetyRisk(
  input: SafetyRiskInput,
  weight = 0.25,
): ScoreFactor {
  const normCat = (input.category || '').toUpperCase();
  const normDesc = (input.description || '').toLowerCase();
  const signals = (input.safetySignals || []).map((s) => s.toLowerCase());

  let rawValue = 0;
  let hasCriticalHazard = false;
  let hasActiveHazard = false;

  const criticalKeywords = ['injury', 'fire', 'explosion', 'chemical', 'acid', 'ammonia', 'blood', 'fatal'];
  const activeKeywords = ['smoke', 'overheating', 'hot motor', 'spill', 'slip hazard', 'trip hazard', 'hazard', 'leak', 'exposed wire'];
  const moderateKeywords = ['tripped', 'breaker', 'loose', 'piling up', 'jam', 'conveyor stopped'];

  if (
    criticalKeywords.some((kw) => normDesc.includes(kw) || signals.some((s) => s.includes(kw)))
  ) {
    rawValue = 95;
    hasCriticalHazard = true;
  } else if (
    activeKeywords.some((kw) => normDesc.includes(kw) || signals.some((s) => s.includes(kw)))
  ) {
    rawValue = 80;
    hasActiveHazard = true;
  } else if (
    moderateKeywords.some((kw) => normDesc.includes(kw) || signals.some((s) => s.includes(kw)))
  ) {
    rawValue = 60;
  } else {
    rawValue = 10;
  }

  // Enforce mandatory floor of 70 for SAFETY categories
  const isSafetyCategory = normCat === 'SAFETY' || normCat === 'SAFETY_INCIDENT';
  const normalisedValue = isSafetyCategory ? Math.max(70, rawValue) : rawValue;
  const contribution = round1(normalisedValue * weight);

  let explanation: string;
  if (hasCriticalHazard) {
    explanation = `Immediate life-safety hazard: severe risk condition detected requiring instant zone evacuation or first aid.`;
  } else if (isSafetyCategory && rawValue < 70) {
    explanation = `Safety category classification enforces a mandatory minimum safety floor of 70 points for warehouse worker protection.`;
  } else if (hasActiveHazard || normalisedValue >= 70) {
    explanation = `Active hazard risk: environmental or equipment safety cues detected posing elevated danger on the work floor.`;
  } else if (normalisedValue >= 40) {
    explanation = `Precautionary safety condition: electrical or mechanical trip hazard flagged for technician inspection.`;
  } else {
    explanation = `Clean safety assessment: no immediate physical or environmental hazards identified in the work area.`;
  }

  return {
    rawValue,
    normalisedValue,
    weight,
    contribution,
    explanation,
  };
}

/**
 * 3. SLA Urgency Factor (Weight: 0.20 default)
 * Derived from time remaining against the SLA window.
 * 0 when window just started, climbing to 100 at or past the deadline.
 */
export function calculateSlaUrgency(
  input: SlaUrgencyInput,
  weight = 0.2,
  now = new Date(),
): ScoreFactor {
  const startMs = new Date(input.createdAt).getTime();
  const nowMs = now.getTime();

  // If resolve deadline not provided, default to a 90-minute operational window
  let dueMs: number;
  if (input.resolveDueAt) {
    dueMs = new Date(input.resolveDueAt).getTime();
  } else if (input.ackDueAt) {
    dueMs = new Date(input.ackDueAt).getTime();
  } else {
    dueMs = startMs + 90 * 60 * 1000;
  }

  const totalWindowMs = Math.max(60000, dueMs - startMs);
  const elapsedMs = nowMs - startMs;
  const elapsedMinutes = Math.max(0, Math.round(elapsedMs / 60000));
  const remainingMinutes = Math.round((dueMs - nowMs) / 60000);

  let normalisedValue: number;
  if (nowMs >= dueMs) {
    normalisedValue = 100;
  } else if (elapsedMs <= 0) {
    normalisedValue = 0;
  } else {
    const fraction = elapsedMs / totalWindowMs;
    normalisedValue = clamp(Math.round(fraction * 100));
  }

  const contribution = round1(normalisedValue * weight);

  let explanation: string;
  if (nowMs >= dueMs) {
    explanation = `SLA deadline breached: ${Math.abs(remainingMinutes)} minutes overdue past target resolution window.`;
  } else if (normalisedValue >= 75) {
    explanation = `Critical SLA window: ${normalisedValue}% consumed with only ${remainingMinutes} minutes remaining before breach.`;
  } else if (normalisedValue >= 30) {
    explanation = `Active SLA progression: ${normalisedValue}% of resolution window elapsed (${remainingMinutes} minutes remaining).`;
  } else {
    explanation = `Fresh work item: SLA window just initiated with ${remainingMinutes} minutes remaining to meet target.`;
  }

  return {
    rawValue: elapsedMinutes,
    normalisedValue,
    weight,
    contribution,
    explanation,
  };
}

/**
 * 4. Recurrence Factor (Weight: 0.15 default)
 * Derived from count of same-category incidents on the same asset in the last 30 days.
 * Mapped: 0 → 0, 1 → 30, 2 → 60, 3+ → 100.
 */
export function calculateRecurrence(
  input: RecurrenceInput,
  weight = 0.15,
): ScoreFactor {
  const rawValue = Math.max(0, input.sameCategoryIncidentCount30Days || 0);

  let normalisedValue: number;
  if (rawValue <= 0) {
    normalisedValue = 0;
  } else if (rawValue === 1) {
    normalisedValue = 30;
  } else if (rawValue === 2) {
    normalisedValue = 60;
  } else {
    normalisedValue = 100;
  }

  const contribution = round1(normalisedValue * weight);
  const assetName = input.assetId ? `asset ${input.assetId}` : 'this asset';

  let explanation: string;
  if (rawValue >= 3) {
    explanation = `Chronic failure pattern: ${rawValue} repeated stoppages on ${assetName} in the last 30 days (maximum recurrence penalty).`;
  } else if (rawValue === 2) {
    explanation = `Repeated issue: 2 previous same-category incidents logged on ${assetName} in the last 30 days.`;
  } else if (rawValue === 1) {
    explanation = `Second occurrence: 1 prior incident recorded on ${assetName} within the past 30 days.`;
  } else {
    explanation = `First occurrence: no prior same-category incidents recorded on ${assetName} in the past 30 days.`;
  }

  return {
    rawValue,
    normalisedValue,
    weight,
    contribution,
    explanation,
  };
}

/**
 * 5. Downtime Factor (Weight: 0.10 default)
 * Derived from estimated or observed stoppage minutes mapped through operational bands:
 *   0 - 5 min   → 15
 *   6 - 15 min  → 40
 *   16 - 30 min → 65
 *   31 - 60 min → 85
 *   > 60 min    → 100
 */
export function calculateDowntime(
  input: DowntimeInput,
  weight = 0.1,
): ScoreFactor {
  const normDesc = (input.description || '').toLowerCase();
  const signals = (input.impactSignals || []).map((s) => s.toLowerCase());

  let rawValue = input.estimatedStoppageMinutes;
  if (typeof rawValue !== 'number' || rawValue < 0) {
    if (
      normDesc.includes('stopped again') ||
      normDesc.includes('third time') ||
      normDesc.includes('packages piling up') ||
      signals.some((s) => s.includes('piling') || s.includes('stopped'))
    ) {
      rawValue = 45; // Documented golden path band: 31-60 min
    } else if (normDesc.includes('stopped') || normDesc.includes('halted') || normDesc.includes('down')) {
      rawValue = 25;
    } else if (normDesc.includes('delay') || normDesc.includes('slow')) {
      rawValue = 10;
    } else {
      rawValue = 3;
    }
  }

  let normalisedValue: number;
  if (rawValue <= 5) {
    normalisedValue = 15;
  } else if (rawValue <= 15) {
    normalisedValue = 40;
  } else if (rawValue <= 30) {
    normalisedValue = 65;
  } else if (rawValue <= 60) {
    normalisedValue = 85;
  } else {
    normalisedValue = 100;
  }

  const contribution = round1(normalisedValue * weight);

  let explanation: string;
  if (rawValue > 60) {
    explanation = `Critical stoppage: over 60 minutes (${rawValue} mins) of continuous line downtime disrupting shift throughput.`;
  } else if (rawValue > 30) {
    explanation = `Significant stoppage: estimated ${rawValue} minutes of active line downtime causing substantial sorting delay.`;
  } else if (rawValue > 15) {
    explanation = `Moderate delay: estimated ${rawValue} minutes of equipment downtime with localized throughput backlog.`;
  } else if (rawValue > 5) {
    explanation = `Minor line pause: estimated ${rawValue} minutes of downtime quickly recoverable by floor personnel.`;
  } else {
    explanation = `Brief interruption: under 5 minutes of downtime with negligible operational stoppage.`;
  }

  return {
    rawValue,
    normalisedValue,
    weight,
    contribution,
    explanation,
  };
}
