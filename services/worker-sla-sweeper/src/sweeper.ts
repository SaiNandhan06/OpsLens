import { ulid } from 'ulid';
import type {
  ScoringWeights,
  Severity,
  IncidentCategory,
} from '@opslens/contracts';
import {
  IncidentRepository,
  TimelineRepository,
  ReferenceRepository,
} from '@opslens/data';
import {
  evaluateBreach,
  nextEscalationLevel,
  calculatePriority,
  DEFAULT_SCORING_WEIGHTS,
} from '@opslens/core';
import { logger } from '@opslens/platform';
import {
  publishSlaBreachedEvent,
  publishIncidentEscalatedEvent,
} from './eventbridge.js';

export interface SlaSweeperOptions {
  now?: Date;
  tenants?: string[];
  incidentRepo?: IncidentRepository;
  timelineRepo?: TimelineRepository;
  referenceRepo?: ReferenceRepository;
}

export interface SlaSweeperResult {
  evaluatedCount: number;
  breachedCount: number;
  escalatedCount: number;
  rescoredCount: number;
  tenantsEvaluated: string[];
}

/**
 * Sweeps active SLA deadlines across all tenants using GSI3 (Limit: 100, non-scanning).
 * Idempotently evaluates breaches, advances the escalation ladder, appends timeline events,
 * dispatches notifications, and refreshes SLA urgency so ageing incidents climb the queue.
 */
