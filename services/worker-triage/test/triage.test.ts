import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ulid } from 'ulid';
import type { Incident, IncidentAttachment, TimelineEvent } from '@opslens/contracts';
import {
  IncidentRepository,
  TimelineRepository,
  AttachmentRepository,
  BudgetRepository,
  ReferenceRepository,
  LinkRepository,
} from '@opslens/data';
import { LlmSchemaError, MockLLMProvider } from '@opslens/ai';
import { runTriagePipeline } from '../src/triage-pipeline.js';
import { transcribeAudio, isAudioAttachment } from '../src/transcribe.js';

describe('worker-triage service', () => {
  const tenantId = 'north-hub';
  let mockIncidents: Map<string, Incident>;
  let mockTimeline: TimelineEvent[];
  let mockAttachments: IncidentAttachment[];
  let mockLinks: unknown[];
  let mockBudget: { totalTokens: number; inputTokens: number; outputTokens: number };

  let incidentRepo: IncidentRepository;
  let timelineRepo: TimelineRepository;
  let attachmentRepo: AttachmentRepository;
  let referenceRepo: ReferenceRepository;
  let budgetRepo: BudgetRepository;
  let linkRepo: LinkRepository;

  beforeEach(() => {
    mockIncidents = new Map();
    mockTimeline = [];
    mockAttachments = [];
    mockLinks = [];
    mockBudget = { totalTokens: 0, inputTokens: 0, outputTokens: 0 };

    incidentRepo = {
      getById: vi.fn(async (t: string, id: string) => {
        const item = mockIncidents.get(`${t}#${id}`);
        return item ? { ...item } : null;
      }),
      update: vi.fn(async (t: string, id: string, patch: Partial<Incident>) => {
        const key = `${t}#${id}`;
        const existing = mockIncidents.get(key);
        if (!existing) throw new Error(`Not found: ${id}`);
        const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
        mockIncidents.set(key, updated);
        return { ...updated };
      }),
      queryByAsset: vi.fn(async () => ({ items: [], nextCursor: null })),
      queryCandidates: vi.fn(async () => []),
    } as unknown as IncidentRepository;

    linkRepo = {
      createLink: vi.fn(async (_t: string, link: unknown) => {
        mockLinks.push(link);
        return link;
      }),
      getLinks: vi.fn(async () => [...mockLinks]),
    } as unknown as LinkRepository;

    timelineRepo = {
      appendEvent: vi.fn(async (_t: string, event: TimelineEvent) => {
        mockTimeline.push(event);
        return event;
      }),
    } as unknown as TimelineRepository;

    attachmentRepo = {
      listAttachments: vi.fn(async () => [...mockAttachments]),
    } as unknown as AttachmentRepository;

    referenceRepo = {
      listAssets: vi.fn(async () => [
        { id: 'CONV-D4', name: 'Dock 4 Conveyor Belt' },
      ]),
      listLocations: vi.fn(async () => [
        { id: 'LOC-DOCK-4', name: 'Dock 4' },
      ]),
      listTeams: vi.fn(async () => [
        { id: 'TEAM-MAINT', name: 'Maintenance', shiftPattern: '24x7_ROTATIONAL' },
      ]),
      getTenant: vi.fn(async () => ({
        timezone: 'Asia/Kolkata',
        fallbackTeamId: 'TEAM-LOGISTICS',
      })),
    } as unknown as ReferenceRepository;

    budgetRepo = {
      getBudget: vi.fn(async () => ({ ...mockBudget })),
      recordTokenUsage: vi.fn(async (_t: string, _d: string, usage: { inputTokens: number; outputTokens: number }) => {
        mockBudget.inputTokens += usage.inputTokens;
        mockBudget.outputTokens += usage.outputTokens;
        mockBudget.totalTokens += usage.inputTokens + usage.outputTokens;
        return { ...mockBudget };
      }),
    } as unknown as BudgetRepository;
  });

  function createIncidentFixture(description: string, overrides: Partial<Incident> = {}): Incident {
    const id = ulid();
    const now = new Date().toISOString();
    const incident: Incident = {
      id,
      tenantId,
      title: description.substring(0, 50),
      description,
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
      confidence: 0,
      triageMode: 'AI',
      assetId: null,
      locationId: null,
      assignedTeamId: null,
      ackDueAt: null,
      resolveDueAt: null,
      reporterId: 'user-123',
      tags: [],
      metadata: {},
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    mockIncidents.set(`${tenantId}#${id}`, incident);
    return incident;
  }

  it('detects and transcribes English audio attachment', async () => {
    const att: IncidentAttachment = {
      id: ulid(),
      incidentId: 'inc-1',
      tenantId,
      fileName: 'voice_note.webm',
      contentType: 'audio/webm',
      s3Key: 'tenants/north-hub/incidents/inc-1/voice.webm',
      sizeBytes: 1024,
      uploadedBy: 'user-123',
      createdAt: new Date().toISOString(),
    };

    expect(isAudioAttachment(att)).toBe(true);

    const result = await transcribeAudio(tenantId, 'inc-1', att, timelineRepo);
    expect(result.detectedLanguage).toBe('en');
    expect(result.originalTranscript).toContain('conveyor');
    expect(mockTimeline.length).toBe(1);
    expect(mockTimeline[0]!.type).toBe('ATTACHMENT_ADDED');
  });

  it('detects and transcribes Hindi voice note, preserving original and providing English translation', async () => {
    const att: IncidentAttachment = {
      id: ulid(),
      incidentId: 'inc-2',
      tenantId,
      fileName: 'hindi_voice_note.mp4',
      contentType: 'audio/mp4',
      s3Key: 'tenants/north-hub/incidents/inc-2/hindi_voice_note.mp4',
      sizeBytes: 2048,
      uploadedBy: 'user-123',
      createdAt: new Date().toISOString(),
    };

    expect(isAudioAttachment(att)).toBe(true);

    const result = await transcribeAudio(tenantId, 'inc-2', att, timelineRepo);
    expect(result.detectedLanguage).toBe('hi');
    expect(result.originalTranscript).toMatch(/कन्वेयर/);
    expect(result.translatedTranscript).toContain('Dock 4 conveyor');
  });

  it('executes golden-path triage: resolves category EQUIPMENT, severity HIGH, location LOC-DOCK-4, asset CONV-D4 with "ai" sources', async () => {
    const incident = createIncidentFixture('Dock 4 conveyor stopped again. Packages piling up. Third time this week.');

    const triaged = await runTriagePipeline(
      { tenantId, incidentId: incident.id },
      { incidentRepo, timelineRepo, attachmentRepo, referenceRepo, budgetRepo },
    );

    expect(triaged.status).toBe('ROUTED');
    expect(triaged.assignedTeamId).toBe('TEAM-MAINT');
    expect(triaged.category).toBe('EQUIPMENT');
    expect(triaged.severity).toBe('HIGH');
    expect(triaged.locationId).toBe('LOC-DOCK-4');
    expect(triaged.assetId).toBe('CONV-D4');
    expect(triaged.metadata.summary).toBeTruthy();
    expect(triaged.metadata.recommendedFirstAction).toBeTruthy();

    const sources = triaged.metadata.fieldSources as Record<string, string>;
    expect(sources.category).toBe('ai');
    expect(sources.severity).toBe('ai');
    expect(sources.summary).toBe('ai');
    expect(sources.recommendedFirstAction).toBe('ai');

    // Check timeline event records modelId and promptVersion
    const triagedEvt = mockTimeline.find((e) => e.type === 'TRIAGED');
    expect(triagedEvt).toBeDefined();
    expect(triagedEvt!.data?.modelId).toBe('mock-claude-3-haiku');
    expect(triagedEvt!.data?.promptVersion).toBe('triage-extract.v1');
  });

  it('recovers from LlmSchemaError to rule-based fallback with triageMode FALLBACK and confidence 0.3', async () => {
    const incident = createIncidentFixture('Belt motor overheating');

    const failingProvider = {
      providerName: 'mock' as const,
      extractAndClassify: vi.fn(async () => {
        throw new LlmSchemaError('Schema mismatch', '{"bad": "json"}', [], 2);
      }),
      embed: vi.fn(),
      answerQuery: vi.fn(),
    };

    const triaged = await runTriagePipeline(
      { tenantId, incidentId: incident.id },
      { incidentRepo, timelineRepo, attachmentRepo, referenceRepo, budgetRepo },
      { provider: failingProvider },
    );

    expect(triaged.triageMode).toBe('FALLBACK');
    expect(triaged.confidence).toBe(0.3);

    const fallbackEvt = mockTimeline.find(
      (e) => e.type === 'TRIAGED' && e.data?.triageMode === 'FALLBACK',
    );
    expect(fallbackEvt).toBeDefined();
    expect(fallbackEvt!.data?.reason).toBe('LLM_SCHEMA_ERROR');
  });

  it('handles vague report: sets status NEEDS_INFO with one clarifyingQuestion and publishes event', async () => {
    const incident = createIncidentFixture('something is wrong near the back');

    const triaged = await runTriagePipeline(
      { tenantId, incidentId: incident.id },
      { incidentRepo, timelineRepo, attachmentRepo, referenceRepo, budgetRepo },
    );

    expect(triaged.status).toBe('NEEDS_INFO');
    expect(triaged.confidence).toBeLessThan(0.6);
    expect(triaged.metadata.clarifyingQuestion).toBeTruthy();
    expect(typeof triaged.metadata.clarifyingQuestion).toBe('string');

    const statusEvt = mockTimeline.find(
      (e) => e.type === 'STATUS_CHANGED' && e.data?.status === 'NEEDS_INFO',
    );
    expect(statusEvt).toBeDefined();
    expect(statusEvt!.data?.clarifyingQuestion).toBe(triaged.metadata.clarifyingQuestion);
  });

  it('degrades to rule-based fallback when daily token budget is exhausted without failing', async () => {
    mockBudget.totalTokens = 250000; // Above 200,000 threshold

    const incident = createIncidentFixture('Forklift 1 hydraulic leak in zone 2');

    const triaged = await runTriagePipeline(
      { tenantId, incidentId: incident.id },
      { incidentRepo, timelineRepo, attachmentRepo, referenceRepo, budgetRepo },
    );

    expect(triaged.triageMode).toBe('FALLBACK');
    expect(triaged.confidence).toBe(0.3);
    expect(triaged.status).not.toBe('TRIAGING');

    const budgetEvt = mockTimeline.find(
      (e) => e.type === 'TRIAGED' && e.data?.reason === 'DAILY_TOKEN_BUDGET_EXHAUSTED',
    );
    expect(budgetEvt).toBeDefined();
  });

  it('recovers cleanly from unexpected error mid-run: incident is NOT left in TRIAGING', async () => {
    const incident = createIncidentFixture('Conveyor belt issue');

    const recovered = await runTriagePipeline(
      { tenantId, incidentId: incident.id },
      { incidentRepo, timelineRepo, attachmentRepo, referenceRepo, budgetRepo },
      { testHookThrowAfterStep4: true },
    );

    expect(recovered.status).not.toBe('TRIAGING');
    expect(recovered.status).toBe('NEW');
    expect(recovered.triageMode).toBe('FALLBACK');
    expect(recovered.confidence).toBe(0.3);
  });

  it('detects duplicate candidate, writes link item, sets metadata flag, and NEVER auto-merges', async () => {
    const provider = new MockLLMProvider();
    const newIncidentDesc = 'Dock 4 conveyor stopped again. Packages piling up. Third time this week.';
    const priorEmbed = await provider.embed(
      `Dock 4 conveyor recurrent stoppage with freight backlog ${newIncidentDesc} Dock 4 Conveyor Belt`,
    );

    // Seed prior open candidate on same asset
    const priorIncident: Incident = {
      id: '01PRIORINCIDENT',
      tenantId,
      title: 'Conveyor stoppage',
      description: 'Dock 4 conveyor stopped again. Packages piling up.',
      status: 'NEW',
      category: 'EQUIPMENT',
      severity: 'HIGH',
      priorityScore: 80,
      scoreBreakdown: {} as any,
      confidence: 0.9,
      triageMode: 'AI',
      assetId: 'CONV-D4',
      locationId: 'LOC-DOCK-4',
      assignedTeamId: null,
      ackDueAt: null,
      resolveDueAt: null,
      reporterId: 'usr-prior',
      embedding: priorEmbed.vector,
      tags: [],
      metadata: {},
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 3600000).toISOString(),
    };

    incidentRepo.queryCandidates = vi.fn(async () => [priorIncident]);

    const newIncident = createIncidentFixture('Dock 4 conveyor stopped again. Packages piling up. Third time this week.');

    const triaged = await runTriagePipeline(
      { tenantId, incidentId: newIncident.id },
      { incidentRepo, timelineRepo, attachmentRepo, referenceRepo, budgetRepo, linkRepo },
    );

    // Verify metadata flags
    expect(triaged.metadata.hasDuplicateCandidate).toBe(true);
    expect(triaged.metadata.canonicalIncidentId).toBe('01PRIORINCIDENT');
    expect(triaged.metadata.duplicateCandidateCount).toBe(1);

    // Crucial requirement: NEVER auto-merge, status is ROUTED (never MERGED or CLOSED)
    expect(triaged.status).not.toBe('MERGED');
    expect(triaged.status).toBe('ROUTED');

    // Verify link item written
    expect(mockLinks.length).toBeGreaterThan(0);
    const link = mockLinks[0] as any;
    expect(link.linkType).toBe('DUPLICATE_CANDIDATE');
    expect(link.parentIncidentId).toBe('01PRIORINCIDENT');
    expect(link.childIncidentId).toBe(newIncident.id);
  });
});
