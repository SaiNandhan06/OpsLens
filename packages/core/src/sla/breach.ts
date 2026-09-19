import type { Incident } from '@opslens/contracts';
import type { SlaBreachTimer } from './types.js';

/**
 * Evaluates whether an incident has breached an active SLA deadline at the given point in time.
 * Returns which timer ('ACK' or 'RESOLVE') breached first, or null if within SLA.
 */
export function evaluateBreach(
  incident: Pick<Incident, 'status' | 'acknowledgedAt' | 'ackDueAt' | 'resolveDueAt' | 'resolvedAt'>,
  now: Date = new Date(),
): SlaBreachTimer | null {
  const nowMs = now.getTime();

  // 1. Check Acknowledgment deadline breach
  // An ACK breach occurs if unacknowledged and current time is past ackDueAt
  if (!incident.acknowledgedAt && incident.ackDueAt) {
    const ackDueMs = new Date(incident.ackDueAt).getTime();
    if (nowMs >= ackDueMs) {
      return 'ACK';
    }
  }

  // 2. Check Resolution deadline breach
  // A RESOLVE breach occurs if unresolved and current time is past resolveDueAt
  if (!incident.resolvedAt && incident.resolveDueAt) {
    const resolveDueMs = new Date(incident.resolveDueAt).getTime();
    if (nowMs >= resolveDueMs) {
      return 'RESOLVE';
    }
  }

  return null;
}
