import { describe, it, expect, beforeAll } from 'vitest';
import { CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import {
  Incident,
  IncidentCategory,
  Severity,
  TimelineEvent,
  IncidentLink,
} from '@opslens/contracts';
import {
  createDynamoClient,
  IncidentRepository,
  TimelineRepository,
  ReferenceRepository,
  SlaPolicyRepository,
  RoutingRuleRepository,
  LinkRepository,
  MetricsRepository,
  RecommendationRepository,
  BudgetRepository,
} from '../src/index.js';

const TEST_TABLE = process.env.TABLE_NAME || 'opslens-local';

async function ensureTableExists() {
  const client = createDynamoClient();
  try {
    await client.send(new DescribeTableCommand({ TableName: TEST_TABLE }));
  } catch {
    await client.send(
      new CreateTableCommand({
        TableName: TEST_TABLE,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
          { AttributeName: 'gsi1pk', AttributeType: 'S' },
          { AttributeName: 'gsi1sk', AttributeType: 'S' },
          { AttributeName: 'gsi2pk', AttributeType: 'S' },
          { AttributeName: 'gsi2sk', AttributeType: 'S' },
          { AttributeName: 'gsi3pk', AttributeType: 'S' },
          { AttributeName: 'gsi3sk', AttributeType: 'S' },
          { AttributeName: 'gsi4pk', AttributeType: 'S' },
          { AttributeName: 'gsi4sk', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'GSI1',
            KeySchema: [
              { AttributeName: 'gsi1pk', KeyType: 'HASH' },
              { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            IndexName: 'GSI2',
            KeySchema: [
              { AttributeName: 'gsi2pk', KeyType: 'HASH' },
              { AttributeName: 'gsi2sk', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            IndexName: 'GSI3',
            KeySchema: [
              { AttributeName: 'gsi3pk', KeyType: 'HASH' },
              { AttributeName: 'gsi3sk', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
          {
            IndexName: 'GSI4',
            KeySchema: [
              { AttributeName: 'gsi4pk', KeyType: 'HASH' },
              { AttributeName: 'gsi4sk', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
      }),
    );
  }
}

describe('DynamoDB Repositories Integration Tests (LocalStack)', () => {
  const incidentRepo = new IncidentRepository();
  const timelineRepo = new TimelineRepository();
  const refRepo = new ReferenceRepository();
  const slaRepo = new SlaPolicyRepository();
  const routeRepo = new RoutingRuleRepository();
  const linkRepo = new LinkRepository();
  const metricsRepo = new MetricsRepository();
  const recRepo = new RecommendationRepository();
  const budgetRepo = new BudgetRepository();

  beforeAll(async () => {
    await ensureTableExists();
  });

  // ==========================================================================
  // ReferenceRepository
  // ==========================================================================
  describe('ReferenceRepository', () => {
    it('persists and retrieves tenant, users, teams, assets, and locations', async () => {
      const tenantId = 'test-hub-ref';

      // Tenant
      await refRepo.saveTenant(tenantId, { name: 'Ref Hub', timezone: 'UTC' });
      const tenant = await refRepo.getTenant(tenantId);
      expect(tenant?.name).toBe('Ref Hub');

      // User
      await refRepo.saveUser(tenantId, { id: 'usr-1', name: 'Alice', role: 'worker' });
      const user = await refRepo.getUser(tenantId, 'usr-1');
      expect(user?.name).toBe('Alice');
      const users = await refRepo.listUsers(tenantId);
      expect(users.some((u) => u.id === 'usr-1')).toBe(true);

      // Team
      await refRepo.saveTeam(tenantId, { id: 'team-1', name: 'Maintenance' });
      const team = await refRepo.getTeam(tenantId, 'team-1');
      expect(team?.name).toBe('Maintenance');
      const teams = await refRepo.listTeams(tenantId);
      expect(teams.some((t) => t.id === 'team-1')).toBe(true);

      // Asset
      await refRepo.saveAsset(tenantId, { id: 'asset-1', name: 'Forklift 1', criticality: 'HIGH' });
      const asset = await refRepo.getAsset(tenantId, 'asset-1');
      expect(asset?.name).toBe('Forklift 1');
      const assets = await refRepo.listAssets(tenantId);
      expect(assets.some((a) => a.id === 'asset-1')).toBe(true);

      // Location
      await refRepo.saveLocation(tenantId, { id: 'loc-1', name: 'Dock 1', zone: 'INBOUND' });
      const loc = await refRepo.getLocation(tenantId, 'loc-1');
      expect(loc?.name).toBe('Dock 1');
      const locs = await refRepo.listLocations(tenantId);
      expect(locs.some((l) => l.id === 'loc-1')).toBe(true);
    });
  });

  // ==========================================================================
  // SlaPolicyRepository
  // ==========================================================================
  describe('SlaPolicyRepository', () => {
    it('saves and lists SLA policies for a tenant', async () => {
      const tenantId = 'test-hub-sla';
      const policy = {
        category: 'EQUIPMENT' as IncidentCategory,
        severity: 'HIGH' as Severity,
        ackTargetMinutes: 20,
        resolveTargetMinutes: 120,
        escalationTeamId: 'TEAM-MAINT',
      };

      await slaRepo.savePolicy(tenantId, policy);
      const fetched = await slaRepo.getPolicy(tenantId, 'EQUIPMENT', 'HIGH');
      expect(fetched?.ackTargetMinutes).toBe(20);
      expect(fetched?.resolveTargetMinutes).toBe(120);

      const policies = await slaRepo.listPolicies(tenantId);
      expect(policies.length).toBeGreaterThanOrEqual(1);
      expect(policies.some((p) => p.category === 'EQUIPMENT' && p.severity === 'HIGH')).toBe(true);
    });
  });

  // ==========================================================================
  // RoutingRuleRepository
  // ==========================================================================
  describe('RoutingRuleRepository', () => {
    it('saves and lists routing rules sorted by priority', async () => {
      const tenantId = 'test-hub-routes';

      await routeRepo.saveRule(tenantId, {
        id: 'RULE-FALLBACK',
        priority: 99,
        name: 'Fallback',
        conditions: {},
        targetTeamId: 'TEAM-LOG',
        reason: 'Fallback rule',
      });

      await routeRepo.saveRule(tenantId, {
        id: 'RULE-DOCK4',
        priority: 1,
        name: 'Dock 4 Conveyor',
        conditions: { assetId: 'CONV-D4' },
        targetTeamId: 'TEAM-MAINT',
        reason: 'Priority rule',
      });

      const rules = await routeRepo.listRules(tenantId);
      expect(rules.length).toBe(2);
      expect(rules[0]?.priority).toBe(1);
      expect(rules[1]?.priority).toBe(99);
    });
  });

  // ==========================================================================
  // LinkRepository
  // ==========================================================================
  describe('LinkRepository', () => {
    it('creates and lists duplicate/related links', async () => {
      const tenantId = 'test-hub-links';
      const link: IncidentLink = {
        parentIncidentId: 'INC-PARENT-01',
        childIncidentId: 'INC-CHILD-02',
        linkType: 'DUPLICATE',
        similarityScore: 0.96,
        linkedBy: 'usr-admin',
        createdAt: new Date().toISOString(),
      };

      await linkRepo.createLink(tenantId, link);
      const links = await linkRepo.getLinks(tenantId, 'INC-PARENT-01');
      expect(links.length).toBe(1);
      expect(links[0]?.childIncidentId).toBe('INC-CHILD-02');
      expect(links[0]?.similarityScore).toBe(0.96);
    });
  });

  // ==========================================================================
  // MetricsRepository (Atomic ADD updates only)
  // ==========================================================================
  // MetricsRepository (Atomic ADD updates only)
  // ==========================================================================
  describe('MetricsRepository', () => {
    it('performs atomic ADD updates without read-modify-write', async () => {
      const tenantId = `test-hub-metrics-${Date.now()}`;
      const date = '2026-09-18';

      // First increment
      const first = await metricsRepo.incrementDailyCounters(tenantId, date, {
        totalIncidents: 1,
        criticalCount: 1,
      });
      expect(first.totalIncidents).toBe(1);
      expect(first.criticalCount).toBe(1);

      // Second atomic ADD
      const second = await metricsRepo.incrementDailyCounters(tenantId, date, {
        totalIncidents: 2,
        criticalCount: 0,
      });
      expect(second.totalIncidents).toBe(3);
      expect(second.criticalCount).toBe(1);

      // Retrieve
      const current = await metricsRepo.getDailyMetrics(tenantId, date);
      expect(current?.totalIncidents).toBe(3);
      expect(current?.criticalCount).toBe(1);
    });
  });

  // ==========================================================================
  // BudgetRepository & RecommendationRepository
  // ==========================================================================
  describe('BudgetRepository & RecommendationRepository', () => {
    it('atomically records token budget consumption', async () => {
      const tenantId = `test-hub-budget-${Date.now()}`;
      const date = '2026-09-18';

      const res1 = await budgetRepo.recordTokenUsage(tenantId, date, {
        inputTokens: 100,
        outputTokens: 50,
      });
      expect(res1.inputTokens).toBe(100);
      expect(res1.totalTokens).toBe(150);

      const res2 = await budgetRepo.recordTokenUsage(tenantId, date, {
        inputTokens: 200,
        outputTokens: 100,
      });
      expect(res2.inputTokens).toBe(300);
      expect(res2.outputTokens).toBe(150);
      expect(res2.totalTokens).toBe(450);
    });

    it('saves and lists prevention recommendations', async () => {
      const tenantId = `test-hub-rec-${Date.now()}`;
      const rec = {
        id: 'REC-001',
        assetId: 'CONV-D4',
        title: 'Replace roller bearings',
        description: 'Frequent jams detected at Dock 4 conveyor',
        suggestedAction: 'Schedule maintenance check',
        confidence: 0.91,
        estimatedSavingsHours: 12.5,
        createdAt: '2026-09-18T08:00:00.000Z',
      };

      await recRepo.saveRecommendation(tenantId, rec);
      const list = await recRepo.listRecommendationsByDate(tenantId, '2026-09-18');
      expect(list.some((r) => r.id === 'REC-001')).toBe(true);
    });
  });

  // ==========================================================================
  // TimelineRepository (Append-only with conditional write check)
  // ==========================================================================
  describe('TimelineRepository', () => {
    it('appends events and rejects duplicate keys via condition expression', async () => {
      const tenantId = `test-hub-timeline-${Date.now()}`;
      const event: TimelineEvent = {
        id: 'EVT-001',
        incidentId: 'INC-TIMELINE-01',
        tenantId,
        type: 'CREATED',
        actorId: 'usr-1',
        timestamp: '2026-09-18T10:00:00.000Z',
        data: { note: 'Initial creation' },
      };

      await timelineRepo.appendEvent(tenantId, event, 1);
      const events = await timelineRepo.listEvents(tenantId, 'INC-TIMELINE-01');
      expect(events.items.length).toBe(1);
      expect(events.items[0]?.id).toBe('EVT-001');

      // Re-appending with the same ID/timestamp must reject
      await expect(timelineRepo.appendEvent(tenantId, event, 1)).rejects.toThrow(
        /conditional/i,
      );
    });
  });

  // ==========================================================================
  // IncidentRepository (GSI1, GSI2, GSI3 Sparse, GSI4)
  // ==========================================================================
  describe('IncidentRepository', () => {
    const tenantId = `test-hub-incidents-${Date.now()}`;

    const baseIncident: Incident = {
      id: '01TESTINCIDENT001',
      tenantId,
      title: 'Conveyor belt jamming at Dock 4',
      description: 'Conveyor stopped suddenly due to package obstruction.',
      status: 'TRIAGING',
      category: 'EQUIPMENT',
      severity: 'HIGH',
      priorityScore: 80,
      scoreBreakdown: {
        businessImpact: { rawValue: 80, normalisedValue: 80, weight: 0.3, contribution: 24, explanation: '' },
        safetyRisk: { rawValue: 80, normalisedValue: 80, weight: 0.25, contribution: 20, explanation: '' },
        slaUrgency: { rawValue: 80, normalisedValue: 80, weight: 0.2, contribution: 16, explanation: '' },
        recurrence: { rawValue: 80, normalisedValue: 80, weight: 0.15, contribution: 12, explanation: '' },
        downtime: { rawValue: 80, normalisedValue: 80, weight: 0.1, contribution: 8, explanation: '' },
        totalScore: 80,
      },
      confidence: 0.95,
      triageMode: 'AI',
      assetId: 'CONV-D4',
      locationId: 'LOC-DOCK-4',
      assignedTeamId: 'TEAM-MAINT',
      ackDueAt: '2026-09-18T11:00:00.000Z',
      resolveDueAt: '2026-09-18T14:00:00.000Z',
      reporterId: 'usr-reporter-01',
      tags: ['dock-4', 'conveyor'],
      metadata: {},
      createdAt: '2026-09-18T10:00:00.000Z',
      updatedAt: '2026-09-18T10:00:00.000Z',
    };

    it('creates and retrieves incident', async () => {
      await incidentRepo.create(tenantId, baseIncident);
      const fetched = await incidentRepo.getById(tenantId, baseIncident.id);
      expect(fetched?.id).toBe(baseIncident.id);
      expect(fetched?.priorityScore).toBe(80);
    });

    it('proves GSI1 ordering with zero-padding (score 80 sorts before score 9)', async () => {
      const lowPriorityIncident: Incident = {
        ...baseIncident,
        id: '01TESTINCIDENT002',
        priorityScore: 9, // Single digit!
        createdAt: '2026-09-18T10:05:00.000Z',
      };
      await incidentRepo.create(tenantId, lowPriorityIncident);

      // Query GSI1 queue for TRIAGING
      const queue = await incidentRepo.queryQueue(tenantId, 'TRIAGING');
      expect(queue.items.length).toBeGreaterThanOrEqual(2);

      const inc80Idx = queue.items.findIndex((i) => i.id === baseIncident.id);
      const inc9Idx = queue.items.findIndex((i) => i.id === lowPriorityIncident.id);

      expect(inc80Idx).toBeGreaterThanOrEqual(0);
      expect(inc9Idx).toBeGreaterThanOrEqual(0);
      // Descending priority: 80 MUST appear BEFORE 9
      expect(inc80Idx).toBeLessThan(inc9Idx);
    });

    it('queries GSI2 by assetId', async () => {
      const assetItems = await incidentRepo.queryByAsset(tenantId, 'CONV-D4');
      expect(assetItems.items.length).toBeGreaterThanOrEqual(2);
      expect(assetItems.items.every((i) => i.assetId === 'CONV-D4')).toBe(true);
    });

    it('queries GSI4 by reporterId', async () => {
      const reporterItems = await incidentRepo.queryByReporter(tenantId, 'usr-reporter-01');
      expect(reporterItems.items.length).toBeGreaterThanOrEqual(2);
      expect(reporterItems.items.every((i) => i.reporterId === 'usr-reporter-01')).toBe(true);
    });

    it('proves GSI3 sparseness: active incident is in GSI3, resolving it REMOVES it from GSI3', async () => {
      const slaIncident: Incident = {
        ...baseIncident,
        id: '01TESTSLAINCIDENT99',
        status: 'NEW',
        ackDueAt: '2026-09-18T12:00:00.000Z',
        resolveDueAt: '2026-09-18T15:00:00.000Z',
      };
      await incidentRepo.create(tenantId, slaIncident);

      // Initial query on GSI3: must include this incident
      const initialSla = await incidentRepo.queryActiveSla(tenantId);
      const initialCount = initialSla.items.length;
      expect(initialCount).toBeGreaterThanOrEqual(1);
      expect(initialSla.items.some((i) => i.id === slaIncident.id)).toBe(true);

      // Resolve the incident
      await incidentRepo.updateStatus(tenantId, slaIncident.id, 'RESOLVED', {
        resolvedAt: new Date().toISOString(),
      });

      // Second query on GSI3: incident MUST be gone
      const afterSla = await incidentRepo.queryActiveSla(tenantId);
      const afterCount = afterSla.items.length;
      expect(afterSla.items.some((i) => i.id === slaIncident.id)).toBe(false);
      expect(afterCount).toBe(initialCount - 1);
    });
  });

  // ==========================================================================
  // Multi-Tenant Isolation
  // ==========================================================================
  describe('Tenant Isolation', () => {
    it('confirms zero overlap between north-hub and south-hub queries', async () => {
      const incNorth: Incident = {
        id: '01NORTHINCIDENT01',
        tenantId: 'north-hub',
        title: 'North Hub item',
        description: 'North item',
        status: 'ACKNOWLEDGED',
        category: 'SAFETY',
        severity: 'LOW',
        priorityScore: 25,
        scoreBreakdown: {
          businessImpact: { rawValue: 25, normalisedValue: 25, weight: 0.3, contribution: 7.5, explanation: '' },
          safetyRisk: { rawValue: 25, normalisedValue: 25, weight: 0.25, contribution: 6.25, explanation: '' },
          slaUrgency: { rawValue: 25, normalisedValue: 25, weight: 0.2, contribution: 5, explanation: '' },
          recurrence: { rawValue: 25, normalisedValue: 25, weight: 0.15, contribution: 3.75, explanation: '' },
          downtime: { rawValue: 25, normalisedValue: 25, weight: 0.1, contribution: 2.5, explanation: '' },
          totalScore: 25,
        },
        confidence: 0.9,
        triageMode: 'MANUAL',
        assetId: null,
        locationId: 'LOC-PICK-1',
        assignedTeamId: 'TEAM-SAFETY',
        ackDueAt: null,
        resolveDueAt: null,
        reporterId: 'usr-north-worker',
        tags: [],
        metadata: {},
        createdAt: '2026-09-18T09:00:00.000Z',
        updatedAt: '2026-09-18T09:00:00.000Z',
      };

      const incSouth: Incident = {
        ...incNorth,
        id: '01SOUTHINCIDENT01',
        tenantId: 'south-hub',
        title: 'South Hub item',
        reporterId: 'usr-south-worker',
      };

      await incidentRepo.create('north-hub', incNorth);
      await incidentRepo.create('south-hub', incSouth);

      const northItems = await incidentRepo.queryQueue('north-hub', 'ACKNOWLEDGED');
      const southItems = await incidentRepo.queryQueue('south-hub', 'ACKNOWLEDGED');

      const northIds = new Set(northItems.items.map((i) => i.id));
      const southIds = new Set(southItems.items.map((i) => i.id));

      expect(northIds.has('01NORTHINCIDENT01')).toBe(true);
      expect(northIds.has('01SOUTHINCIDENT01')).toBe(false);

      expect(southIds.has('01SOUTHINCIDENT01')).toBe(true);
      expect(southIds.has('01NORTHINCIDENT01')).toBe(false);

      const intersection = [...northIds].filter((id) => southIds.has(id));
      expect(intersection).toHaveLength(0);
    });
  });
});
