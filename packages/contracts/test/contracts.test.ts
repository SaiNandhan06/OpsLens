import { describe, it, expect } from 'vitest';
import {
  // Auth
  RoleEnum,
  AuthContextSchema,
  // Scoring
  ScoreFactorSchema,
  ScoreBreakdownSchema,
  ScoringWeightsSchema,
  // Incident
  IncidentStatusEnum,
  IncidentCategoryEnum,
  SeverityEnum,
  TimelineEventTypeEnum,
  LinkTypeEnum,
  TriageModeEnum,
  FieldSourceEnum,
  TriageResultSchema,
  TimelineEventSchema,
  IncidentAttachmentSchema,
  IncidentLinkSchema,
  IncidentSchema,
  // Errors
  ErrorCodeEnum,
  ErrorEnvelopeSchema,
  // Events
  IncidentCreatedEventSchema,
  IncidentTriagedEventSchema,
  IncidentRoutedEventSchema,
  IncidentNeedsInfoEventSchema,
  SlaBreachedEventSchema,
  IncidentEscalatedEventSchema,
  IncidentResolvedEventSchema,
  OpsLensEventSchema,
  // API
  CreateIncidentRequestSchema,
  ListIncidentsQuerySchema,
  PatchIncidentRequestSchema,
  AddCommentRequestSchema,
  MergeIncidentRequestSchema,
  AnswerClarificationRequestSchema,
  GetPresignedUploadUrlRequestSchema,
  GetDashboardSummaryResponseSchema,
  HotspotItemSchema,
  RecommendationItemSchema,
  SlaPolicySchema,
  UpdateScoringWeightsRequestSchema,
  ResetDemoRequestSchema,
} from '../src/index.js';

