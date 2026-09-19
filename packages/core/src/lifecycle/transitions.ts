import { IncidentStatus, IncidentStatusEnum } from '@opslens/contracts';
import { InvalidTransitionError } from '@opslens/platform';

/**
 * Valid state transitions for OpsLens incidents.
 *
 * Primary Lifecycle:
 * NEW -> TRIAGING -> ROUTED -> ACKNOWLEDGED -> IN_PROGRESS -> RESOLVED -> CLOSED
 *
 * Auxiliary Lifecycle States:
 * - NEEDS_INFO: Reached from TRIAGING (low confidence / vague) or IN_PROGRESS (worker query); returns to TRIAGING
 * - REOPENED: Reached from RESOLVED or CLOSED; progresses to TRIAGING, ROUTED, ACKNOWLEDGED, or IN_PROGRESS
 * - MERGED: Terminal duplicate state; can be entered from any non-terminal state; no outgoing transitions
 */
export const VALID_TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  NEW: ['TRIAGING', 'MERGED'],
  TRIAGING: ['ROUTED', 'NEEDS_INFO', 'MERGED'],
  NEEDS_INFO: ['TRIAGING', 'MERGED'],
  ROUTED: ['ACKNOWLEDGED', 'IN_PROGRESS', 'MERGED'],
  ACKNOWLEDGED: ['IN_PROGRESS', 'RESOLVED', 'MERGED'],
  IN_PROGRESS: ['RESOLVED', 'NEEDS_INFO', 'MERGED'],
  RESOLVED: ['CLOSED', 'REOPENED'],
  CLOSED: ['REOPENED'],
  REOPENED: ['TRIAGING', 'ROUTED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'MERGED'],
  MERGED: [],
} as const;

/**
 * All valid incident statuses as an array.
 */
export const ALL_STATUSES: readonly IncidentStatus[] = IncidentStatusEnum.options;

/**
 * Returns true if transitioning from `from` status to `to` status is legal in the state machine.
 */
export function isValidTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  if (from === to) return false;
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/**
 * Asserts that a transition from `from` status to `to` status is legal.
 * Throws InvalidTransitionError (HTTP 409 INCIDENT_INVALID_TRANSITION) if illegal.
 */
export function validateTransition(from: IncidentStatus, to: IncidentStatus): void {
  if (!isValidTransition(from, to)) {
    throw new InvalidTransitionError(
      `Illegal transition from ${from} to ${to}. Valid next states: [${(VALID_TRANSITIONS[from] || []).join(', ')}]`,
      { from, to, allowedTransitions: VALID_TRANSITIONS[from] || [] },
    );
  }
}
