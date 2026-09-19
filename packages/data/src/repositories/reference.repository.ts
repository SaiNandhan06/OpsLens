import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, getTableName } from '../client.js';
import {
  tenantPk,
  tenantMetaSk,
  userSk,
  teamSk,
  assetSk,
  locationSk,
} from '../keys.js';

function stripKeys<T extends Record<string, unknown>>(item: Record<string, unknown>): T {
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
  return clean as unknown as T;
}

export class ReferenceRepository {
  /**
   * Saves tenant metadata and configuration.
   */
  async saveTenant(tenantId: string, tenant: Record<string, unknown>): Promise<void> {
    const doc = getDocClient();
    const item = {
      ...tenant,
      tenantId,
      PK: tenantPk(tenantId),
      SK: tenantMetaSk(),
    };
    await doc.send(
      new PutCommand({
        TableName: getTableName(),
        Item: item,
      }),
    );
  }

  /**
   * Retrieves tenant metadata.
   */
  async getTenant(tenantId: string): Promise<Record<string, unknown> | null> {
    const doc = getDocClient();
    const result = await doc.send(
      new GetCommand({
        TableName: getTableName(),
        Key: {
          PK: tenantPk(tenantId),
          SK: tenantMetaSk(),
        },
      }),
    );
    if (!result.Item) return null;
    return stripKeys(result.Item);
  }

  /**
   * Saves a user record under a tenant.
   */
  async saveUser(tenantId: string, user: { id: string; [key: string]: unknown }): Promise<void> {
    const doc = getDocClient();
    const item = {
      ...user,
      tenantId,
      PK: tenantPk(tenantId),
      SK: userSk(user.id),
    };
    await doc.send(
      new PutCommand({
        TableName: getTableName(),
        Item: item,
      }),
    );
  }

  /**
   * Retrieves a single user by ID.
   */
  async getUser(tenantId: string, userId: string): Promise<Record<string, unknown> | null> {
    const doc = getDocClient();
    const result = await doc.send(
      new GetCommand({
        TableName: getTableName(),
        Key: {
          PK: tenantPk(tenantId),
          SK: userSk(userId),
        },
      }),
    );
    if (!result.Item) return null;
    return stripKeys(result.Item);
  }

  /**
   * Lists all users for a tenant.
   */
  async listUsers(tenantId: string): Promise<Record<string, unknown>[]> {
    const doc = getDocClient();
    const result = await doc.send(
      new QueryCommand({
        TableName: getTableName(),
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': tenantPk(tenantId),
          ':skPrefix': 'USER#',
        },
      }),
    );
    return (result.Items || []).map((item) => stripKeys(item));
  }

  /**
   * Saves a team record under a tenant.
   */
  async saveTeam(tenantId: string, team: { id: string; [key: string]: unknown }): Promise<void> {
    const doc = getDocClient();
    const item = {
      ...team,
      tenantId,
      PK: tenantPk(tenantId),
      SK: teamSk(team.id),
    };
    await doc.send(
      new PutCommand({
        TableName: getTableName(),
        Item: item,
      }),
    );
  }

  /**
   * Retrieves a single team by ID.
   */
  async getTeam(tenantId: string, teamId: string): Promise<Record<string, unknown> | null> {
    const doc = getDocClient();
    const result = await doc.send(
      new GetCommand({
        TableName: getTableName(),
        Key: {
          PK: tenantPk(tenantId),
          SK: teamSk(teamId),
        },
      }),
    );
    if (!result.Item) return null;
    return stripKeys(result.Item);
  }

  /**
   * Lists all teams for a tenant.
   */
  async listTeams(tenantId: string): Promise<Record<string, unknown>[]> {
    const doc = getDocClient();
    const result = await doc.send(
      new QueryCommand({
        TableName: getTableName(),
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': tenantPk(tenantId),
          ':skPrefix': 'TEAM#',
        },
      }),
    );
    return (result.Items || []).map((item) => stripKeys(item));
  }

  /**
   * Saves an asset record under a tenant.
   */
  async saveAsset(tenantId: string, asset: { id: string; [key: string]: unknown }): Promise<void> {
    const doc = getDocClient();
    const item = {
      ...asset,
      tenantId,
      PK: tenantPk(tenantId),
      SK: assetSk(asset.id),
    };
    await doc.send(
      new PutCommand({
        TableName: getTableName(),
        Item: item,
      }),
    );
  }

  /**
   * Retrieves a single asset by ID.
   */
  async getAsset(tenantId: string, assetId: string): Promise<Record<string, unknown> | null> {
    const doc = getDocClient();
    const result = await doc.send(
      new GetCommand({
        TableName: getTableName(),
        Key: {
          PK: tenantPk(tenantId),
          SK: assetSk(assetId),
        },
      }),
    );
    if (!result.Item) return null;
    return stripKeys(result.Item);
  }

  /**
   * Lists all assets for a tenant.
   */
  async listAssets(tenantId: string): Promise<Record<string, unknown>[]> {
    const doc = getDocClient();
    const result = await doc.send(
      new QueryCommand({
        TableName: getTableName(),
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': tenantPk(tenantId),
          ':skPrefix': 'ASSET#',
        },
      }),
    );
    return (result.Items || []).map((item) => stripKeys(item));
  }

  /**
   * Saves a location record under a tenant.
   */
  async saveLocation(tenantId: string, location: { id: string; [key: string]: unknown }): Promise<void> {
    const doc = getDocClient();
    const item = {
      ...location,
      tenantId,
      PK: tenantPk(tenantId),
      SK: locationSk(location.id),
    };
    await doc.send(
      new PutCommand({
        TableName: getTableName(),
        Item: item,
      }),
    );
  }

  /**
   * Retrieves a single location by ID.
   */
  async getLocation(tenantId: string, locationId: string): Promise<Record<string, unknown> | null> {
    const doc = getDocClient();
    const result = await doc.send(
      new GetCommand({
        TableName: getTableName(),
        Key: {
          PK: tenantPk(tenantId),
          SK: locationSk(locationId),
        },
      }),
    );
    if (!result.Item) return null;
    return stripKeys(result.Item);
  }

  /**
   * Lists all locations for a tenant.
   */
  async listLocations(tenantId: string): Promise<Record<string, unknown>[]> {
    const doc = getDocClient();
    const result = await doc.send(
      new QueryCommand({
        TableName: getTableName(),
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': tenantPk(tenantId),
          ':skPrefix': 'LOC#',
        },
      }),
    );
    return (result.Items || []).map((item) => stripKeys(item));
  }
}
