import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  Incident,
  IncidentAttachment,
  TimelineEvent,
  IncidentLink,
  AuthContext,
} from '@opslens/contracts';
import {
  IncidentRepository,
  TimelineRepository,
  AttachmentRepository,
  LinkRepository,
  MetricsRepository,
} from '@opslens/data';
import { handler } from '../src/index.js';
import * as s3Module from '../src/s3.js';
import * as ebModule from '../src/eventbridge.js';

describe('services/api-incidents', () => {
  const tenantId = 'tenant-test-hub';
  const userId = 'usr-worker-123';

  const validAuthContext: AuthContext = {
    tenantId,
    userId,
    role: 'worker',
    email: 'worker@warehouse.local',
  };

  function createMockEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    return {
      body: null,
      headers: {
        'x-correlation-id': 'corr-test-123',
      },
      multiValueHeaders: {},
      httpMethod: 'GET',
      isBase64Encoded: false,
      path: '/v1/incidents',
      pathParameters: null,
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      stageVariables: null,
      requestContext: {
        accountId: '123456789012',
        apiId: 'mock-api',
        authorizer: {
          ...validAuthContext,
        },
        httpMethod: 'GET',
        identity: {} as any,
        path: '/v1/incidents',
        protocol: 'HTTP/1.1',
        requestId: 'c6af9ac6-7b61-11e6-9a41-93e8deadbeef',
        requestTimeEpoch: 1428582896000,
        resourceId: '123456',
        resourcePath: '/v1/incidents',
        stage: 'local',
      },
      resource: '/v1/incidents',
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // POST /v1/incidents
  // ==========================================================================
  describe('POST /v1/incidents', () => {
    it('creates an incident with status NEW, ULID id, reporterId from AuthContext, timeline event, and EventBridge publish', async () => {
      let createdIncident: Incident | null = null;
      let recordedTimelineEvent: TimelineEvent | null = null;

      vi.spyOn(IncidentRepository.prototype, 'create').mockImplementation(async (_t, inc) => {
        createdIncident = inc;
        return inc;
      });

      vi.spyOn(TimelineRepository.prototype, 'appendEvent').mockImplementation(async (_t, evt) => {
        recordedTimelineEvent = evt;
        return evt;
      });

      const ebSpy = vi
        .spyOn(ebModule, 'publishIncidentCreatedEvent')
        .mockImplementation(async () => {});

      const event = createMockEvent({
        httpMethod: 'POST',
        path: '/v1/incidents',
        body: JSON.stringify({
          description: 'Dock 4 conveyor belt slipped off track and stopped moving completely',
          locationHint: 'LOC-DOCK-4',
          assetHint: 'CONV-D4',
          tags: ['dock4', 'conveyor'],
        }),
      });

      const startTime = Date.now();
      const response = await handler(event);
      const durationMs = Date.now() - startTime;

      expect(response.statusCode).toBe(201);
      expect(durationMs).toBeLessThan(500); // Response under 500ms constraint

      const body = JSON.parse(response.body);
      expect(body.incident).toBeDefined();
      expect(body.incident.status).toBe('NEW');
      expect(body.incident.reporterId).toBe(userId);
      expect(body.incident.tenantId).toBe(tenantId);
      expect(body.incident.locationId).toBe('LOC-DOCK-4');
      expect(body.incident.assetId).toBe('CONV-D4');
      expect(body.incident.priorityScore).toBe(0);
      expect(body.incident.scoreBreakdown).toBeDefined();

      // Verify incident repo persistence
      expect(createdIncident).not.toBeNull();
      expect(createdIncident!.id).toBe(body.incident.id);

      // Verify timeline event INCIDENT_CREATED
      expect(recordedTimelineEvent).not.toBeNull();
      expect(recordedTimelineEvent!.type).toBe('INCIDENT_CREATED');
      expect(recordedTimelineEvent!.actorId).toBe(userId);
      expect(recordedTimelineEvent!.incidentId).toBe(body.incident.id);

      // Verify EventBridge publish
      expect(ebSpy).toHaveBeenCalledTimes(1);
      expect(ebSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'INCIDENT_CREATED',
          tenantId,
          incidentId: body.incident.id,
          correlationId: 'corr-test-123',
          reporterId: userId,
        }),
      );
    });

    it('handles anonymous submission with reporterId ANONYMOUS', async () => {
      vi.spyOn(IncidentRepository.prototype, 'create').mockImplementation(async (_t, inc) => inc);
      vi.spyOn(TimelineRepository.prototype, 'appendEvent').mockImplementation(async (_t, evt) => evt);
      vi.spyOn(ebModule, 'publishIncidentCreatedEvent').mockImplementation(async () => {});

      const event = createMockEvent({
        httpMethod: 'POST',
        path: '/v1/incidents',
        body: JSON.stringify({
          description: 'Spill on aisle 9',
          isAnonymous: true,
        }),
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.incident.reporterId).toBe('ANONYMOUS');
      expect(body.incident.metadata.isAnonymous).toBe(true);
    });

    it('moves staging attachments to permanent incident prefix and creates attachment items', async () => {
      vi.spyOn(IncidentRepository.prototype, 'create').mockImplementation(async (_t, inc) => inc);
      vi.spyOn(TimelineRepository.prototype, 'appendEvent').mockImplementation(async (_t, evt) => evt);
      vi.spyOn(ebModule, 'publishIncidentCreatedEvent').mockImplementation(async () => {});

      const movedKeys: string[] = [];
      vi.spyOn(s3Module, 'moveStagingAttachment').mockImplementation(async (opts) => {
        movedKeys.push(opts.stagingKey);
        return {
          id: 'att-123',
          incidentId: opts.incidentId,
          tenantId: opts.tenantId,
          fileName: 'damage-photo.jpg',
          contentType: 'image/jpeg',
          s3Key: `tenants/${opts.tenantId}/incidents/${opts.incidentId}/damage-photo.jpg`,
          sizeBytes: 1024,
          uploadedBy: opts.uploadedBy,
          createdAt: new Date().toISOString(),
        };
      });

      const stagingKey = `tenants/${tenantId}/incidents/staging/01J8K9L0M1N2P3R4S5T6.jpg`;
      const event = createMockEvent({
        httpMethod: 'POST',
        path: '/v1/incidents',
        body: JSON.stringify({
          description: 'Forklift hydraulic leak observed',
          attachmentKeys: [stagingKey],
        }),
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(201);
      expect(movedKeys).toContain(stagingKey);
    });

    it('rejects invalid staging keys belonging to another tenant', async () => {
      const event = createMockEvent({
        httpMethod: 'POST',
        path: '/v1/incidents',
        body: JSON.stringify({
          description: 'Suspicious leak',
          attachmentKeys: ['tenants/other-tenant/incidents/staging/malicious.jpg'],
        }),
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('BAD_REQUEST');
      expect(body.error.message).toContain('Invalid staging key');
    });

    it('validates request against contracts schema and rejects empty description', async () => {
      const event = createMockEvent({
        httpMethod: 'POST',
        path: '/v1/incidents',
        body: JSON.stringify({
          description: '',
        }),
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ==========================================================================
  // GET /v1/incidents (Listing & Filters)
  // ==========================================================================
  describe('GET /v1/incidents', () => {
    const mockIncident1: Incident = {
      id: '01INCIDENT01',
      tenantId,
      title: 'High priority issue',
      description: 'Critical issue on line 1',
      status: 'NEW',
      category: 'EQUIPMENT',
      severity: 'HIGH',
      priorityScore: 85,
      scoreBreakdown: {
        businessImpact: { rawValue: 85, normalisedValue: 85, weight: 0.3, contribution: 25.5, explanation: '' },
        safetyRisk: { rawValue: 85, normalisedValue: 85, weight: 0.25, contribution: 21.25, explanation: '' },
        slaUrgency: { rawValue: 85, normalisedValue: 85, weight: 0.2, contribution: 17, explanation: '' },
        recurrence: { rawValue: 85, normalisedValue: 85, weight: 0.15, contribution: 12.75, explanation: '' },
        downtime: { rawValue: 85, normalisedValue: 85, weight: 0.1, contribution: 8.5, explanation: '' },
        total: 85,
      },
      confidence: 0.9,
      triageMode: 'AI',
      assetId: 'CONV-1',
      locationId: 'LOC-1',
      assignedTeamId: 'TEAM-MAINT',
      ackDueAt: null,
      resolveDueAt: null,
      reporterId: userId,
      tags: [],
      metadata: {},
      createdAt: '2026-09-18T10:00:00.000Z',
      updatedAt: '2026-09-18T10:00:00.000Z',
    };

    it('uses GSI1 for status-scoped queue listing', async () => {
      const queryQueueSpy = vi
        .spyOn(IncidentRepository.prototype, 'queryQueue')
        .mockImplementation(async () => ({
          items: [mockIncident1],
          nextCursor: 'next-page-cursor',
        }));

      const event = createMockEvent({
        httpMethod: 'GET',
        path: '/v1/incidents',
        queryStringParameters: {
          status: 'NEW',
        },
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.items).toHaveLength(1);
      expect(body.nextCursor).toBe('next-page-cursor');
      expect(queryQueueSpy).toHaveBeenCalledWith(tenantId, 'NEW', {
        limit: 25,
        cursor: undefined,
      });
    });

    it('uses GSI4 for worker submissions query', async () => {
      const queryByReporterSpy = vi
        .spyOn(IncidentRepository.prototype, 'queryByReporter')
        .mockImplementation(async () => ({
          items: [mockIncident1],
          nextCursor: null,
        }));

      const event = createMockEvent({
        httpMethod: 'GET',
        path: '/v1/incidents',
        queryStringParameters: {
          reporterId: userId,
        },
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.items).toHaveLength(1);
      expect(queryByReporterSpy).toHaveBeenCalledWith(tenantId, userId, {
        limit: 25,
        cursor: undefined,
      });
    });

    it('caps limit at 50 per page even if client requests 100', async () => {
      const queryQueueSpy = vi
        .spyOn(IncidentRepository.prototype, 'queryQueue')
        .mockImplementation(async () => ({ items: [], nextCursor: null }));

      const event = createMockEvent({
        httpMethod: 'GET',
        path: '/v1/incidents',
        queryStringParameters: {
          status: 'NEW',
          limit: '100',
        },
      });

      await handler(event);
      expect(queryQueueSpy).toHaveBeenCalledWith(tenantId, 'NEW', {
        limit: 50, // Capped at 50!
        cursor: undefined,
      });
    });
  });

  // ==========================================================================
  // GET /v1/incidents/{id}
  // ==========================================================================
  describe('GET /v1/incidents/{id}', () => {
    const mockIncident: Incident = {
      id: '01INCIDENT99',
      tenantId,
      title: 'Dock 4 motor overheating',
      description: 'Motor temp reached 85C',
      status: 'ACKNOWLEDGED',
      category: 'EQUIPMENT',
      severity: 'HIGH',
      priorityScore: 78,
      scoreBreakdown: {
        businessImpact: { rawValue: 78, normalisedValue: 78, weight: 0.3, contribution: 23.4, explanation: '' },
        safetyRisk: { rawValue: 78, normalisedValue: 78, weight: 0.25, contribution: 19.5, explanation: '' },
        slaUrgency: { rawValue: 78, normalisedValue: 78, weight: 0.2, contribution: 15.6, explanation: '' },
        recurrence: { rawValue: 78, normalisedValue: 78, weight: 0.15, contribution: 11.7, explanation: '' },
        downtime: { rawValue: 78, normalisedValue: 78, weight: 0.1, contribution: 7.8, explanation: '' },
        total: 78,
      },
      confidence: 0.95,
      triageMode: 'AI',
      assetId: 'CONV-D4',
      locationId: 'LOC-DOCK-4',
      assignedTeamId: 'TEAM-MAINT',
      ackDueAt: '2026-09-18T11:00:00.000Z',
      resolveDueAt: '2026-09-18T14:00:00.000Z',
      acknowledgedAt: '2026-09-18T10:30:00.000Z',
      reporterId: userId,
      tags: [],
      metadata: {},
      createdAt: '2026-09-18T10:00:00.000Z',
      updatedAt: '2026-09-18T10:30:00.000Z',
    };

    const mockTimelineEvent: TimelineEvent = {
      id: '01EVT01',
      incidentId: '01INCIDENT99',
      tenantId,
      type: 'INCIDENT_CREATED',
      actorId: userId,
      actorRole: 'worker',
      timestamp: '2026-09-18T10:00:00.000Z',
      data: { description: 'Motor temp reached 85C' },
    };

    const mockAttachment: IncidentAttachment = {
      id: '01ATT01',
      incidentId: '01INCIDENT99',
      tenantId,
      fileName: 'thermal-scan.png',
      contentType: 'image/png',
      s3Key: `tenants/${tenantId}/incidents/01INCIDENT99/thermal-scan.png`,
      sizeBytes: 2048,
      uploadedBy: userId,
      createdAt: '2026-09-18T10:01:00.000Z',
    };

    const mockLink: IncidentLink = {
      parentIncidentId: '01INCIDENT99',
      childIncidentId: '01INCIDENT98',
      linkType: 'DUPLICATE',
      similarityScore: 0.96,
      linkedBy: 'AI_SYSTEM',
      createdAt: '2026-09-18T10:05:00.000Z',
    };

    it('returns incident, score breakdown, timeline (ascending), attachments with presigned GET URLs, and related incidents', async () => {
      vi.spyOn(IncidentRepository.prototype, 'getById').mockImplementation(async () => mockIncident);
      vi.spyOn(TimelineRepository.prototype, 'listEvents').mockImplementation(async () => ({
        items: [mockTimelineEvent],
        nextCursor: null,
      }));
      vi.spyOn(AttachmentRepository.prototype, 'listAttachments').mockImplementation(async () => [
        mockAttachment,
      ]);
      vi.spyOn(LinkRepository.prototype, 'getLinks').mockImplementation(async () => [mockLink]);

      vi.spyOn(s3Module, 'generatePresignedGetUrl').mockImplementation(
        async (key) => `https://s3.amazonaws.com/media/${key}?token=presigned123`,
      );

      const event = createMockEvent({
        httpMethod: 'GET',
        path: '/v1/incidents/01INCIDENT99',
        pathParameters: {
          id: '01INCIDENT99',
        },
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.incident).toBeDefined();
      expect(body.incident.id).toBe('01INCIDENT99');
      expect(body.scoreBreakdown).toBeDefined();
      expect(body.scoreBreakdown.total).toBe(78);
      expect(body.timeline).toHaveLength(1);
      expect(body.timeline[0].type).toBe('INCIDENT_CREATED');
      expect(body.attachments).toHaveLength(1);
      expect(body.attachments[0].downloadUrl).toContain('presigned123');
      expect(body.relatedIncidents).toHaveLength(1);
      expect(body.relatedIncidents[0].linkType).toBe('DUPLICATE');
    });

    it('returns 404 INCIDENT_NOT_FOUND when incident does not exist', async () => {
      vi.spyOn(IncidentRepository.prototype, 'getById').mockImplementation(async () => null);

      const event = createMockEvent({
        httpMethod: 'GET',
        path: '/v1/incidents/NONEXISTENT',
        pathParameters: {
          id: 'NONEXISTENT',
        },
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(404);

      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INCIDENT_NOT_FOUND');
      expect(body.error.correlationId).toBe('corr-test-123');
    });
  });

  // ==========================================================================
  // Auth & Error Handling Wrapper
  // ==========================================================================
  describe('Shared Auth & Error Wrapper', () => {
    it('returns 401 UNAUTHORIZED when authorizer context is missing', async () => {
      const event = createMockEvent({
        requestContext: {
          ...createMockEvent().requestContext,
          authorizer: null as any,
        },
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.correlationId).toBe('corr-test-123');
    });

    it('returns 400 BAD_REQUEST on unsupported routes', async () => {
      const event = createMockEvent({
        httpMethod: 'DELETE',
        path: '/v1/incidents/some-id',
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('BAD_REQUEST');
    });
  });

  describe('POST /v1/incidents/{id}/answer', () => {
    it('accepts clarification, appends to description, and re-runs triage', async () => {
      const incId = '01NEEDINFO01';
      let storedIncident: Incident = {
        id: incId,
        tenantId,
        title: 'Vague report',
        description: 'something is wrong near the back',
        status: 'NEEDS_INFO',
        category: 'OPERATIONS',
        severity: 'LOW',
        priorityScore: 20,
        scoreBreakdown: {
          businessImpact: { rawValue: 0, normalisedValue: 0, weight: 0.3, contribution: 0, explanation: '' },
          safetyRisk: { rawValue: 0, normalisedValue: 0, weight: 0.25, contribution: 0, explanation: '' },
          slaUrgency: { rawValue: 0, normalisedValue: 0, weight: 0.2, contribution: 0, explanation: '' },
          recurrence: { rawValue: 0, normalisedValue: 0, weight: 0.15, contribution: 0, explanation: '' },
          downtime: { rawValue: 0, normalisedValue: 0, weight: 0.1, contribution: 0, explanation: '' },
          total: 20,
        },
        confidence: 0.45,
        triageMode: 'AI',
        assetId: null,
        locationId: null,
        assignedTeamId: null,
        ackDueAt: null,
        resolveDueAt: null,
        reporterId: 'usr-worker-123',
        tags: [],
        metadata: {
          clarifyingQuestion: 'Can you specify which area or equipment is having an issue near the back?',
        },
        createdAt: '2026-09-18T10:00:00.000Z',
        updatedAt: '2026-09-18T10:00:00.000Z',
      };

      vi.spyOn(IncidentRepository.prototype, 'getById').mockImplementation(async (_t, id) => {
        if (id === incId) return { ...storedIncident };
        return null;
      });

      vi.spyOn(IncidentRepository.prototype, 'update').mockImplementation(async (_t, id, patch) => {
        if (id === incId) {
          storedIncident = { ...storedIncident, ...patch, updatedAt: new Date().toISOString() };
          return { ...storedIncident };
        }
        throw new Error(`Not found: ${id}`);
      });

      vi.spyOn(TimelineRepository.prototype, 'appendEvent').mockImplementation(async (_t, evt) => evt);

      const event = createMockEvent({
        httpMethod: 'POST',
        path: `/v1/incidents/${incId}/answer`,
        pathParameters: { id: incId },
        body: JSON.stringify({
          answer: 'Dock 4 conveyor motor tripped again with loud noise.',
        }),
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.incident).toBeDefined();
      expect(body.incident.description).toContain('Clarification: Dock 4 conveyor motor tripped again');
      expect(body.incident.status).not.toBe('NEEDS_INFO');
      expect(body.incident.status).not.toBe('TRIAGING');
    });

    it('rejects empty answer with 400 VALIDATION_ERROR', async () => {
      const event = createMockEvent({
        httpMethod: 'POST',
        path: '/v1/incidents/01NEEDINFO01/answer',
        pathParameters: { id: '01NEEDINFO01' },
        body: JSON.stringify({ answer: '   ' }),
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects answer if incident is not in NEEDS_INFO with 400', async () => {
      const incId = '01INCIDENT99';
      const openIncident: Incident = {
        id: incId,
        tenantId,
        title: 'Open Incident',
        description: 'Already in progress',
        status: 'NEW',
        category: 'OPERATIONS',
        severity: 'MEDIUM',
        priorityScore: 50,
        scoreBreakdown: {
          businessImpact: { rawValue: 0, normalisedValue: 0, weight: 0.3, contribution: 0, explanation: '' },
          safetyRisk: { rawValue: 0, normalisedValue: 0, weight: 0.25, contribution: 0, explanation: '' },
          slaUrgency: { rawValue: 0, normalisedValue: 0, weight: 0.2, contribution: 0, explanation: '' },
          recurrence: { rawValue: 0, normalisedValue: 0, weight: 0.15, contribution: 0, explanation: '' },
          downtime: { rawValue: 0, normalisedValue: 0, weight: 0.1, contribution: 0, explanation: '' },
          total: 50,
        },
        confidence: 0.8,
        triageMode: 'AI',
        assetId: null,
        locationId: null,
        assignedTeamId: null,
        ackDueAt: null,
        resolveDueAt: null,
        reporterId: 'usr-worker-123',
        tags: [],
        metadata: {},
        createdAt: '2026-09-18T10:00:00.000Z',
        updatedAt: '2026-09-18T10:00:00.000Z',
      };

      vi.spyOn(IncidentRepository.prototype, 'getById').mockImplementation(async (_t, id) => {
        if (id === incId) return openIncident;
        return null;
      });

      const event = createMockEvent({
        httpMethod: 'POST',
        path: `/v1/incidents/${incId}/answer`,
        pathParameters: { id: incId },
        body: JSON.stringify({ answer: 'Some clarification' }),
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PATCH /v1/incidents/{id} - Priority Override', () => {
    it('allows supervisor to override priority, updates priorityScore, and preserves computed breakdown', async () => {
      const incId = '01OVERRIDE01';
      const originalIncident: Incident = {
        id: incId,
        tenantId,
        title: 'Low Priority Issue',
        description: 'Conveyor jammed',
        status: 'NEW',
        category: 'EQUIPMENT',
        severity: 'LOW',
        priorityScore: 28,
        scoreBreakdown: {
          businessImpact: { rawValue: 5, normalisedValue: 20, weight: 0.3, contribution: 6, explanation: 'Low impact' },
          safetyRisk: { rawValue: 10, normalisedValue: 10, weight: 0.25, contribution: 2.5, explanation: 'Clean' },
          slaUrgency: { rawValue: 0, normalisedValue: 0, weight: 0.2, contribution: 0, explanation: 'Fresh' },
          recurrence: { rawValue: 0, normalisedValue: 0, weight: 0.15, contribution: 0, explanation: 'First time' },
          downtime: { rawValue: 3, normalisedValue: 15, weight: 0.1, contribution: 1.5, explanation: 'Brief' },
          total: 28,
        },
        confidence: 0.9,
        triageMode: 'AI',
        assetId: 'CONV-01',
        locationId: 'LOC-DOCK-1',
        assignedTeamId: null,
        ackDueAt: null,
        resolveDueAt: null,
        reporterId: 'usr-worker-123',
        tags: [],
        metadata: {},
        createdAt: '2026-09-18T10:00:00.000Z',
        updatedAt: '2026-09-18T10:00:00.000Z',
      };

      let storedIncident = { ...originalIncident };
      vi.spyOn(IncidentRepository.prototype, 'getById').mockImplementation(async (_t, id) => {
        if (id === incId) return storedIncident;
        return null;
      });

      vi.spyOn(IncidentRepository.prototype, 'update').mockImplementation(async (_t, id, patch) => {
        storedIncident = { ...storedIncident, ...patch } as Incident;
        return storedIncident;
      });

      const timelineSpy = vi.spyOn(TimelineRepository.prototype, 'appendEvent');

      const event = createMockEvent({
        httpMethod: 'PATCH',
        path: `/v1/incidents/${incId}`,
        pathParameters: { id: incId },
        body: JSON.stringify({
          manualPriority: 95,
          overrideReason: 'Critical customer VIP shipment blocked on line',
        }),
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.priorityScore).toBe(95);
      expect(body.metadata.manualPriority).toBe(95);
      expect(body.metadata.overrideReason).toBe('Critical customer VIP shipment blocked on line');
      expect(body.metadata.overriddenBy).toBe('usr-worker-123');

      // Crucially, verify original computed score breakdown is preserved
      expect(body.scoreBreakdown).toBeDefined();
      expect(body.scoreBreakdown.total).toBe(28);

      // Verify timeline event logged
      expect(timelineSpy).toHaveBeenCalled();
      const recordedEvent = timelineSpy.mock.calls[0]?.[1];
      expect(recordedEvent?.data?.action).toBe('PRIORITY_OVERRIDE');
      expect(recordedEvent?.data?.manualPriority).toBe(95);
      expect(recordedEvent?.data?.previousPriority).toBe(28);
    });
  });

  // ==========================================================================
  // GET /v1/incidents/{id}/related
  // ==========================================================================
  describe('GET /v1/incidents/{id}/related', () => {
    it('returns 404 when target incident does not exist', async () => {
      vi.spyOn(IncidentRepository.prototype, 'getById').mockResolvedValue(null);

      const event = createMockEvent({
        httpMethod: 'GET',
        path: '/v1/incidents/inc-nonexistent/related',
        pathParameters: { id: 'inc-nonexistent' },
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INCIDENT_NOT_FOUND');
    });

    it('returns related links sorted descending by similarity with hydrated incident data', async () => {
      const incId = 'inc-target-001';
      const relId1 = 'inc-rel-001';
      const relId2 = 'inc-rel-002';

      vi.spyOn(IncidentRepository.prototype, 'getById').mockImplementation(async (_t, id) => {
        if (id === incId) {
          return {
            id: incId,
            tenantId,
            title: 'Target incident',
            description: 'Dock 4 conveyor motor issue',
            status: 'NEW',
            category: 'EQUIPMENT',
            severity: 'HIGH',
            priorityScore: 75,
            reporterId: userId,
            createdAt: '2026-03-01T10:00:00Z',
            updatedAt: '2026-03-01T10:00:00Z',
          } as Incident;
        }
        if (id === relId1) {
          return {
            id: relId1,
            tenantId,
            title: 'Dock 4 conveyor stop',
            description: 'Conveyor jammed',
            status: 'OPEN',
            category: 'EQUIPMENT',
            severity: 'HIGH',
            priorityScore: 80,
            reporterId: 'usr-2',
            createdAt: '2026-02-28T10:00:00Z',
            updatedAt: '2026-02-28T10:00:00Z',
          } as Incident;
        }
        if (id === relId2) {
          return {
            id: relId2,
            tenantId,
            title: 'Dock 4 sensor misalignment',
            description: 'Sensor loose',
            status: 'RESOLVED',
            category: 'EQUIPMENT',
            severity: 'MEDIUM',
            priorityScore: 50,
            reporterId: 'usr-3',
            createdAt: '2026-02-20T10:00:00Z',
            updatedAt: '2026-02-20T10:00:00Z',
          } as Incident;
        }
        return null;
      });

      vi.spyOn(LinkRepository.prototype, 'getLinks').mockResolvedValue([
        {
          parentIncidentId: incId,
          childIncidentId: relId1,
          linkType: 'DUPLICATE_CANDIDATE',
          similarityScore: 0.92,
          reason: 'High semantic similarity (0.920) on same asset',
          linkedBy: 'system',
          createdAt: '2026-03-01T10:05:00Z',
        },
        {
          parentIncidentId: incId,
          childIncidentId: relId2,
          linkType: 'RELATED',
          similarityScore: 0.74,
          reason: 'Related incident (similarity 0.740)',
          linkedBy: 'system',
          createdAt: '2026-03-01T10:05:00Z',
        },
      ]);

      const event = createMockEvent({
        httpMethod: 'GET',
        path: `/v1/incidents/${incId}/related`,
        pathParameters: { id: incId },
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.incidentId).toBe(incId);
      expect(body.total).toBe(2);
      expect(body.items).toHaveLength(2);
      expect(body.items[0].linkType).toBe('DUPLICATE_CANDIDATE');
      expect(body.items[0].similarityScore).toBe(0.92);
      expect(body.items[0].incident.id).toBe(relId1);
      expect(body.items[1].linkType).toBe('RELATED');
      expect(body.items[1].similarityScore).toBe(0.74);
      expect(body.items[1].incident.id).toBe(relId2);
    });
  });

  // ==========================================================================
  // POST /v1/incidents/{id}/merge
  // ==========================================================================
  describe('POST /v1/incidents/{id}/merge', () => {
    it('returns 403 Forbidden when a worker attempts to merge', async () => {
      const event = createMockEvent({
        httpMethod: 'POST',
        path: '/v1/incidents/inc-child-1/merge',
        pathParameters: { id: 'inc-child-1' },
        body: JSON.stringify({ parentIncidentId: 'inc-parent-1' }),
        requestContext: {
          ...createMockEvent().requestContext,
          authorizer: {
            ...validAuthContext,
            role: 'worker',
          },
        } as any,
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 409 Conflict when attempting to merge an incident into itself', async () => {
      const event = createMockEvent({
        httpMethod: 'POST',
        path: '/v1/incidents/inc-same-1/merge',
        pathParameters: { id: 'inc-same-1' },
        body: JSON.stringify({ parentIncidentId: 'inc-same-1' }),
        requestContext: {
          ...createMockEvent().requestContext,
          authorizer: {
            ...validAuthContext,
            role: 'supervisor',
          },
        } as any,
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toContain('into itself');
    });

    it('returns 409 Conflict when child incident is already merged', async () => {
      vi.spyOn(IncidentRepository.prototype, 'getById').mockResolvedValue({
        id: 'inc-child-already',
        tenantId,
        title: 'Already merged child',
        description: 'Old report',
        status: 'MERGED',
        category: 'EQUIPMENT',
        severity: 'LOW',
        priorityScore: 10,
        reporterId: userId,
        createdAt: '2026-03-01T10:00:00Z',
        updatedAt: '2026-03-01T10:00:00Z',
      } as Incident);

      const event = createMockEvent({
        httpMethod: 'POST',
        path: '/v1/incidents/inc-child-already/merge',
        pathParameters: { id: 'inc-child-already' },
        body: JSON.stringify({ parentIncidentId: 'inc-parent-1' }),
        requestContext: {
          ...createMockEvent().requestContext,
          authorizer: {
            ...validAuthContext,
            role: 'supervisor',
          },
        } as any,
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toContain('already merged');
    });

    it('successfully merges child into parent: transfers attachments, updates child status, creates link, logs timeline, and increments metric', async () => {
      const childId = 'inc-child-99';
      const parentId = 'inc-parent-99';

      const childIncident: Incident = {
        id: childId,
        tenantId,
        title: 'Duplicate belt issue',
        description: 'Belt stuck on conveyor 4',
        status: 'NEW',
        category: 'EQUIPMENT',
        severity: 'HIGH',
        priorityScore: 70,
        reporterId: 'usr-worker-1',
        createdAt: '2026-03-01T10:00:00Z',
        updatedAt: '2026-03-01T10:00:00Z',
      };

      const parentIncident: Incident = {
        id: parentId,
        tenantId,
        title: 'Primary belt jam',
        description: 'Conveyor belt jammed at Dock 4',
        status: 'OPEN',
        category: 'EQUIPMENT',
        severity: 'HIGH',
        priorityScore: 82,
        reporterId: 'usr-worker-2',
        createdAt: '2026-03-01T09:30:00Z',
        updatedAt: '2026-03-01T09:30:00Z',
      };

      vi.spyOn(IncidentRepository.prototype, 'getById').mockImplementation(async (_t, id) => {
        if (id === childId) return childIncident;
        if (id === parentId) return parentIncident;
        return null;
      });

      const childAttachment: IncidentAttachment = {
        id: 'att-child-1',
        incidentId: childId,
        tenantId,
        fileName: 'belt-photo.jpg',
        contentType: 'image/jpeg',
        s3Key: 'tenants/tenant-test-hub/incidents/inc-child-99/belt-photo.jpg',
        sizeBytes: 4096,
        uploadedBy: 'usr-worker-1',
        createdAt: '2026-03-01T10:01:00Z',
      };

      vi.spyOn(AttachmentRepository.prototype, 'listAttachments').mockResolvedValue([childAttachment]);
      const createAttachmentSpy = vi.spyOn(AttachmentRepository.prototype, 'createAttachment').mockImplementation(async (_t, att) => att);

      const timelineSpy = vi.spyOn(TimelineRepository.prototype, 'appendEvent').mockImplementation(async (_t, evt) => evt);

      const updateStatusSpy = vi.spyOn(IncidentRepository.prototype, 'updateStatus').mockImplementation(async (_t, id, status, patch) => {
        return {
          ...childIncident,
          status,
          ...patch,
        } as Incident;
      });

      const createLinkSpy = vi.spyOn(LinkRepository.prototype, 'createLink').mockImplementation(async (_t, link) => link);
      const metricsSpy = vi.spyOn(MetricsRepository.prototype, 'incrementDailyCounters').mockResolvedValue({});

      const event = createMockEvent({
        httpMethod: 'POST',
        path: `/v1/incidents/${childId}/merge`,
        pathParameters: { id: childId },
        body: JSON.stringify({
          parentIncidentId: parentId,
          reason: 'Identical conveyor belt failure reported by two workers',
        }),
        requestContext: {
          ...createMockEvent().requestContext,
          authorizer: {
            ...validAuthContext,
            userId: 'usr-supervisor-99',
            role: 'supervisor',
          },
        } as any,
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.childIncident.status).toBe('MERGED');
      expect(body.childIncident.metadata.mergedIntoIncidentId).toBe(parentId);
      expect(body.childIncident.metadata.mergedBy).toBe('usr-supervisor-99');
      expect(body.transferredAttachments).toBe(1);

      // Attachment transferred to parent
      expect(createAttachmentSpy).toHaveBeenCalledTimes(1);
      const transferredAtt = createAttachmentSpy.mock.calls[0]?.[1];
      expect(transferredAtt.incidentId).toBe(parentId);
      expect(transferredAtt.fileName).toBe('belt-photo.jpg');

      // Timeline events appended to both parent and child
      expect(timelineSpy).toHaveBeenCalledTimes(2);
      const parentTimeline = timelineSpy.mock.calls.find((call) => call[1].incidentId === parentId)?.[1];
      const childTimeline = timelineSpy.mock.calls.find((call) => call[1].incidentId === childId)?.[1];
      expect(parentTimeline).toBeDefined();
      expect(parentTimeline?.data?.action).toBe('MERGED_CHILD');
      expect(parentTimeline?.data?.childDescription).toBe(childIncident.description);
      expect(childTimeline).toBeDefined();
      expect(childTimeline?.data?.action).toBe('MERGED_INTO_PARENT');

      // Update status called
      expect(updateStatusSpy).toHaveBeenCalledWith(
        tenantId,
        childId,
        'MERGED',
        expect.objectContaining({
          metadata: expect.objectContaining({
            mergedIntoIncidentId: parentId,
            mergedBy: 'usr-supervisor-99',
          }),
        }),
      );

      // Duplicate link created
      expect(createLinkSpy).toHaveBeenCalledWith(
        tenantId,
        expect.objectContaining({
          parentIncidentId: parentId,
          childIncidentId: childId,
          linkType: 'DUPLICATE',
          similarityScore: 1.0,
        }),
      );

      // Metrics counter incremented
      expect(metricsSpy).toHaveBeenCalledWith(
        tenantId,
        expect.any(String),
        { duplicates: 1 },
      );
    });
  });

  // ==========================================================================
  // PATCH /v1/incidents/{id} - Reassignment & Lifecycle Transitions
  // ==========================================================================
  describe('PATCH /v1/incidents/{id} - Reassignment & Transitions', () => {
    it('returns 403 Forbidden when a worker attempts reassignment', async () => {
      const incId = 'inc-reassign-001';
      vi.spyOn(IncidentRepository.prototype, 'getById').mockResolvedValue({
        id: incId,
        tenantId,
        title: 'Test',
        status: 'ROUTED',
        assignedTeamId: 'TEAM-LOGISTICS',
      } as Incident);

      const event = createMockEvent({
        httpMethod: 'PATCH',
        path: `/v1/incidents/${incId}`,
        pathParameters: { id: incId },
        body: JSON.stringify({
          assignedTeamId: 'TEAM-MAINT',
          reason: 'Mechanical failure needs maintenance team',
        }),
        requestContext: {
          ...createMockEvent().requestContext,
          authorizer: {
            ...validAuthContext,
            role: 'worker',
          },
        } as any,
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 400 Bad Request when reassignment is missing reason', async () => {
      const incId = 'inc-reassign-002';
      vi.spyOn(IncidentRepository.prototype, 'getById').mockResolvedValue({
        id: incId,
        tenantId,
        title: 'Test',
        status: 'ROUTED',
        assignedTeamId: 'TEAM-LOGISTICS',
      } as Incident);

      const event = createMockEvent({
        httpMethod: 'PATCH',
        path: `/v1/incidents/${incId}`,
        pathParameters: { id: incId },
        body: JSON.stringify({
          assignedTeamId: 'TEAM-MAINT',
        }),
        requestContext: {
          ...createMockEvent().requestContext,
          authorizer: {
            ...validAuthContext,
            role: 'supervisor',
          },
        } as any,
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('BAD_REQUEST');
      expect(body.error.message).toContain('Reason is required');
    });

    it('successfully reassigns team, logs timeline event, and preserves existing SLA timers', async () => {
      const incId = 'inc-reassign-003';
      const initialAckDueAt = '2026-09-19T10:30:00.000Z';
      const initialResolveDueAt = '2026-09-19T14:30:00.000Z';

      const existingIncident: Incident = {
        id: incId,
        tenantId,
        title: 'Dock 4 issue',
        description: 'Conveyor stoppage',
        status: 'ROUTED',
        category: 'EQUIPMENT',
        severity: 'HIGH',
        priorityScore: 75,
        assignedTeamId: 'TEAM-LOGISTICS',
        ackDueAt: initialAckDueAt,
        resolveDueAt: initialResolveDueAt,
        reporterId: 'usr-1',
        createdAt: '2026-09-19T09:00:00.000Z',
        updatedAt: '2026-09-19T09:00:00.000Z',
      };

      vi.spyOn(IncidentRepository.prototype, 'getById').mockResolvedValue(existingIncident);
      const updateSpy = vi.spyOn(IncidentRepository.prototype, 'update').mockImplementation(async (_t, _id, patch) => {
        return {
          ...existingIncident,
          ...patch,
        } as Incident;
      });

      const timelineSpy = vi.spyOn(TimelineRepository.prototype, 'appendEvent').mockImplementation(async (_t, evt) => evt);

      const event = createMockEvent({
        httpMethod: 'PATCH',
        path: `/v1/incidents/${incId}`,
        pathParameters: { id: incId },
        body: JSON.stringify({
          assignedTeamId: 'TEAM-MAINT',
          reason: 'Needs mechanical technicians with conveyor tooling',
        }),
        requestContext: {
          ...createMockEvent().requestContext,
          authorizer: {
            ...validAuthContext,
            role: 'supervisor',
            userId: 'usr-sup-1',
          },
        } as any,
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.assignedTeamId).toBe('TEAM-MAINT');
      // Crucial: SLA timers must NOT be reset or altered
      expect(body.ackDueAt).toBe(initialAckDueAt);
      expect(body.resolveDueAt).toBe(initialResolveDueAt);

      // Verify timeline event logged
      expect(timelineSpy).toHaveBeenCalled();
      const recorded = timelineSpy.mock.calls.find((c) => c[1].type === 'ROUTED')?.[1];
      expect(recorded).toBeDefined();
      expect(recorded?.data?.action).toBe('REASSIGNED');
      expect(recorded?.data?.previousTeamId).toBe('TEAM-LOGISTICS');
      expect(recorded?.data?.assignedTeamId).toBe('TEAM-MAINT');
      expect(recorded?.data?.reason).toBe('Needs mechanical technicians with conveyor tooling');
    });

    it('returns 409 INCIDENT_INVALID_TRANSITION on illegal state transition (e.g. ROUTED -> CLOSED)', async () => {
      const incId = 'inc-illegal-001';
      vi.spyOn(IncidentRepository.prototype, 'getById').mockResolvedValue({
        id: incId,
        tenantId,
        title: 'Test',
        status: 'ROUTED',
      } as Incident);

      const event = createMockEvent({
        httpMethod: 'PATCH',
        path: `/v1/incidents/${incId}`,
        pathParameters: { id: incId },
        body: JSON.stringify({
          status: 'CLOSED',
        }),
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INCIDENT_INVALID_TRANSITION');
      expect(body.error.message).toContain('Illegal transition from ROUTED to CLOSED');
    });

    it('returns 200 and logs STATUS_CHANGED on legal state transition (e.g. ROUTED -> ACKNOWLEDGED)', async () => {
      const incId = 'inc-legal-001';
      const existingIncident: Incident = {
        id: incId,
        tenantId,
        title: 'Test',
        status: 'ROUTED',
        createdAt: '2026-09-19T09:00:00.000Z',
        updatedAt: '2026-09-19T09:00:00.000Z',
      } as Incident;

      vi.spyOn(IncidentRepository.prototype, 'getById').mockResolvedValue(existingIncident);
      vi.spyOn(IncidentRepository.prototype, 'update').mockImplementation(async (_t, _id, patch) => {
        return {
          ...existingIncident,
          ...patch,
        } as Incident;
      });

      const timelineSpy = vi.spyOn(TimelineRepository.prototype, 'appendEvent').mockImplementation(async (_t, evt) => evt);

      const event = createMockEvent({
        httpMethod: 'PATCH',
        path: `/v1/incidents/${incId}`,
        pathParameters: { id: incId },
        body: JSON.stringify({
          status: 'ACKNOWLEDGED',
        }),
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ACKNOWLEDGED');

      const recorded = timelineSpy.mock.calls.find((c) => c[1].type === 'STATUS_CHANGED')?.[1];
      expect(recorded).toBeDefined();
      expect(recorded?.data?.previousStatus).toBe('ROUTED');
      expect(recorded?.data?.newStatus).toBe('ACKNOWLEDGED');
    });
  });
});
