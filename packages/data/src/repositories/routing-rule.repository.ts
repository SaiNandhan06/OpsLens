import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, getTableName } from '../client.js';
import { tenantPk, routingRuleSk } from '../keys.js';

export interface RoutingRule {
  id: string;
  priority: number;
  name: string;
  conditions: Record<string, unknown>;
  targetTeamId: string;
  reason: string;
  [key: string]: unknown;
}

function stripKeys(item: Record<string, unknown>): RoutingRule {
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
  return clean as unknown as RoutingRule;
}

export class RoutingRuleRepository {
  /**
   * Saves a routing rule for a tenant.
   */
  async saveRule(tenantId: string, rule: RoutingRule): Promise<RoutingRule> {
    const doc = getDocClient();
    const item = {
      ...rule,
      tenantId,
      PK: tenantPk(tenantId),
      SK: routingRuleSk(rule.priority, rule.id),
    };

    await doc.send(
      new PutCommand({
        TableName: getTableName(),
        Item: item,
      }),
    );

    return rule;
  }

  /**
   * Retrieves a routing rule by priority and rule ID.
   */
  async getRule(tenantId: string, priority: number, ruleId: string): Promise<RoutingRule | null> {
    const doc = getDocClient();
    const result = await doc.send(
      new GetCommand({
        TableName: getTableName(),
        Key: {
          PK: tenantPk(tenantId),
          SK: routingRuleSk(priority, ruleId),
        },
      }),
    );

    if (!result.Item) return null;
    return stripKeys(result.Item);
  }

  /**
   * Lists all routing rules for a tenant, sorted in ascending priority order.
   */
  async listRules(tenantId: string): Promise<RoutingRule[]> {
    const doc = getDocClient();
    const result = await doc.send(
      new QueryCommand({
        TableName: getTableName(),
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': tenantPk(tenantId),
          ':skPrefix': 'ROUTE#',
        },
        ScanIndexForward: true,
      }),
    );

    return (result.Items || []).map((item) => stripKeys(item));
  }
}
