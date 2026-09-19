import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Incident, IncidentStatus } from '@opslens/contracts';
import { getDocClient, getTableName } from '../client.js';
import {
  tenantPk,
  incidentSk,
  gsi1Pk,
  gsi1Sk,
  gsi2Pk,
  gsi2Sk,
  gsi3Pk,
  gsi3Sk,
  gsi4Pk,
  gsi4Sk,
} from '../keys.js';
import { encodeCursor, decodeCursor } from '../pagination.js';

const TERMINAL_STATUSES: IncidentStatus[] = ['RESOLVED', 'CLOSED', 'MERGED'];

/**
 * Determines whether an SLA is active for an incident and computes the earliest due deadline.
 */
function computeSlaAttributes(
  tenantId: string,
  incident: Pick<Incident, 'status' | 'ackDueAt' | 'resolveDueAt' | 'acknowledgedAt'>,
): {
  gsi3pk?: string;
  gsi3sk?: string;
  slaActive?: boolean;
  earliestDueAt?: string;
} {
  if (TERMINAL_STATUSES.includes(incident.status)) {
    // Strictly sparse: attributes must be absent when resolved/closed/merged
    return {};
  }

  let earliestDueAt: string | null = null;
  if (!incident.acknowledgedAt && incident.ackDueAt) {
    earliestDueAt = incident.ackDueAt;
  } else if (incident.resolveDueAt) {
    earliestDueAt = incident.resolveDueAt;
  } else if (incident.ackDueAt) {
    earliestDueAt = incident.ackDueAt;
  }

  if (!earliestDueAt) {
    return {};
  }

  return {
    gsi3pk: gsi3Pk(tenantId),
    gsi3sk: gsi3Sk(earliestDueAt),
    slaActive: true,
    earliestDueAt,
  };
}

function stripKeys(item: Record<string, unknown>): Incident {
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
  return clean as unknown as Incident;
}

export class IncidentRepository {
  /**
   * Creates a new incident item in DynamoDB with GSI1-GSI4 keys.
   */
  async create(tenantId: string, incident: Incident): Promise<Incident> {
    const doc = getDocClient();
    const slaAttrs = computeSlaAttributes(tenantId, incident);

    const item: Record<string, unknown> = {
      ...incident,
      tenantId,
      PK: tenantPk(tenantId),
      SK: incidentSk(incident.id),
      // GSI1: Queue listing
      gsi1pk: gsi1Pk(tenantId, incident.status),
      gsi1sk: gsi1Sk(incident.priorityScore, incident.createdAt),
      // GSI4: My Submissions
      gsi4pk: gsi4Pk(tenantId, incident.reporterId),
      gsi4sk: gsi4Sk(incident.createdAt),
    };

    // GSI2: Asset or Location history (deduplication & recurrence)
    if (incident.assetId) {
      item.gsi2pk = gsi2Pk(tenantId, incident.assetId);
      item.gsi2sk = gsi2Sk(incident.createdAt);
    } else if (incident.locationId) {
      item.gsi2pk = `TENANT#${tenantId}#LOC#${incident.locationId}`;
      item.gsi2sk = gsi2Sk(incident.createdAt);
    }

    // GSI3: Sparse SLA sweeper index
    if (slaAttrs.gsi3pk && slaAttrs.gsi3sk) {
      item.gsi3pk = slaAttrs.gsi3pk;
      item.gsi3sk = slaAttrs.gsi3sk;
      item.slaActive = slaAttrs.slaActive;
      item.earliestDueAt = slaAttrs.earliestDueAt;
    }

    await doc.send(
      new PutCommand({
        TableName: getTableName(),
        Item: item,
      }),
    );

    return incident;
  }

  /**
   * Retrieves a single incident by ID.
   */
  async getById(tenantId: string, id: string): Promise<Incident | null> {
    const doc = getDocClient();
    const result = await doc.send(
      new GetCommand({
        TableName: getTableName(),
        Key: {
          PK: tenantPk(tenantId),
          SK: incidentSk(id),
        },
      }),
    );

    if (!result.Item) return null;
    return stripKeys(result.Item);
  }