describe('packages/contracts', () => {
  describe('Enums', () => {
    it('validates RoleEnum correctly', () => {
      expect(RoleEnum.safeParse('worker').success).toBe(true);
      expect(RoleEnum.safeParse('maintenance').success).toBe(true);
      expect(RoleEnum.safeParse('supervisor').success).toBe(true);
      expect(RoleEnum.safeParse('manager').success).toBe(true);
      expect(RoleEnum.safeParse('admin').success).toBe(true);
      expect(RoleEnum.safeParse('unauthorized_role').success).toBe(false);
    });

    it('validates IncidentStatusEnum correctly', () => {
      const validStatuses = [
        'NEW',
        'TRIAGING',
        'ROUTED',
        'ACKNOWLEDGED',
        'IN_PROGRESS',
        'RESOLVED',
        'CLOSED',
        'NEEDS_INFO',
        'MERGED',
        'REOPENED',
      ];
      for (const status of validStatuses) {
        expect(IncidentStatusEnum.safeParse(status).success).toBe(true);
      }
      expect(IncidentStatusEnum.safeParse('PENDING_REVIEW').success).toBe(false);
    });

    it('validates 7 warehouse IncidentCategoryEnum correctly', () => {
      const categories = [
        'EQUIPMENT',
        'SAFETY',
        'FACILITY',
        'INVENTORY',
        'OPERATIONS',
        'ENVIRONMENTAL',
        'SECURITY',
      ];
      expect(categories).toHaveLength(7);
      for (const category of categories) {
        expect(IncidentCategoryEnum.safeParse(category).success).toBe(true);
      }
      expect(IncidentCategoryEnum.safeParse('UNKNOWN_CATEGORY').success).toBe(false);
    });

    it('validates SeverityEnum, TimelineEventTypeEnum, LinkTypeEnum, TriageModeEnum, FieldSourceEnum', () => {
      expect(SeverityEnum.safeParse('CRITICAL').success).toBe(true);
      expect(SeverityEnum.safeParse('LOW').success).toBe(true);
      expect(SeverityEnum.safeParse('URGENT').success).toBe(false);

      expect(TimelineEventTypeEnum.safeParse('CREATED').success).toBe(true);
      expect(TimelineEventTypeEnum.safeParse('SLA_BREACHED').success).toBe(true);
      expect(TimelineEventTypeEnum.safeParse('INVALID_EVENT').success).toBe(false);

      expect(LinkTypeEnum.safeParse('DUPLICATE').success).toBe(true);
      expect(LinkTypeEnum.safeParse('COUSIN').success).toBe(false);

      expect(TriageModeEnum.safeParse('AI').success).toBe(true);
      expect(TriageModeEnum.safeParse('FALLBACK').success).toBe(true);
      expect(TriageModeEnum.safeParse('RANDOM').success).toBe(false);

      expect(FieldSourceEnum.safeParse('USER').success).toBe(true);
      expect(FieldSourceEnum.safeParse('FALLBACK').success).toBe(true);
      expect(FieldSourceEnum.safeParse('EXTERNAL').success).toBe(false);
    });
  });

  describe('AuthContextSchema', () => {
    it('accepts a valid AuthContext fixture', () => {
      const fixture = {
        tenantId: 'tenant-123',
        userId: 'usr-456',
        role: 'supervisor',
        email: 'supervisor@warehouse.com',
      };
      const result = AuthContextSchema.safeParse(fixture);
      expect(result.success).toBe(true);
    });

    it('rejects a malformed AuthContext fixture', () => {
      const invalidFixture = {
        tenantId: '',
        userId: 'usr-456',
        role: 'invalid_role',
        email: 'not-an-email',
      };
      const result = AuthContextSchema.safeParse(invalidFixture);
      expect(result.success).toBe(false);
    });
  });

  describe('Scoring Schemas', () => {
    const validFactor = {
      rawValue: 80,
      normalisedValue: 80,
      weight: 0.25,
      contribution: 20,
      explanation: 'Moderate line blockage impact',
    };

    it('accepts valid ScoreFactor and rejects invalid', () => {
      expect(ScoreFactorSchema.safeParse(validFactor).success).toBe(true);
      expect(ScoreFactorSchema.safeParse({ ...validFactor, normalisedValue: 120 }).success).toBe(false);
    });

    const validBreakdown = {
      businessImpact: validFactor,
      safetyRisk: { ...validFactor, weight: 0.3, contribution: 24 },
      slaUrgency: { ...validFactor, weight: 0.15, contribution: 12 },
      recurrence: { ...validFactor, weight: 0.15, contribution: 12 },
      downtime: { ...validFactor, weight: 0.15, contribution: 12 },
      total: 80,
    };

    it('accepts a valid ScoreBreakdown fixture', () => {
      expect(ScoreBreakdownSchema.safeParse(validBreakdown).success).toBe(true);
    });

    it('rejects a malformed ScoreBreakdown fixture', () => {
      const invalid = {
        ...validBreakdown,
        total: 150, // exceeds 100
      };
      expect(ScoreBreakdownSchema.safeParse(invalid).success).toBe(false);

      const missingFactor = {
        businessImpact: validFactor,
        total: 50,
      };
      expect(ScoreBreakdownSchema.safeParse(missingFactor).success).toBe(false);
    });

    it('validates ScoringWeightsSchema', () => {
      const weights = {
        businessImpact: 0.25,
        safetyRisk: 0.3,
        slaUrgency: 0.15,
        recurrence: 0.15,
        downtime: 0.15,
      };
      expect(ScoringWeightsSchema.safeParse(weights).success).toBe(true);
      expect(ScoringWeightsSchema.safeParse({ ...weights, businessImpact: 1.5 }).success).toBe(false);
    });
  });

  describe('TriageResultSchema', () => {
    const validTriageResult = {
      category: 'EQUIPMENT',
      severity: 'HIGH',
      locationId: 'Aisle-4-Bay-12',
      assetId: 'Dock-4',
      summary: 'Conveyor belt motor jammed with smoke detected',
      impactSignals: ['motor jammed', 'smoke detected'],
      entities: { equipment: 'Dock-4', zone: 'North' },
      recommendedFirstAction: 'Depower conveyor Dock-4 and inspect roller bearings',
      confidence: 0.94,
      clarifyingQuestion: null,
      triageMode: 'AI',
    };

    it('accepts a valid TriageResult fixture', () => {
      expect(TriageResultSchema.safeParse(validTriageResult).success).toBe(true);
    });

    it('rejects malformed TriageResult fixture', () => {
      const invalid = {
        ...validTriageResult,
        confidence: 1.5, // max is 1.0
      };
      expect(TriageResultSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe('Incident Entities (Incident, Attachment, Link, TimelineEvent)', () => {
    const validFactor = {
      rawValue: 75,
      normalisedValue: 75,
      weight: 0.2,
      contribution: 15,
      explanation: 'Standard test factor contribution',
    };

    const validIncident = {
      id: '01HRX9B8QWYZ3M456K78P9ABCD',
      tenantId: 'tenant-alpha',
      title: 'Dock 4 hydraulic leveler failing to raise',
      description: 'Truck waiting at dock 4 cannot unload due to stuck leveler.',
      status: 'TRIAGING',
      category: 'EQUIPMENT',
      severity: 'HIGH',
      priorityScore: 78,
      scoreBreakdown: {
        businessImpact: validFactor,
        safetyRisk: validFactor,
        slaUrgency: validFactor,
        recurrence: validFactor,
        downtime: validFactor,
        total: 78,
      },
      confidence: 0.91,
      triageMode: 'AI',
      assetId: 'Dock-4',
      locationId: 'Bay-04',
      assignedTeamId: null,
      ackDueAt: '2026-09-18T23:00:00.000Z',
      resolveDueAt: '2026-09-19T03:00:00.000Z',
      reporterId: 'usr-worker-01',
      tags: ['dock', 'hydraulics'],
      metadata: { shift: 'night' },
      createdAt: '2026-09-18T22:00:00.000Z',
      updatedAt: '2026-09-18T22:05:00.000Z',
    };

    it('accepts a valid Incident fixture', () => {
      const res = IncidentSchema.safeParse(validIncident);
      expect(res.success).toBe(true);
    });

    it('rejects an invalid Incident fixture missing critical fields or invalid dates', () => {
      const invalid = {
        ...validIncident,
        createdAt: 'invalid-date-format',
      };
      expect(IncidentSchema.safeParse(invalid).success).toBe(false);
    });

    it('validates TimelineEventSchema', () => {
      const event = {
        id: 'evt-01',
        incidentId: '01HRX9B8QWYZ3M456K78P9ABCD',
        tenantId: 'tenant-alpha',
        type: 'CREATED',
        actorId: 'usr-worker-01',
        timestamp: '2026-09-18T22:00:00.000Z',
      };
      expect(TimelineEventSchema.safeParse(event).success).toBe(true);
      expect(TimelineEventSchema.safeParse({ ...event, timestamp: 'bad-date' }).success).toBe(false);
    });

    it('validates IncidentAttachmentSchema and IncidentLinkSchema', () => {
      const att = {
        id: 'att-123',
        incidentId: 'inc-01',
        tenantId: 'tenant-alpha',
        fileName: 'broken_lever.jpg',
        contentType: 'image/jpeg',
        s3Key: 'tenant-alpha/inc-01/broken_lever.jpg',
        sizeBytes: 204850,
        uploadedBy: 'usr-01',
        createdAt: '2026-09-18T22:00:00.000Z',
      };
      expect(IncidentAttachmentSchema.safeParse(att).success).toBe(true);

      const link = {
        parentIncidentId: 'inc-parent',
        childIncidentId: 'inc-child',
        linkType: 'DUPLICATE',
        linkedBy: 'ai-dedupe-worker',
        createdAt: '2026-09-18T22:05:00.000Z',
      };
      expect(IncidentLinkSchema.safeParse(link).success).toBe(true);
    });
  });

  describe('API Schemas', () => {
    it('validates CreateIncidentRequestSchema', () => {
      const valid = {
        title: 'Oil spill in aisle 3',
        description: 'Large fluid puddle near packing station 2',
        mediaUrls: ['https://s3.amazonaws.com/opslens-media/photo1.jpg'],
      };
      expect(CreateIncidentRequestSchema.safeParse(valid).success).toBe(true);

      const invalid = {
        title: '',
        description: 'Missing title',
      };
      expect(CreateIncidentRequestSchema.safeParse(invalid).success).toBe(false);
    });

    it('validates ListIncidentsQuerySchema with coercion', () => {
      const valid = {
        status: 'ROUTED',
        category: 'FACILITY',
        priorityMin: '50',
        limit: '10',
      };
      const res = ListIncidentsQuerySchema.safeParse(valid);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.priorityMin).toBe(50);
        expect(res.data.limit).toBe(10);
      }
    });

    it('validates PatchIncidentRequestSchema', () => {
      expect(PatchIncidentRequestSchema.safeParse({ status: 'ACKNOWLEDGED' }).success).toBe(true);
      expect(PatchIncidentRequestSchema.safeParse({ status: 'NON_EXISTENT' }).success).toBe(false);
    });

    it('validates AddCommentRequestSchema and MergeIncidentRequestSchema', () => {
      expect(AddCommentRequestSchema.safeParse({ content: 'Parts ordered' }).success).toBe(true);
      expect(AddCommentRequestSchema.safeParse({ content: '' }).success).toBe(false);

      expect(
        MergeIncidentRequestSchema.safeParse({
          targetIncidentId: 'inc-001',
          reason: 'Duplicate of ongoing Dock 4 outage',
        }).success,
      ).toBe(true);
      expect(MergeIncidentRequestSchema.safeParse({ targetIncidentId: '' }).success).toBe(false);
    });

    it('validates AnswerClarificationRequestSchema', () => {
      expect(AnswerClarificationRequestSchema.safeParse({ answer: 'Bay 4 leveler' }).success).toBe(true);
      expect(AnswerClarificationRequestSchema.safeParse({ answer: '' }).success).toBe(false);
    });

    it('validates GetPresignedUploadUrlRequestSchema size limit', () => {
      const valid = {
        fileName: 'spill.png',
        contentType: 'image/png',
        sizeBytes: 1024 * 1024,
      };
      expect(GetPresignedUploadUrlRequestSchema.safeParse(valid).success).toBe(true);

      const tooLarge = {
        ...valid,
        sizeBytes: 100 * 1024 * 1024, // 100MB > 50MB limit
      };
      expect(GetPresignedUploadUrlRequestSchema.safeParse(tooLarge).success).toBe(false);
    });

    it('validates Dashboard and Recommendation schemas', () => {
      const validSummary = {
        totalIncidents: 120,
        activeCount: 15,
        criticalCount: 2,
        breachedCount: 0,
        avgResolutionMinutes: 45.5,
        todayVolume: 8,
        slaComplianceRate: 98.5,
      };
      expect(GetDashboardSummaryResponseSchema.safeParse(validSummary).success).toBe(true);

      const validHotspot = {
        assetId: 'Dock-4',
        locationId: 'Bay-4',
        incidentCount: 5,
        primaryCategory: 'EQUIPMENT',
        riskScore: 84.5,
        lastIncidentAt: '2026-09-18T20:00:00.000Z',
      };
      expect(HotspotItemSchema.safeParse(validHotspot).success).toBe(true);

      const validRec = {
        id: 'rec-01',
        assetId: 'Dock-4',
        title: 'Schedule preventative maintenance on Dock 4 leveler',
        description: 'Recurred 5 times in the last 7 days.',
        suggestedAction: 'Replace hydraulic pump seal',
        confidence: 0.95,
        estimatedSavingsHours: 12,
        createdAt: '2026-09-18T22:00:00.000Z',
      };
      expect(RecommendationItemSchema.safeParse(validRec).success).toBe(true);
    });

    it('validates Config and Admin schemas', () => {
      const validSla = {
        category: 'EQUIPMENT',
        severity: 'CRITICAL',
        ackTargetMinutes: 15,
        resolveTargetMinutes: 120,
        escalationTeamId: 'team-ops-mgr',
      };
      expect(SlaPolicySchema.safeParse(validSla).success).toBe(true);

      const validUpdateWeights = {
        scoringWeights: {
          businessImpact: 0.3,
          safetyRisk: 0.3,
          slaUrgency: 0.2,
          recurrence: 0.1,
          downtime: 0.1,
        },
      };
      expect(UpdateScoringWeightsRequestSchema.safeParse(validUpdateWeights).success).toBe(true);

      expect(ResetDemoRequestSchema.safeParse({ confirm: true }).success).toBe(true);
      expect(ResetDemoRequestSchema.safeParse({ confirm: false }).success).toBe(false);
    });
  });

  describe('Event Schemas', () => {
    const base = {
      tenantId: 'tenant-123',
      incidentId: 'inc-456',
      correlationId: 'corr-789',
      occurredAt: '2026-09-18T22:30:00.000Z',
    };

    const validFactor = {
      rawValue: 50,
      normalisedValue: 50,
      weight: 0.2,
      contribution: 10,
      explanation: 'Base event factor',
    };

    it('validates IncidentCreatedEventSchema and IncidentTriagedEventSchema', () => {
      const created = {
        ...base,
        type: 'INCIDENT_CREATED',
        reporterId: 'usr-1',
        title: 'Broken pallet',
        description: 'Pallet broken in aisle 5',
        mediaUrls: [],
      };
      expect(IncidentCreatedEventSchema.safeParse(created).success).toBe(true);
      expect(OpsLensEventSchema.safeParse(created).success).toBe(true);

      const triaged = {
        ...base,
        type: 'INCIDENT_TRIAGED',
        triageResult: {
          category: 'INVENTORY',
          severity: 'MEDIUM',
          locationId: 'Aisle-5',
          assetId: null,
          summary: 'Broken pallet spilled carton boxes',
          impactSignals: ['broken pallet'],
          entities: {},
          recommendedFirstAction: 'Restack and wrap pallet',
          confidence: 0.9,
          clarifyingQuestion: null,
          triageMode: 'AI',
        },
        priorityScore: 50,
        scoreBreakdown: {
          businessImpact: validFactor,
          safetyRisk: validFactor,
          slaUrgency: validFactor,
          recurrence: validFactor,
          downtime: validFactor,
          total: 50,
        },
        isDuplicate: false,
      };
      expect(IncidentTriagedEventSchema.safeParse(triaged).success).toBe(true);
      expect(OpsLensEventSchema.safeParse(triaged).success).toBe(true);
    });

    it('validates IncidentRoutedEventSchema and IncidentNeedsInfoEventSchema', () => {
      const routed = {
        ...base,
        type: 'INCIDENT_ROUTED',
        assignedTeamId: 'team-maintenance',
        ruleId: 'rule-dock-failures',
        reason: 'Asset matches Dock maintenance rule',
      };
      expect(IncidentRoutedEventSchema.safeParse(routed).success).toBe(true);
      expect(OpsLensEventSchema.safeParse(routed).success).toBe(true);

      const needsInfo = {
        ...base,
        type: 'INCIDENT_NEEDS_INFO',
        question: 'Which dock leveler is experiencing the issue?',
        confidence: 0.42,
      };
      expect(IncidentNeedsInfoEventSchema.safeParse(needsInfo).success).toBe(true);
      expect(OpsLensEventSchema.safeParse(needsInfo).success).toBe(true);
    });

    it('validates SlaBreachedEventSchema, EscalatedEvent, and ResolvedEvent', () => {
      const breached = {
        ...base,
        type: 'SLA_BREACHED',
        breachType: 'ACK',
        dueAt: '2026-09-18T22:00:00.000Z',
        elapsedMinutes: 35,
        severity: 'CRITICAL',
      };
      expect(SlaBreachedEventSchema.safeParse(breached).success).toBe(true);
      expect(OpsLensEventSchema.safeParse(breached).success).toBe(true);

      const escalated = {
        ...base,
        type: 'INCIDENT_ESCALATED',
        escalationLevel: 1,
        escalatedToTeamId: 'team-supervisors',
        reason: '15 minutes past ACK SLA',
      };
      expect(IncidentEscalatedEventSchema.safeParse(escalated).success).toBe(true);
      expect(OpsLensEventSchema.safeParse(escalated).success).toBe(true);

      const resolved = {
        ...base,
        type: 'INCIDENT_RESOLVED',
        resolvedBy: 'usr-mechanic-1',
        resolutionNotes: 'Hydraulic fluid refilled and seal replaced',
        durationMinutes: 42,
      };
      expect(IncidentResolvedEventSchema.safeParse(resolved).success).toBe(true);
      expect(OpsLensEventSchema.safeParse(resolved).success).toBe(true);
    });
  });

  describe('Error Schemas', () => {
    it('validates ErrorCodeEnum values', () => {
      expect(ErrorCodeEnum.safeParse('INCIDENT_INVALID_TRANSITION').success).toBe(true);
      expect(ErrorCodeEnum.safeParse('INCIDENT_NOT_FOUND').success).toBe(true);
      expect(ErrorCodeEnum.safeParse('UNAUTHORIZED').success).toBe(true);
      expect(ErrorCodeEnum.safeParse('FORBIDDEN').success).toBe(true);
      expect(ErrorCodeEnum.safeParse('VALIDATION_ERROR').success).toBe(true);
      expect(ErrorCodeEnum.safeParse('TENANT_MISMATCH').success).toBe(true);
      expect(ErrorCodeEnum.safeParse('RANDOM_ERROR').success).toBe(false);
    });

    it('validates ErrorEnvelopeSchema', () => {
      const valid = {
        success: false,
        error: {
          code: 'INCIDENT_INVALID_TRANSITION',
          message: 'Cannot transition from CLOSED to ROUTED',
          details: { currentStatus: 'CLOSED', attemptedStatus: 'ROUTED' },
          correlationId: 'req-corr-abc-123',
          timestamp: '2026-09-18T22:35:00.000Z',
        },
      };
      expect(ErrorEnvelopeSchema.safeParse(valid).success).toBe(true);

      const invalid = {
        success: true, // must be false
        error: valid.error,
      };
      expect(ErrorEnvelopeSchema.safeParse(invalid).success).toBe(false);
    });
  });
});
