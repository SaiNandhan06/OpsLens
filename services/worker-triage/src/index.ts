import type { EventBridgeEvent, Context } from 'aws-lambda';
import type { IncidentCreatedEvent } from '@opslens/contracts';
import { logger } from '@opslens/platform';
import { runTriagePipeline } from './triage-pipeline.js';

export * from './stubs.js';
export * from './transcribe.js';
export * from './eventbridge.js';
export * from './triage-pipeline.js';

/**
 * EventBridge consumer Lambda handler for OpsLens INCIDENT_CREATED events.
 * Executes the triage extraction and classification pipeline.
 */
export async function handler(
  event: EventBridgeEvent<'INCIDENT_CREATED', IncidentCreatedEvent>,
  _context?: Context,
): Promise<void> {
  const detail = event.detail;

  if (!detail || !detail.tenantId || !detail.incidentId) {
    logger.error('Invalid INCIDENT_CREATED event received: missing tenantId or incidentId', {
      event,
    });
    return;
  }

  logger.info('Received INCIDENT_CREATED event for triage processing', {
    tenantId: detail.tenantId,
    incidentId: detail.incidentId,
    correlationId: detail.correlationId,
  });

  await runTriagePipeline({
    tenantId: detail.tenantId,
    incidentId: detail.incidentId,
    correlationId: detail.correlationId,
  });
}
