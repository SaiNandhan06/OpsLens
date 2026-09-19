import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SlaPolicy } from '@opslens/contracts';
import { getDocClient, getTableName } from '../client.js';
import { tenantPk, slaPolicySk } from '../keys.js';

function stripKeys(item: Record<string, unknown>): SlaPolicy {
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
  return clean as unknown as SlaPolicy;
}

export class SlaPolicyRepository {
  /**
   * Saves an SLA policy for a tenant.
   */
  async savePolicy(tenantId: string, policy: SlaPolicy): Promise<SlaPolicy> {
    const doc = getDocClient();
    const item = {
      ...policy,
      tenantId,
      PK: tenantPk(tenantId),
      SK: slaPolicySk(policy.category, policy.severity),
    };

    await doc.send(
      new PutCommand({
        TableName: getTableName(),
        Item: item,
      }),
    );

    return policy;
  }

  /**
   * Retrieves an SLA policy by category and severity.
   */
  async getPolicy(tenantId: string, category: string, severity: string): Promise<SlaPolicy | null> {
    const doc = getDocClient();
    const result = await doc.send(
      new GetCommand({
        TableName: getTableName(),
        Key: {
          PK: tenantPk(tenantId),
          SK: slaPolicySk(category, severity),
        },
      }),
    );

    if (!result.Item) return null;
    return stripKeys(result.Item);
  }

  /**
   * Lists all SLA policies configured for a tenant.
   */
  async listPolicies(tenantId: string): Promise<SlaPolicy[]> {
    const doc = getDocClient();
    const result = await doc.send(
      new QueryCommand({
        TableName: getTableName(),
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': tenantPk(tenantId),
          ':skPrefix': 'SLA#',
        },
      }),
    );

    return (result.Items || []).map((item) => stripKeys(item));
  }
}
