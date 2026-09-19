import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { TimelineEvent } from '@opslens/contracts';
import { getDocClient, getTableName } from '../client.js';
import { tenantPk, timelineEventSk } from '../keys.js';
import { encodeCursor, decodeCursor } from '../pagination.js';

function stripKeys(item: Record<string, unknown>): TimelineEvent {
  const clean = { ...item };
  delete clean.PK;
  delete clean.SK;
  delete clean.gsi1pk;
  delete clean.gsi1sk;
  delete clean.gsi2pk;
  delete clean.gsi2sk;
  delete clean.gsi3pk;
  delete clean.gsi3sk;
  delete clean.gsi4pk;
  delete clean.gsi4sk;
  return clean as unknown as TimelineEvent;
}

export class TimelineRepository {
  /**
   * Appends an immutable audit event to an incident timeline.
   * STRICT: Writes are append-only with a conditional expression preventing overwrite.
   */
  async appendEvent(tenantId: string, event: TimelineEvent, seq = 0): Promise<TimelineEvent> {
    const doc = getDocClient();
    const sk = timelineEventSk(event.incidentId, event.timestamp, event.id || seq);

    const item = {
      ...event,
      tenantId,
      PK: tenantPk(tenantId),
      SK: sk,
    };

    await doc.send(
      new PutCommand({
        TableName: getTableName(),
        Item: item,
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      }),
    );

    return event;
  }

  /**
   * Lists timeline events for an incident in ascending chronological order.
   */
  async listEvents(
    tenantId: string,
    incidentId: string,
    options: { limit?: number; cursor?: string } = {},
  ): Promise<{ items: TimelineEvent[]; nextCursor: string | null }> {
    const doc = getDocClient();
    const limit = options.limit || 100;
    const exclusiveStartKey = decodeCursor(options.cursor);

    const result = await doc.send(
      new QueryCommand({
        TableName: getTableName(),
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': tenantPk(tenantId),
          ':skPrefix': `INCIDENT#${incidentId}#EVT#`,
        },
        ScanIndexForward: true,
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    const items = (result.Items || []).map((item) => stripKeys(item));
    const nextCursor = encodeCursor(result.LastEvaluatedKey);

    return { items, nextCursor };
  }
}