  /**
   * Updates incident fields with dynamic GSI updates and sparse GSI3 removal.
   */
  async update(
    tenantId: string,
    id: string,
    patch: Partial<Incident>,
    options?: {
      conditionExpression?: string;
      conditionAttributeValues?: Record<string, unknown>;
    },
  ): Promise<Incident> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new Error(`Incident not found: ${id} in tenant: ${tenantId}`);
    }

    const updated: Incident = {
      ...existing,
      ...patch,
      updatedAt: patch.updatedAt || new Date().toISOString(),
    };

    const doc = getDocClient();
    const setExpressions: string[] = [];
    const removeExpressions: string[] = [];
    const attrNames: Record<string, string> = {};
    const attrValues: Record<string, unknown> = {
      ...(options?.conditionAttributeValues || {}),
    };

    let varIdx = 0;
    const addSet = (field: string, val: unknown) => {
      const n = `#f_${varIdx}`;
      const v = `:v_${varIdx}`;
      setExpressions.push(`${n} = ${v}`);
      attrNames[n] = field;
      attrValues[v] = val;
      varIdx++;
    };

    const addRemove = (field: string) => {
      const n = `#r_${varIdx}`;
      removeExpressions.push(n);
      attrNames[n] = field;
      varIdx++;
    };

    // Update standard attributes from patch (exclude GSI and SLA keys handled separately)
    for (const [key, val] of Object.entries(patch)) {
      if (
        key !== 'id' &&
        key !== 'tenantId' &&
        key !== 'gsi1pk' &&
        key !== 'gsi1sk' &&
        key !== 'gsi2pk' &&
        key !== 'gsi2sk' &&
        key !== 'gsi3pk' &&
        key !== 'gsi3sk' &&
        key !== 'gsi4pk' &&
        key !== 'gsi4sk' &&
        key !== 'slaActive' &&
        key !== 'earliestDueAt' &&
        val !== undefined
      ) {
        addSet(key, val);
      }
    }
    addSet('updatedAt', updated.updatedAt);

    // Update GSI1 if status, priorityScore, or createdAt changed
    if (patch.status !== undefined || patch.priorityScore !== undefined) {
      addSet('gsi1pk', gsi1Pk(tenantId, updated.status));
      addSet('gsi1sk', gsi1Sk(updated.priorityScore, updated.createdAt));
    }

    // Update GSI2 if assetId or locationId changed
    if (patch.assetId !== undefined || patch.locationId !== undefined) {
      if (updated.assetId) {
        addSet('gsi2pk', gsi2Pk(tenantId, updated.assetId));
        addSet('gsi2sk', gsi2Sk(updated.createdAt));
      } else if (updated.locationId) {
        addSet('gsi2pk', `TENANT#${tenantId}#LOC#${updated.locationId}`);
        addSet('gsi2sk', gsi2Sk(updated.createdAt));
      } else {
        addRemove('gsi2pk');
        addRemove('gsi2sk');
      }
    }

    // GSI3 Sparse management:
    // When resolved, closed, or merged, REMOVE gsi3pk, gsi3sk, slaActive, earliestDueAt
    const isTerminal = TERMINAL_STATUSES.includes(updated.status);
    if (isTerminal) {
      addRemove('gsi3pk');
      addRemove('gsi3sk');
      addRemove('slaActive');
      addRemove('earliestDueAt');
    } else {
      const slaAttrs = computeSlaAttributes(tenantId, updated);
      if (slaAttrs.gsi3pk && slaAttrs.gsi3sk) {
        addSet('gsi3pk', slaAttrs.gsi3pk);
        addSet('gsi3sk', slaAttrs.gsi3sk);
        addSet('slaActive', slaAttrs.slaActive);
        addSet('earliestDueAt', slaAttrs.earliestDueAt);
      } else {
        addRemove('gsi3pk');
        addRemove('gsi3sk');
        addRemove('slaActive');
        addRemove('earliestDueAt');
      }
    }

    const updateParts: string[] = [];
    if (setExpressions.length > 0) updateParts.push(`SET ${setExpressions.join(', ')}`);
    if (removeExpressions.length > 0) updateParts.push(`REMOVE ${removeExpressions.join(', ')}`);

    const result = await doc.send(
      new UpdateCommand({
        TableName: getTableName(),
        Key: {
          PK: tenantPk(tenantId),
          SK: incidentSk(id),
        },
        UpdateExpression: updateParts.join(' '),
        ConditionExpression: options?.conditionExpression,
        ExpressionAttributeNames: attrNames,
        ExpressionAttributeValues: Object.keys(attrValues).length > 0 ? attrValues : undefined,
        ReturnValues: 'ALL_NEW',
      }),
    );

    return stripKeys(result.Attributes || {});
  }

  /**
   * Convenience method to update status and handle SLA attribute removal.
   */
  async updateStatus(
    tenantId: string,
    id: string,
    status: IncidentStatus,
    patch: Partial<Incident> = {},
  ): Promise<Incident> {
    const extra: Partial<Incident> = { ...patch, status };
    if (status === 'ACKNOWLEDGED' && !extra.acknowledgedAt) {
      extra.acknowledgedAt = new Date().toISOString();
    }
    if (status === 'RESOLVED' && !extra.resolvedAt) {
      extra.resolvedAt = new Date().toISOString();
    }
    if (status === 'CLOSED' && !extra.closedAt) {
      extra.closedAt = new Date().toISOString();
    }
    return this.update(tenantId, id, extra);
  }

  /**
   * GSI1: Queue listing sorted by priority (descending by default so highest priority appears first).
   */
  async queryQueue(
    tenantId: string,
    status: IncidentStatus,
    options: {
      limit?: number;
      cursor?: string;
      scanIndexForward?: boolean;
    } = {},
  ): Promise<{ items: Incident[]; nextCursor: string | null }> {
    const doc = getDocClient();
    const limit = options.limit || 25;
    const scanIndexForward = options.scanIndexForward ?? false; // Descending: 100 before 080 before 009
    const exclusiveStartKey = decodeCursor(options.cursor);

    const result = await doc.send(
      new QueryCommand({
        TableName: getTableName(),
        IndexName: 'GSI1',
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: {
          ':pk': gsi1Pk(tenantId, status),
        },
        ScanIndexForward: scanIndexForward,
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    const items = (result.Items || []).map((item) => stripKeys(item));
    const nextCursor = encodeCursor(result.LastEvaluatedKey);

    return { items, nextCursor };
  }

  /**
   * GSI2: Query incident history for a specific asset (deduplication & recurrence).
   */
  async queryByAsset(
    tenantId: string,
    assetId: string,
    options: {
      limit?: number;
      cursor?: string;
      scanIndexForward?: boolean;
    } = {},
  ): Promise<{ items: Incident[]; nextCursor: string | null }> {
    const doc = getDocClient();
    const limit = options.limit || 50;
    const scanIndexForward = options.scanIndexForward ?? false; // Most recent first
    const exclusiveStartKey = decodeCursor(options.cursor);

    const result = await doc.send(
      new QueryCommand({
        TableName: getTableName(),
        IndexName: 'GSI2',
        KeyConditionExpression: 'gsi2pk = :pk',
        ExpressionAttributeValues: {
          ':pk': gsi2Pk(tenantId, assetId),
        },
        ScanIndexForward: scanIndexForward,
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    const items = (result.Items || []).map((item) => stripKeys(item));
    const nextCursor = encodeCursor(result.LastEvaluatedKey);

    return { items, nextCursor };
  }

  /**
   * Queries candidate incidents for duplicate/related detection via GSI2.
   * Matches same tenant, same assetId (or locationId), created within 14 days, newest first, capped at 50.
   */
  async queryCandidates(
    tenantId: string,
    options: {
      assetId?: string | null;
      locationId?: string | null;
      createdAfter?: string;
      limit?: number;
    } = {},
  ): Promise<Incident[]> {
    const doc = getDocClient();
    const limit = Math.min(50, options.limit || 50);
    const results: Incident[] = [];
    const seenIds = new Set<string>();

    const queryIndex = async (pkValue: string) => {
      let keyCondition = 'gsi2pk = :pk';
      const attrValues: Record<string, unknown> = {
        ':pk': pkValue,
      };
      if (options.createdAfter) {
        keyCondition += ' AND gsi2sk >= :after';
        attrValues[':after'] = gsi2Sk(options.createdAfter);
      }

      const res = await doc.send(
        new QueryCommand({
          TableName: getTableName(),
          IndexName: 'GSI2',
          KeyConditionExpression: keyCondition,
          ExpressionAttributeValues: attrValues,
          ScanIndexForward: false, // Newest first
          Limit: limit,
        }),
      );

      for (const item of res.Items || []) {
        const inc = stripKeys(item);
        if (!seenIds.has(inc.id)) {
          seenIds.add(inc.id);
          results.push(inc);
        }
      }
    };

    if (options.assetId) {
      await queryIndex(gsi2Pk(tenantId, options.assetId));
    }
    if (options.locationId && results.length < limit) {
      await queryIndex(`TENANT#${tenantId}#LOC#${options.locationId}`);
    }

    return results.slice(0, limit);
  }

  /**
   * GSI3: Query active SLA incidents for the sweeper (SPARSE INDEX).
   * Sorted ascending by earliest deadline due first.
   */
  async queryActiveSla(
    tenantId: string,
    options: {
      limit?: number;
      cursor?: string;
      dueBefore?: string;
      scanIndexForward?: boolean;
    } = {},
  ): Promise<{ items: Incident[]; nextCursor: string | null }> {
    const doc = getDocClient();
    const limit = options.limit || 50;
    const scanIndexForward = options.scanIndexForward ?? true; // Earliest deadline first
    const exclusiveStartKey = decodeCursor(options.cursor);

    let keyCondition = 'gsi3pk = :pk';
    const attrValues: Record<string, unknown> = {
      ':pk': gsi3Pk(tenantId),
    };

    if (options.dueBefore) {
      keyCondition += ' AND gsi3sk <= :dueBefore';
      attrValues[':dueBefore'] = gsi3Sk(options.dueBefore);
    }

    const result = await doc.send(
      new QueryCommand({
        TableName: getTableName(),
        IndexName: 'GSI3',
        KeyConditionExpression: keyCondition,
        ExpressionAttributeValues: attrValues,
        ScanIndexForward: scanIndexForward,
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    const items = (result.Items || []).map((item) => stripKeys(item));
    const nextCursor = encodeCursor(result.LastEvaluatedKey);

    return { items, nextCursor };
  }

  /**
   * GSI4: Query incidents submitted by a specific user ("My incidents").
   */
  async queryByReporter(
    tenantId: string,
    reporterId: string,
    options: {
      limit?: number;
      cursor?: string;
      scanIndexForward?: boolean;
    } = {},
  ): Promise<{ items: Incident[]; nextCursor: string | null }> {
    const doc = getDocClient();
    const limit = options.limit || 25;
    const scanIndexForward = options.scanIndexForward ?? false; // Most recent first
    const exclusiveStartKey = decodeCursor(options.cursor);

    const result = await doc.send(
      new QueryCommand({
        TableName: getTableName(),
        IndexName: 'GSI4',
        KeyConditionExpression: 'gsi4pk = :pk',
        ExpressionAttributeValues: {
          ':pk': gsi4Pk(tenantId, reporterId),
        },
        ScanIndexForward: scanIndexForward,
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    const items = (result.Items || []).map((item) => stripKeys(item));
    const nextCursor = encodeCursor(result.LastEvaluatedKey);

    return { items, nextCursor };
  }
}
