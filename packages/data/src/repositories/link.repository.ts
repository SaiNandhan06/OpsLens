import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { IncidentLink } from '@opslens/contracts';
import { getDocClient, getTableName } from '../client.js';
import { tenantPk, incidentLinkSk } from '../keys.js';

function stripKeys(item: Record<string, unknown>): IncidentLink {
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
  return clean as unknown as IncidentLink;
}

export class LinkRepository {
  /**
   * Creates or records a relationship link between two incidents.
   * Writes symmetric links so both incidents can query relationship links.
   */
  async createLink(tenantId: string, link: IncidentLink): Promise<IncidentLink> {
    const doc = getDocClient();
    const item = {
      ...link,
      tenantId,
      PK: tenantPk(tenantId),
      SK: incidentLinkSk(link.parentIncidentId, link.childIncidentId),
    };

    await doc.send(
      new PutCommand({
        TableName: getTableName(),
        Item: item,
      }),
    );

    // Write reverse link so child incident can also query related links
    if (link.parentIncidentId !== link.childIncidentId) {
      await doc.send(
        new PutCommand({
          TableName: getTableName(),
          Item: {
            ...item,
            SK: incidentLinkSk(link.childIncidentId, link.parentIncidentId),
          },
        }),
      );
    }

    return link;
  }

  /**
   * Retrieves all relationship links for an incident, sorted by similarityScore descending.
   */
  async getLinks(tenantId: string, incidentId: string): Promise<IncidentLink[]> {
    const doc = getDocClient();
    const result = await doc.send(
      new QueryCommand({
        TableName: getTableName(),
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': tenantPk(tenantId),
          ':skPrefix': `INCIDENT#${incidentId}#LINK#`,
        },
      }),
    );

    const links = (result.Items || []).map((item) => stripKeys(item));
    return links.sort((a, b) => (b.similarityScore || 0) - (a.similarityScore || 0));
  }

  /**
   * Alias for getLinks to conform with standard collection naming.
   */
  async listLinks(tenantId: string, incidentId: string): Promise<IncidentLink[]> {
    return this.getLinks(tenantId, incidentId);
  }
}