export async function runSlaSweeper(
  options: SlaSweeperOptions = {},
): Promise<SlaSweeperResult> {
  const now = options.now || new Date();
  const nowIso = now.toISOString();
  const incidentRepo = options.incidentRepo || new IncidentRepository();
  const timelineRepo = options.timelineRepo || new TimelineRepository();
  const referenceRepo = options.referenceRepo || new ReferenceRepository();

  const tenants: string[] = options.tenants && options.tenants.length > 0
    ? options.tenants
    : ['north-hub', 'south-hub'];

  let totalEvaluated = 0;
  let totalBreached = 0;
  let totalEscalated = 0;
  let totalRescored = 0;

  for (const tenantId of tenants) {
    logger.info('Running SLA sweeper for tenant', { tenantId, now: nowIso });

    // 1. Query GSI3: Earliest due deadline <= now, capped at 100 items (strictly bounded)
    const { items: dueIncidents } = await incidentRepo.queryActiveSla(tenantId, {
      dueBefore: nowIso,
      limit: 100,
      scanIndexForward: true, // Earliest due first
    });

    totalEvaluated += dueIncidents.length;

    // Load tenant scoring weights
    let tenantWeights: ScoringWeights = DEFAULT_SCORING_WEIGHTS;
    try {
      const tenantMeta = await referenceRepo.getTenant(tenantId);
      if (tenantMeta?.scoringWeights) {
        tenantWeights = tenantMeta.scoringWeights as ScoringWeights;
      }
    } catch {
      // Use defaults
    }

    for (const incident of dueIncidents) {
      // 1. Refresh slaUrgency and recompute priority score so ageing incidents climb the queue
      let newBreakdown;
      let newPriorityScore = incident.priorityScore ?? 0;
      try {
        newBreakdown = calculatePriority(
          {
            category: incident.category as IncidentCategory,
            severity: incident.severity as Severity,
            assetId: incident.assetId,
            locationId: incident.locationId,
            createdAt: incident.createdAt,
            resolveDueAt: incident.resolveDueAt,
            ackDueAt: incident.ackDueAt,
            impactSignals: incident.metadata?.impactSignals as string[] | undefined,
            affectedOrders: incident.scoreBreakdown?.businessImpact?.rawValue,
            estimatedStoppageMinutes: incident.scoreBreakdown?.downtime?.rawValue,
            sameCategoryIncidentCount30Days: incident.scoreBreakdown?.recurrence?.rawValue,
            description: incident.description,
          },
          tenantWeights,
          now,
        );

        const hasManualOverride =
          incident.metadata?.manualPriority !== undefined &&
          incident.metadata?.manualPriority !== null;

        newPriorityScore = hasManualOverride
          ? Number(incident.metadata!.manualPriority)
          : newBreakdown.total;
      } catch (rescoreErr: any) {
        logger.error('Failed to calculate priority breakdown during sweep', {
          incidentId: incident.id,
          error: rescoreErr.message,
        });
      }

      // 2. Evaluate SLA breach
      const breachType = evaluateBreach(incident, now);
      if (breachType) {
        totalBreached++;
      }

      const currentLevel = incident.escalationLevel ?? 0;
      const dueAt = breachType === 'ACK' ? incident.ackDueAt! : incident.resolveDueAt!;
      const elapsedMinutes = Math.max(
        0,
        Math.round((now.getTime() - new Date(incident.createdAt).getTime()) / 60000),
      );

      // Determine next escalation step if breached
      const nextEscalation = breachType && currentLevel < 3 ? nextEscalationLevel(incident, now) : null;

      if (nextEscalation) {
        const correlationId = ulid();
        const isFirstEscalation = currentLevel === 0;
        const conditionExpression = isFirstEscalation
          ? 'attribute_not_exists(escalationLevel) OR escalationLevel = :currLevel'
          : 'escalationLevel = :currLevel';

        const updatedMetadata = {
          ...(incident.metadata || {}),
          lastEscalatedAt: nowIso,
          escalatedToTeamId: nextEscalation.targetTeamId,
          slaBreachTimer: breachType,
          ...(newBreakdown ? { computedPriorityScore: newBreakdown.total } : {}),
          lastUrgencyRefreshedAt: nowIso,
        };

        try {
          await incidentRepo.update(
            tenantId,
            incident.id,
            {
              escalationLevel: nextEscalation.nextLevel,
              slaBreached: true,
              ...(newBreakdown ? { priorityScore: newPriorityScore, scoreBreakdown: newBreakdown } : {}),
              metadata: updatedMetadata,
            },
            {
              conditionExpression,
              conditionAttributeValues: {
                ':currLevel': currentLevel,
              },
            },
          );

          totalEscalated++;
          totalRescored++;

          // Append SLA_BREACHED timeline event
          await timelineRepo.appendEvent(tenantId, {
            id: ulid(),
            incidentId: incident.id,
            tenantId,
            type: 'SLA_BREACHED',
            actorId: 'system',
            actorRole: 'SYSTEM',
            timestamp: nowIso,
            data: {
              breachType,
              dueAt,
              elapsedMinutes,
              severity: incident.severity,
            },
          });

          // Append ESCALATED timeline event
          await timelineRepo.appendEvent(tenantId, {
            id: ulid(),
            incidentId: incident.id,
            tenantId,
            type: 'ESCALATED',
            actorId: 'system',
            actorRole: 'SYSTEM',
            timestamp: nowIso,
            data: {
              escalationLevel: nextEscalation.nextLevel,
              escalatedToTeamId: nextEscalation.targetTeamId,
              role: nextEscalation.role,
              reason: nextEscalation.reason,
              breachType,
            },
          });

          // Publish SLA_BREACHED event to EventBridge
          await publishSlaBreachedEvent({
            type: 'SLA_BREACHED',
            tenantId,
            incidentId: incident.id,
            correlationId,
            occurredAt: nowIso,
            breachType: breachType!,
            dueAt,
            elapsedMinutes,
            severity: incident.severity,
          });

          // Publish INCIDENT_ESCALATED event to EventBridge
          await publishIncidentEscalatedEvent({
            type: 'INCIDENT_ESCALATED',
            tenantId,
            incidentId: incident.id,
            correlationId,
            occurredAt: nowIso,
            escalationLevel: nextEscalation.nextLevel,
            escalatedToTeamId: nextEscalation.targetTeamId,
            reason: nextEscalation.reason,
          });
        } catch (err: any) {
          if (
            err.name === 'ConditionalCheckFailedException' ||
            err.__type?.includes('ConditionalCheckFailed')
          ) {
            logger.warn('SLA escalation skipped due to conditional check failure (already escalated)', {
              incidentId: incident.id,
              currentLevel,
            });
          } else {
            logger.error('Failed to update incident during escalation', {
              incidentId: incident.id,
              error: err.message,
            });
          }
        }
      } else {
        // No escalation (either not breached, in cooldown, or already at level 3)
        // Perform priority score refresh and set slaBreached if applicable
        try {
          const updatedMetadata = {
            ...(incident.metadata || {}),
            ...(newBreakdown ? { computedPriorityScore: newBreakdown.total } : {}),
            lastUrgencyRefreshedAt: nowIso,
          };

          await incidentRepo.update(tenantId, incident.id, {
            ...(breachType ? { slaBreached: true } : {}),
            ...(newBreakdown ? { priorityScore: newPriorityScore, scoreBreakdown: newBreakdown } : {}),
            metadata: updatedMetadata,
          });

          totalRescored++;
        } catch (rescoreErr: any) {
          logger.error('Failed to refresh SLA urgency score for incident', {
            incidentId: incident.id,
            error: rescoreErr.message,
          });
        }
      }
    }
  }

  logger.info('SLA sweeper completed run', {
    totalEvaluated,
    totalBreached,
    totalEscalated,
    totalRescored,
  });

  return {
    evaluatedCount: totalEvaluated,
    breachedCount: totalBreached,
    escalatedCount: totalEscalated,
    rescoredCount: totalRescored,
    tenantsEvaluated: tenants,
  };
}
