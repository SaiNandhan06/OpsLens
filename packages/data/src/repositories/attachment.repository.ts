import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { IncidentAttachment } from '@opslens/contracts';
import { getDocClient, getTableName } from '../client.js';
import { tenantPk, attachmentSk } from '../keys.js';

function stripKeys(item: Record<string, unknown>): IncidentAttachment {
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
  return clean as unknown as IncidentAttachment;
}

export class AttachmentRepository {
  /**
   * Persists an incident attachment item to DynamoDB.
   */
  async createAttachment(
    tenantId: string,
    attachment: IncidentAttachment,
  ): Promise<IncidentAttachment> {
    const doc = getDocClient();
    const item = {
      ...attachment,
      tenantId,
      PK: tenantPk(tenantId),
      SK: attachmentSk(attachment.incidentId, attachment.id),
    };

    await doc.send(
      new PutCommand({
        TableName: getTableName(),
        Item: item,
      }),
    );

    return attachment;
  }

  /**
   * Lists all attachments associated with a specific incident.
   */
  async listAttachments(
    tenantId: string,
    incidentId: string,
  ): Promise<IncidentAttachment[]> {
    const doc = getDocClient();
    const result = await doc.send(
      new QueryCommand({
        TableName: getTableName(),
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': tenantPk(tenantId),
          ':skPrefix': `INCIDENT#${incidentId}#ATT#`,
        },
      }),
    );

    return (result.Items || []).map((item) => stripKeys(item));
  }
}
