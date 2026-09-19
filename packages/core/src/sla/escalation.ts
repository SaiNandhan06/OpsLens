import type { Incident } from '@opslens/contracts';
import type { EscalationResolution } from './types.js';

export interface EscalationOptions {
  cooldownMinutes?: number;
  ignoreCooldown?: boolean;
}

/**
 * Evaluates the next escalation tier for a breached incident.
 * Progression:
 *   Level 0 -> Level 1: Assignee / On-duty team responder
 *   Level 1 -> Level 2: Team Supervisor
 *   Level 2 -> Level 3: Operations Manager (Top of ladder)
 *   Level >= 3: null (stop escalating; sweeper marks slaBreached)
 *
 * Enforces idempotency via cooldown and single-fire per level.
 */
export function nextEscalationLevel(
  incident: Pick<Incident, 'assignedTeamId' | 'metadata'> & { escalationLevel?: number },
  now: Date = new Date(),
  options: EscalationOptions = {},
): EscalationResolution | null {
  const currentLevel = incident.escalationLevel ?? 0;

  // 1. If already at top of ladder (Level 3), stop escalating
  if (currentLevel >= 3) {
    return null;
  }

  // 2. Cooldown check for levels > 0: do not double-escalate within cooldown window
  const cooldownMinutes = options.cooldownMinutes ?? 10;
  if (currentLevel > 0 && !options.ignoreCooldown) {
    const lastEscalatedAt = incident.metadata?.lastEscalatedAt as string | undefined;
    if (lastEscalatedAt) {
      const lastMs = new Date(lastEscalatedAt).getTime();
      const elapsedMinutes = (now.getTime() - lastMs) / (60 * 1000);
      if (elapsedMinutes < cooldownMinutes) {
        return null;
      }
    }
  }

  const assignedTeam = incident.assignedTeamId || 'TEAM-LOGISTICS';

  // 3. Resolve next tier
  switch (currentLevel) {
    case 0:
      return {
        nextLevel: 1,
        role: 'assignee',
        targetTeamId: assignedTeam,
        label: 'Team Assignee',
        reason: `Level 1 Escalation: Direct notification to on-duty personnel of team ${assignedTeam}`,
      };
    case 1:
      return {
        nextLevel: 2,
        role: 'supervisor',
        targetTeamId: assignedTeam,
        label: 'Team Supervisor',
        reason: `Level 2 Escalation: Alert dispatched to Team Supervisor for ${assignedTeam}`,
      };
    case 2:
      return {
        nextLevel: 3,
        role: 'manager',
        targetTeamId: 'TEAM-OPERATIONS',
        label: 'Operations Manager',
        reason: `Level 3 Escalation: Highest-tier notification to Facility Operations Management`,
      };
    default:
      return null;
  }
}
