import type { EventBridgeEvent, Context } from 'aws-lambda';
import { processNotificationEvent, ProcessNotificationResult } from './notifier.js';
import { logger } from '@opslens/platform';

export * from './notifier.js';
export * from './sns.js';

/**
 * Main Lambda handler for the OpsLens notification dispatcher.
 * Subscribes to INCIDENT_ROUTED, SLA_BREACHED, INCIDENT_ESCALATED, INCIDENT_NEEDS_INFO.
 */
export async function handler(
  event: EventBridgeEvent<string, any>,
  _context?: Context,
): Promise<ProcessNotificationResult | null> {
  logger.info('Received notification event from EventBridge', {
    source: event.source,
    detailType: event['detail-type'],
  });

  const detail = typeof event.detail === 'string' ? JSON.parse(event.detail) : (event.detail || {});
  return processNotificationEvent(detail, event['detail-type']);
}
