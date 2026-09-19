import { ulid } from 'ulid';
import { TimelineRepository } from '@opslens/data';
import { logger } from '@opslens/platform';
import { sendSnsNotification } from './sns.js';

export interface ProcessNotificationResult {
  eventType: string;
  incidentId: string;
  tenantId: string;
  recipient: string;
  subject: string;
  message: string;
  deepLink: string;
  snsDispatched: boolean;
  timelineEventId: string;
}

/**
 * Handles incoming EventBridge events for OpsLens:
 *   - INCIDENT_ROUTED
 *   - SLA_BREACHED
 *   - INCIDENT_ESCALATED
 *   - INCIDENT_NEEDS_INFO
 *
 * Formats a concise operational message with deep link, sends via SNS,
 * and records a timeline event on the incident.
 */
export async function processNotificationEvent(
  eventDetail: Record<string, any>,
  detailType?: string,
  timelineRepo = new TimelineRepository(),
): Promise<ProcessNotificationResult | null> {
  const eventType = eventDetail.type || detailType || '';
  const tenantId = eventDetail.tenantId;
  const incidentId = eventDetail.incidentId;

  if (!tenantId || !incidentId) {
    logger.warn('Notification event missing tenantId or incidentId, skipping', { eventDetail });
    return null;
  }

  const deepLink = `https://app.opslens.internal/incidents/${incidentId}`;
  let recipient = 'team';
  let subject = '';
  let message = '';

  switch (eventType) {
    case 'INCIDENT_ROUTED': {
      const teamId = eventDetail.assignedTeamId || 'assigned-team';
      recipient = teamId;
      subject = `[OpsLens] Incident Dispatched: ${incidentId}`;
      message = `Incident ${incidentId} has been routed to team ${teamId}. Reason: "${eventDetail.reason || 'Policy match'}". View incident: ${deepLink}`;
      break;
    }

    case 'SLA_BREACHED': {
      recipient = 'team-supervisors';
      const breachType = eventDetail.breachType || 'SLA';
      const elapsed = eventDetail.elapsedMinutes ? `${eventDetail.elapsedMinutes}m` : 'overdue';
      subject = `[OpsLens ALERT] SLA ${breachType} Breached: ${incidentId}`;
      message = `SLA ${breachType} target (${eventDetail.dueAt || 'deadline'}) breached for ${eventDetail.severity || 'HIGH'} incident ${incidentId} (${elapsed} elapsed). View incident: ${deepLink}`;
      break;
    }

    case 'INCIDENT_ESCALATED': {
      recipient = eventDetail.escalatedToTeamId || 'escalation-tier';
      const level = eventDetail.escalationLevel ?? 1;
      subject = `[OpsLens ESCALATION] Tier ${level}: ${incidentId}`;
      message = `Incident ${incidentId} escalated to Level ${level} (${recipient}). Reason: ${eventDetail.reason || 'SLA breach'}. View incident: ${deepLink}`;
      break;
    }

    case 'INCIDENT_NEEDS_INFO': {
      recipient = 'reporter';
      subject = `[OpsLens] Clarification Required for Incident ${incidentId}`;
      message = `Your report requires clarification: "${eventDetail.question || 'Please provide more details'}". Answer here: ${deepLink}`;
      break;
    }

    default:
      logger.info('Unhandled event type for notification dispatcher', { eventType });
      return null;
  }

  // 1. Dispatch SNS notification
  const snsResult = await sendSnsNotification({
    subject,
    message,
    recipient,
    eventType,
    incidentId,
    tenantId,
  });

  // 2. Record timeline event on the incident
  const nowIso = new Date().toISOString();
  const timelineEventId = ulid();

  await timelineRepo.appendEvent(tenantId, {
    id: timelineEventId,
    incidentId,
    tenantId,
    type: 'COMMENT_ADDED',
    actorId: 'system',
    actorRole: 'SYSTEM',
    timestamp: nowIso,
    data: {
      action: 'NOTIFICATION_SENT',
      channel: 'SNS',
      eventType,
      recipient,
      subject,
      message,
      deepLink,
      snsMessageId: snsResult.messageId || null,
    },
  });

  return {
    eventType,
    incidentId,
    tenantId,
    recipient,
    subject,
    message,
    deepLink,
    snsDispatched: snsResult.success,
    timelineEventId,
  };
}
