import {
  EventBridgeClient,
  EventBridgeClientConfig,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import type {
  IncidentNeedsInfoEvent,
  IncidentTriagedEvent,
  IncidentRoutedEvent,
} from '@opslens/contracts';

export function isLocal(): boolean {
  return (
    process.env.STAGE === 'local' ||
    Boolean(process.env.LOCALSTACK_HOSTNAME) ||
    Boolean(process.env.AWS_ENDPOINT_URL) ||
    !process.env.STAGE
  );
}

export function createEventBridgeClient(config: EventBridgeClientConfig = {}): EventBridgeClient {
  const isLocalEnv = isLocal();
  const endpoint =
    process.env.LOCALSTACK_ENDPOINT ||
    process.env.AWS_ENDPOINT_URL ||
    (isLocalEnv ? 'http://localhost:4566' : undefined);

  const region = process.env.AWS_REGION || 'us-east-1';

  const clientConfig: EventBridgeClientConfig = {
    region,
    ...config,
  };

  if (endpoint) {
    clientConfig.endpoint = endpoint;
  }

  if (isLocalEnv) {
    clientConfig.credentials = clientConfig.credentials || {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
    };
  }

  return new EventBridgeClient(clientConfig);
}

let defaultEventBridgeClient: EventBridgeClient | null = null;

export function getEventBridgeClient(): EventBridgeClient {
  if (!defaultEventBridgeClient) {
    defaultEventBridgeClient = createEventBridgeClient();
  }
  return defaultEventBridgeClient;
}

export function getEventBusName(): string {
  return process.env.EVENT_BUS_NAME || 'opslens-events-local';
}

/**
 * Publishes an INCIDENT_NEEDS_INFO event to EventBridge.
 */
export async function publishIncidentNeedsInfoEvent(
  event: IncidentNeedsInfoEvent,
  client = getEventBridgeClient(),
): Promise<void> {
  const busName = getEventBusName();
  await client.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: busName,
          Source: 'opslens.triage',
          DetailType: 'INCIDENT_NEEDS_INFO',
          Detail: JSON.stringify(event),
        },
      ],
    }),
  );
}

/**
 * Publishes an INCIDENT_TRIAGED event to EventBridge.
 */
export async function publishIncidentTriagedEvent(
  event: IncidentTriagedEvent,
  client = getEventBridgeClient(),
): Promise<void> {
  const busName = getEventBusName();
  await client.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: busName,
          Source: 'opslens.triage',
          DetailType: 'INCIDENT_TRIAGED',
          Detail: JSON.stringify(event),
        },
      ],
    }),
  );
}

/**
 * Publishes an INCIDENT_ROUTED event to EventBridge.
 */
export async function publishIncidentRoutedEvent(
  event: IncidentRoutedEvent,
  client = getEventBridgeClient(),
): Promise<void> {
  const busName = getEventBusName();
  await client.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: busName,
          Source: 'opslens.triage',
          DetailType: 'INCIDENT_ROUTED',
          Detail: JSON.stringify(event),
        },
      ],
    }),
  );
}

