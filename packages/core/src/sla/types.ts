import type { IncidentCategory, Severity } from '@opslens/contracts';

/**
 * Resolved SLA policy containing target response windows in minutes.
 */
export interface SlaPolicyResolution {
  category: IncidentCategory;
  severity: Severity;
  ackMinutes: number;
  resolveMinutes: number;
  escalationTeamId?: string;
}

/**
 * Calculated ISO UTC deadline timestamps for an incident.
 */
export interface DueDates {
  ackDueAt: string;
  resolveDueAt: string;
  earliestDueAt: string;
}

/**
 * Which SLA timer has breached.
 */
export type SlaBreachTimer = 'ACK' | 'RESOLVE';

/**
 * Escalation ladder tiers.
 * Tier 1: Assigned team member / on-duty assignee
 * Tier 2: Assigned team supervisor
 * Tier 3: Facility operations manager (top of ladder)
 */
export interface EscalationLadderTier {
  level: number;
  role: 'assignee' | 'supervisor' | 'manager';
  targetTeamId: string;
  label: string;
}

/**
 * Result of evaluating next escalation rung.
 */
export interface EscalationResolution {
  nextLevel: number;
  role: 'assignee' | 'supervisor' | 'manager';
  targetTeamId: string;
  label: string;
  reason: string;
}
