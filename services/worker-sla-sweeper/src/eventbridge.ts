import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import type {
  SlaBreachedEvent,
  IncidentEscalatedEvent,
} from '@opslens/contracts';
import { logger } from '@opslens/platform';

let client: EventBridgeClient | null = null;

export function getEventBridgeClient(): EventBridgeClient {
  if (!client) {
    const endpoint =
      process.env.LOCALSTACK_ENDPOINT ||
      process.env.AWS_ENDPOINT_URL ||
      'http://localhost:4566';
    const region = process.env.AWS_REGION || 'us-east-1';

    client = new EventBridgeClient({
      region,
      endpoint,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
      },
    });
  }
  return client;
}

export function getEventBusName(): string {
  return process.env.EVENT_BUS_NAME || 'opslens-events-local';
}

export async function publishSlaBreachedEvent(
  event: SlaBreachedEvent,
  ebClient: EventBridgeClient = getEventBridgeClient(),
): Promise<void> {
  const busName = getEventBusName();
  try {
    await ebClient.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: busName,
            Source: 'opslens.incidents',
            DetailType: 'SLA_BREACHED',
            Detail: JSON.stringify(event),
            Time: new Date(event.occurredAt),
          },
        ],
      }),
    );
    logger.info('Published SLA_BREACHED event', {
      tenantId: event.tenantId,
      incidentId: event.incidentId,
      breachType: event.breachType,
    });
  } catch (err: any) {
    logger.error('Failed to publish SLA_BREACHED event to EventBridge', {
      error: err.message,
      tenantId: event.tenantId,
      incidentId: event.incidentId,
    });
  }
}

export async function publishIncidentEscalatedEvent(
  event: IncidentEscalatedEvent,
  ebClient: EventBridgeClient = getEventBridgeClient(),
): Promise<void> {
  const busName = getEventBusName();
  try {
    await ebClient.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: busName,
            Source: 'opslens.incidents',
            DetailType: 'INCIDENT_ESCALATED',
            Detail: JSON.stringify(event),
            Time: new Date(event.occurredAt),
          },
        ],
      }),
    );
    logger.info('Published INCIDENT_ESCALATED event', {
      tenantId: event.tenantId,
      incidentId: event.incidentId,
      escalationLevel: event.escalationLevel,
      escalatedToTeamId: event.escalatedToTeamId,
    });
  } catch (err: any) {
    logger.error('Failed to publish INCIDENT_ESCALATED event to EventBridge', {
      error: err.message,
      tenantId: event.tenantId,
      incidentId: event.incidentId,
    });
  }
}
