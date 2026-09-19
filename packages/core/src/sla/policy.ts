import type { IncidentCategory, Severity, SlaPolicy } from '@opslens/contracts';
import type { SlaPolicyResolution, DueDates } from './types.js';

/**
 * Standard default SLA matrix (acknowledgment minutes / resolution minutes) across categories & severities.
 * Aligned with seed/sla-policies.json.
 */
const DEFAULT_SLA_MATRIX: Record<
  IncidentCategory,
  Record<Severity, { ackMinutes: number; resolveMinutes: number; escalationTeamId?: string }>
> = {
  EQUIPMENT: {
    CRITICAL: { ackMinutes: 10, resolveMinutes: 60, escalationTeamId: 'TEAM-MAINT' },
    HIGH: { ackMinutes: 20, resolveMinutes: 120, escalationTeamId: 'TEAM-MAINT' },
    MEDIUM: { ackMinutes: 60, resolveMinutes: 360, escalationTeamId: 'TEAM-MAINT' },
    LOW: { ackMinutes: 120, resolveMinutes: 720, escalationTeamId: 'TEAM-MAINT' },
  },
  SAFETY: {
    CRITICAL: { ackMinutes: 5, resolveMinutes: 30, escalationTeamId: 'TEAM-SAFETY' },
    HIGH: { ackMinutes: 15, resolveMinutes: 90, escalationTeamId: 'TEAM-SAFETY' },
    MEDIUM: { ackMinutes: 45, resolveMinutes: 240, escalationTeamId: 'TEAM-SAFETY' },
    LOW: { ackMinutes: 120, resolveMinutes: 480, escalationTeamId: 'TEAM-SAFETY' },
  },
  FACILITY: {
    CRITICAL: { ackMinutes: 15, resolveMinutes: 90, escalationTeamId: 'TEAM-FACILITIES' },
    HIGH: { ackMinutes: 30, resolveMinutes: 180, escalationTeamId: 'TEAM-FACILITIES' },
    MEDIUM: { ackMinutes: 90, resolveMinutes: 480, escalationTeamId: 'TEAM-FACILITIES' },
    LOW: { ackMinutes: 180, resolveMinutes: 720, escalationTeamId: 'TEAM-FACILITIES' },
  },
  INVENTORY: {
    CRITICAL: { ackMinutes: 20, resolveMinutes: 120, escalationTeamId: 'TEAM-LOGISTICS' },
    HIGH: { ackMinutes: 45, resolveMinutes: 240, escalationTeamId: 'TEAM-LOGISTICS' },
    MEDIUM: { ackMinutes: 120, resolveMinutes: 480, escalationTeamId: 'TEAM-LOGISTICS' },
    LOW: { ackMinutes: 240, resolveMinutes: 960, escalationTeamId: 'TEAM-LOGISTICS' },
  },
  OPERATIONS: {
    CRITICAL: { ackMinutes: 10, resolveMinutes: 60, escalationTeamId: 'TEAM-OPERATIONS' },
    HIGH: { ackMinutes: 20, resolveMinutes: 120, escalationTeamId: 'TEAM-OPERATIONS' },
    MEDIUM: { ackMinutes: 60, resolveMinutes: 360, escalationTeamId: 'TEAM-OPERATIONS' },
    LOW: { ackMinutes: 120, resolveMinutes: 720, escalationTeamId: 'TEAM-OPERATIONS' },
  },
  ENVIRONMENTAL: {
    CRITICAL: { ackMinutes: 10, resolveMinutes: 60, escalationTeamId: 'TEAM-SAFETY' },
    HIGH: { ackMinutes: 20, resolveMinutes: 120, escalationTeamId: 'TEAM-SAFETY' },
    MEDIUM: { ackMinutes: 60, resolveMinutes: 360, escalationTeamId: 'TEAM-SAFETY' },
    LOW: { ackMinutes: 120, resolveMinutes: 720, escalationTeamId: 'TEAM-SAFETY' },
  },
  SECURITY: {
    CRITICAL: { ackMinutes: 5, resolveMinutes: 30, escalationTeamId: 'TEAM-SAFETY' },
    HIGH: { ackMinutes: 15, resolveMinutes: 90, escalationTeamId: 'TEAM-SAFETY' },
    MEDIUM: { ackMinutes: 60, resolveMinutes: 360, escalationTeamId: 'TEAM-SAFETY' },
    LOW: { ackMinutes: 120, resolveMinutes: 720, escalationTeamId: 'TEAM-SAFETY' },
  },
};

export interface ResolveSlaPolicyOptions {
  customPolicies?: SlaPolicy[];
}

/**
 * Resolves the applicable SLA policy for an incident based on category, severity, and tenant overrides.
 */
export function resolveSlaPolicy(
  tenant: Record<string, unknown> | string | null | undefined,
  category: IncidentCategory,
  severity: Severity,
  options: ResolveSlaPolicyOptions = {},
): SlaPolicyResolution {
  // 1. Check custom policies if provided
  if (options.customPolicies && options.customPolicies.length > 0) {
    const match = options.customPolicies.find(
      (p) => p.category === category && p.severity === severity,
    );
    if (match) {
      return {
        category,
        severity,
        ackMinutes: match.ackTargetMinutes,
        resolveMinutes: match.resolveTargetMinutes,
        escalationTeamId: match.escalationTeamId,
      };
    }
  }

  // 2. Check tenant object for embedded policies
  if (typeof tenant === 'object' && tenant !== null && Array.isArray((tenant as any).slaPolicies)) {
    const tenantPolicies = (tenant as any).slaPolicies as SlaPolicy[];
    const match = tenantPolicies.find(
      (p) => p.category === category && p.severity === severity,
    );
    if (match) {
      return {
        category,
        severity,
        ackMinutes: match.ackTargetMinutes,
        resolveMinutes: match.resolveTargetMinutes,
        escalationTeamId: match.escalationTeamId,
      };
    }
  }

  // 3. Fall back to standard built-in matrix
  const categoryMatrix = DEFAULT_SLA_MATRIX[category] || DEFAULT_SLA_MATRIX.EQUIPMENT;
  const target = categoryMatrix[severity] || categoryMatrix.MEDIUM;

  return {
    category,
    severity,
    ackMinutes: target.ackMinutes,
    resolveMinutes: target.resolveMinutes,
    escalationTeamId: target.escalationTeamId,
  };
}

/**
 * Computes ISO-8601 UTC deadline timestamps given a routed timestamp and SLA policy.
 */
export function computeDueDates(
  routedAt: Date | string,
  policy: { ackMinutes: number; resolveMinutes: number },
): DueDates {
  const startMs = typeof routedAt === 'string' ? new Date(routedAt).getTime() : routedAt.getTime();
  const ackDueMs = startMs + policy.ackMinutes * 60 * 1000;
  const resolveDueMs = startMs + policy.resolveMinutes * 60 * 1000;

  const ackDueAt = new Date(ackDueMs).toISOString();
  const resolveDueAt = new Date(resolveDueMs).toISOString();
  const earliestDueAt = ackDueMs <= resolveDueMs ? ackDueAt : resolveDueAt;

  return {
    ackDueAt,
    resolveDueAt,
    earliestDueAt,
  };
}
