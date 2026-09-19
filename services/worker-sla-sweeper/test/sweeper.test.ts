import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSlaSweeper } from '../src/sweeper.js';
import { IncidentRepository, TimelineRepository, ReferenceRepository } from '@opslens/data';
import type { Incident } from '@opslens/contracts';

describe('services/worker-sla-sweeper', () => {
  const tenantId = 'north-hub';
  let incidentRepo: IncidentRepository;
  let timelineRepo: TimelineRepository;
  let referenceRepo: ReferenceRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    incidentRepo = new IncidentRepository();
    timelineRepo = new TimelineRepository();
    referenceRepo = new ReferenceRepository();
  });

  it('evaluates breach, advances escalation level, and appends timeline events', async () => {
    const mockIncident: Incident = {
      id: 'inc-due-01',
      tenantId,
      title: 'Conveyor stoppage',
      description: 'Motor overheating at Dock 4',
      status: 'ROUTED',
      category: 'EQUIPMENT',
      severity: 'HIGH',
      priorityScore: 50,
      scoreBreakdown: {
        total: 50,
        businessImpact: { rawValue: 10, normalisedValue: 50, weight: 0.3, contribution: 15, explanation: '' },
        safetyRisk: { rawValue: 0, normalisedValue: 0, weight: 0.25, contribution: 0, explanation: '' },
        slaUrgency: { rawValue: 0, normalisedValue: 0, weight: 0.2, contribution: 0, explanation: '' },
        recurrence: { rawValue: 0, normalisedValue: 0, weight: 0.15, contribution: 0, explanation: '' },
        downtime: { rawValue: 0, normalisedValue: 0, weight: 0.1, contribution: 0, explanation: '' },
      },
      confidence: 0.9,
      triageMode: 'AI',
      assetId: 'CONV-D4',
      locationId: 'LOC-DOCK-4',
      assignedTeamId: 'TEAM-MAINT',
      ackDueAt: '2026-09-19T10:20:00.000Z',
      resolveDueAt: '2026-09-19T12:00:00.000Z',
      earliestDueAt: '2026-09-19T10:20:00.000Z',
      slaActive: true,
      reporterId: 'usr-1',
      tags: [],
      metadata: {},
      createdAt: '2026-09-19T10:00:00.000Z',
      updatedAt: '2026-09-19T10:00:00.000Z',
    };

    vi.spyOn(incidentRepo, 'queryActiveSla').mockResolvedValue({
      items: [mockIncident],
      nextCursor: null,
    });

    const updateSpy = vi.spyOn(incidentRepo, 'update').mockImplementation(async (_t, _id, patch) => ({
      ...mockIncident,
      ...patch,
    } as Incident));

    const timelineSpy = vi.spyOn(timelineRepo, 'appendEvent').mockImplementation(async (_t, evt) => evt);
    vi.spyOn(referenceRepo, 'getTenant').mockResolvedValue({ tenantId, name: 'North Hub' } as any);

    // Advance clock past ackDueAt (10:25)
    const sweepNow = new Date('2026-09-19T10:25:00.000Z');

    const result = await runSlaSweeper({
      now: sweepNow,
      tenants: [tenantId],
      incidentRepo,
      timelineRepo,
      referenceRepo,
    });

    expect(result.evaluatedCount).toBe(1);
    expect(result.breachedCount).toBe(1);
    expect(result.escalatedCount).toBe(1);
    expect(result.rescoredCount).toBe(1);

    // Escalation level updated to 1
    expect(updateSpy).toHaveBeenCalledWith(
      tenantId,
      'inc-due-01',
      expect.objectContaining({
        escalationLevel: 1,
        slaBreached: true,
      }),
      expect.objectContaining({
        conditionExpression: expect.any(String),
      }),
    );

    // Timeline events appended
    expect(timelineSpy).toHaveBeenCalled();
    const eventTypes = timelineSpy.mock.calls.map((c) => c[1].type);
    expect(eventTypes).toContain('SLA_BREACHED');
    expect(eventTypes).toContain('ESCALATED');
  });

  it('is idempotent and does not double-escalate at the same level', async () => {
    const mockIncident: Incident = {
      id: 'inc-due-02',
      tenantId,
      title: 'Conveyor stoppage',
      description: 'Motor overheating at Dock 4',
      status: 'ROUTED',
      category: 'EQUIPMENT',
      severity: 'HIGH',
      priorityScore: 50,
      assignedTeamId: 'TEAM-MAINT',
      ackDueAt: '2026-09-19T10:20:00.000Z',
      resolveDueAt: '2026-09-19T12:00:00.000Z',
      earliestDueAt: '2026-09-19T10:20:00.000Z',
      slaActive: true,
      escalationLevel: 1,
      reporterId: 'usr-1',
      tags: [],
      metadata: { lastEscalatedAt: '2026-09-19T10:25:00.000Z' },
      createdAt: '2026-09-19T10:00:00.000Z',
      updatedAt: '2026-09-19T10:25:00.000Z',
    } as unknown as Incident;

    vi.spyOn(incidentRepo, 'queryActiveSla').mockResolvedValue({
      items: [mockIncident],
      nextCursor: null,
    });

    const updateSpy = vi.spyOn(incidentRepo, 'update').mockImplementation(async (_t, _id, patch) => ({
      ...mockIncident,
      ...patch,
    } as Incident));

    const timelineSpy = vi.spyOn(timelineRepo, 'appendEvent').mockImplementation(async (_t, evt) => evt);

    // Run sweeper 1 minute after level 1 escalation (cooldown is 10 mins)
    const sweepNow = new Date('2026-09-19T10:26:00.000Z');

    const result = await runSlaSweeper({
      now: sweepNow,
      tenants: [tenantId],
      incidentRepo,
      timelineRepo,
      referenceRepo,
    });

    expect(result.evaluatedCount).toBe(1);
    expect(result.escalatedCount).toBe(0); // Did not escalate
    expect(result.rescoredCount).toBe(1); // But rescored urgency

    // No ESCALATED timeline events added
    const escalatedCalls = timelineSpy.mock.calls.filter((c) => c[1].type === 'ESCALATED');
    expect(escalatedCalls.length).toBe(0);
  });
});
