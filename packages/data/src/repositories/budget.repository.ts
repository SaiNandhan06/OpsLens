import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, getTableName } from '../client.js';
import { tenantPk, budgetSk } from '../keys.js';

export interface TokenUsageRecord {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd?: number;
  callCount?: number;
  [key: string]: unknown;
}

function stripKeys(item: Record<string, unknown>): TokenUsageRecord {
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
  return clean as unknown as TokenUsageRecord;
}

export class BudgetRepository {
  /**
   * Atomically records LLM token consumption for a tenant on a specific day.
   * STRICT: Uses atomic ADD operations.
   */
  async recordTokenUsage(
    tenantId: string,
    date: string,
    usage: { inputTokens: number; outputTokens: number; costUsd?: number },
  ): Promise<TokenUsageRecord> {
    const doc = getDocClient();
    const totalTokens = usage.inputTokens + usage.outputTokens;

    const expressionParts = [
      '#inputTokens :inputTokens',
      '#outputTokens :outputTokens',
      '#totalTokens :totalTokens',
      '#callCount :one',
    ];

    const attributeNames: Record<string, string> = {
      '#inputTokens': 'inputTokens',
      '#outputTokens': 'outputTokens',
      '#totalTokens': 'totalTokens',
      '#callCount': 'callCount',
    };

    const attributeValues: Record<string, number> = {
      ':inputTokens': usage.inputTokens,
      ':outputTokens': usage.outputTokens,
      ':totalTokens': totalTokens,
      ':one': 1,
    };

    if (typeof usage.costUsd === 'number' && usage.costUsd > 0) {
      expressionParts.push('#costUsd :costUsd');
      attributeNames['#costUsd'] = 'costUsd';
      attributeValues[':costUsd'] = usage.costUsd;
    }

    const updateExpression = `ADD ${expressionParts.join(', ')}`;

    const result = await doc.send(
      new UpdateCommand({
        TableName: getTableName(),
        Key: {
          PK: tenantPk(tenantId),
          SK: budgetSk(date),
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
   * Retrieves the daily token usage and budget status for a tenant.
   */
  async getBudget(tenantId: string, date: string): Promise<TokenUsageRecord | null> {
    const doc = getDocClient();
    const result = await doc.send(
      new GetCommand({
        TableName: getTableName(),
        Key: {
          PK: tenantPk(tenantId),
          SK: budgetSk(date),
        },
      }),
    );

    if (!result.Item) return null;
    return stripKeys(result.Item);
  }
}
