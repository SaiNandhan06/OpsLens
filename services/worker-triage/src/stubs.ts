import type {
  Incident,
  TriageResult,
  ScoreBreakdown,
} from '@opslens/contracts';
import { calculatePriority, type AssetCriticalityTier } from '@opslens/core';

export interface ScoringStubInput {
  tenantId: string;
  incident: Incident;
  triageResult: TriageResult;
  correlationId: string;
  assetCriticality?: AssetCriticalityTier | number;
  prior30DayCount?: number;
}

export interface ScoringStubOutput {
  priorityScore: number;
  scoreBreakdown: ScoreBreakdown;
}

export interface DedupeStubInput {
  tenantId: string;
  incident: Incident;
  triageResult: TriageResult;
  correlationId: string;
}

export interface DedupeStubOutput {
  isDuplicate: boolean;
  canonicalIncidentId: string | null;
}

export interface RoutingStubInput {
  tenantId: string;
  incident: Incident;
  triageResult: TriageResult;
  correlationId: string;
}

export interface RoutingStubOutput {
  assignedTeamId: string | null;
  ruleId?: string;
  reason?: string;
}

/**
 * Pure scoring calculation wired to @opslens/core priority calculation engine.
 */
export async function executeScoringStub(
  input: ScoringStubInput,
): Promise<ScoringStubOutput> {
  const breakdown = calculatePriority({
    category: input.triageResult.category || input.incident.category,
    severity: input.triageResult.severity || input.incident.severity,
    assetId: input.triageResult.assetId || input.incident.assetId,
    locationId: input.triageResult.locationId || input.incident.locationId,
    createdAt: input.incident.createdAt,
    resolveDueAt: input.incident.resolveDueAt,
    ackDueAt: input.incident.ackDueAt,
    impactSignals: input.triageResult.impactSignals,
    description: input.incident.description,
    assetCriticality: input.assetCriticality,
    sameCategoryIncidentCount30Days: input.prior30DayCount ?? 0,
  });

  return {
    priorityScore: breakdown.total,
    scoreBreakdown: breakdown,
  };
}

/**
 * Clearly-named stub function for the deduplication phase.
 * To be implemented in Task B11 (Deduplication & embeddings).
 */
export async function executeDedupeStub(
  _input: DedupeStubInput,
): Promise<DedupeStubOutput> {
  return {
    isDuplicate: false,
    canonicalIncidentId: null,
  };
}

/**
 * Clearly-named stub function for the routing phase.
 * To be implemented in Task B12 (Routing engine).
 */
export async function executeRoutingStub(
  _input: RoutingStubInput,
): Promise<RoutingStubOutput> {
  return {
    assignedTeamId: null,
  };
}
