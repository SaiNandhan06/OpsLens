import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { RecommendationItem } from '@opslens/contracts';
import { getDocClient, getTableName } from '../client.js';
import { tenantPk, recommendationSk } from '../keys.js';

function stripKeys(item: Record<string, unknown>): RecommendationItem {
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
  return clean as unknown as RecommendationItem;
}

export class RecommendationRepository {
  /**
   * Saves a prevention recommendation.
   */
  async saveRecommendation(
    tenantId: string,
    recommendation: RecommendationItem & { date?: string },
  ): Promise<RecommendationItem> {
    const doc = getDocClient();
    const date = recommendation.date || (recommendation.createdAt ? recommendation.createdAt.split('T')[0]! : new Date().toISOString().split('T')[0]!);
    const assetOrId = recommendation.assetId || recommendation.id;

    const item = {
      ...recommendation,
      tenantId,
      PK: tenantPk(tenantId),
      SK: recommendationSk(date, assetOrId),
    };

    await doc.send(
      new PutCommand({
        TableName: getTableName(),
        Item: item,
      }),
    );

    return recommendation;
  }

  /**
   * Lists recommendations for a specific date.
   */
  async listRecommendationsByDate(tenantId: string, date: string): Promise<RecommendationItem[]> {
    const doc = getDocClient();
    const result = await doc.send(
      new QueryCommand({
        TableName: getTableName(),
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': tenantPk(tenantId),
          ':skPrefix': `REC#${date}#`,
        },
      }),
    );

    return (result.Items || []).map((item) => stripKeys(item));
  }

  /**
   * Lists recent recommendations for a tenant.
   */
  async listRecommendations(tenantId: string, limit = 50): Promise<RecommendationItem[]> {
    const doc = getDocClient();
    const result = await doc.send(
      new QueryCommand({
        TableName: getTableName(),
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': tenantPk(tenantId),
          ':skPrefix': 'REC#',
        },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );

    return (result.Items || []).map((item) => stripKeys(item));
  }
}
