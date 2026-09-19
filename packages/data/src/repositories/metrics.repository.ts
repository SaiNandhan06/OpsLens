import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, getTableName } from '../client.js';
import { tenantPk, metricsSk } from '../keys.js';

function stripKeys(item: Record<string, unknown>): Record<string, number> {
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
  delete clean.tenantId;
  delete clean.date;
  return clean as Record<string, number>;
}

export class MetricsRepository {
  /**
   * Atomically increments one or more daily metrics counters.
   * STRICT: Uses atomic DynamoDB ADD updates only — never read-modify-write.
   */
  async incrementDailyCounters(
    tenantId: string,
    date: string,
    increments: Record<string, number>,
  ): Promise<Record<string, number>> {
    const entries = Object.entries(increments).filter(([, val]) => typeof val === 'number' && val !== 0);
    if (entries.length === 0) {
      const existing = await this.getDailyMetrics(tenantId, date);
      return existing || {};
    }

    const doc = getDocClient();
    const expressionParts: string[] = [];
    const attributeNames: Record<string, string> = {};
    const attributeValues: Record<string, number> = {};

    entries.forEach(([key, val], idx) => {
      const nameKey = `#metric_${idx}`;
      const valKey = `:inc_${idx}`;
      expressionParts.push(`${nameKey} ${valKey}`);
      attributeNames[nameKey] = key;
      attributeValues[valKey] = val;
    });

    const updateExpression = `ADD ${expressionParts.join(', ')}`;

    const result = await doc.send(
      new UpdateCommand({
        TableName: getTableName(),
        Key: {
          PK: tenantPk(tenantId),
          SK: metricsSk(date),
        },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: attributeNames,
        ExpressionAttributeValues: attributeValues,
        ReturnValues: 'ALL_NEW',
      }),
    );

    return stripKeys(result.Attributes || {});
  }

  /**
   * Retrieves the daily metrics counters for a tenant.
   */
  async getDailyMetrics(tenantId: string, date: string): Promise<Record<string, number> | null> {
    const doc = getDocClient();
    const result = await doc.send(
      new GetCommand({
        TableName: getTableName(),
        Key: {
          PK: tenantPk(tenantId),
          SK: metricsSk(date),
        },
      }),
    );

    if (!result.Item) return null;
    return stripKeys(result.Item);
  }
}
