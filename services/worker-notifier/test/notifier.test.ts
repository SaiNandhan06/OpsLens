import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processNotificationEvent } from '../src/notifier.js';
import { TimelineRepository } from '@opslens/data';
import * as snsModule from '../src/sns.js';

describe('services/worker-notifier', () => {
  const tenantId = 'north-hub';
  const incidentId = 'inc-notif-01';
  let timelineRepo: TimelineRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    timelineRepo = new TimelineRepository();
    vi.spyOn(snsModule, 'sendSnsNotification').mockResolvedValue({
      messageId: 'mock-sns-msg-123',
      success: true,
    });
  });

  it('processes INCIDENT_ROUTED event, sends SNS, and logs timeline event', async () => {
    const timelineSpy = vi.spyOn(timelineRepo, 'appendEvent').mockImplementation(async (_t, evt) => evt);

    const result = await processNotificationEvent(
      {
        type: 'INCIDENT_ROUTED',
        tenantId,
        incidentId,
        assignedTeamId: 'TEAM-MAINT',
        reason: 'Asset rule match',
      },
      'INCIDENT_ROUTED',
      timelineRepo,
    );

    expect(result).not.toBeNull();
    expect(result?.eventType).toBe('INCIDENT_ROUTED');
    expect(result?.recipient).toBe('TEAM-MAINT');
    expect(result?.deepLink).toBe(`https://app.opslens.internal/incidents/${incidentId}`);
    expect(result?.snsDispatched).toBe(true);

    expect(timelineSpy).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        type: 'COMMENT_ADDED',
        data: expect.objectContaining({
          action: 'NOTIFICATION_SENT',
          channel: 'SNS',
          eventType: 'INCIDENT_ROUTED',
          recipient: 'TEAM-MAINT',
        }),
      }),
    );
  });

  it('processes SLA_BREACHED event with appropriate message and deep link', async () => {
    const timelineSpy = vi.spyOn(timelineRepo, 'appendEvent').mockImplementation(async (_t, evt) => evt);

    const result = await processNotificationEvent(
      {
        type: 'SLA_BREACHED',
        tenantId,
        incidentId,
        breachType: 'ACK',
        dueAt: '2026-09-19T10:20:00.000Z',
        elapsedMinutes: 25,
        severity: 'HIGH',
      },
      'SLA_BREACHED',
      timelineRepo,
    );

    expect(result).not.toBeNull();
    expect(result?.subject).toContain('SLA ACK Breached');
    expect(result?.message).toContain('https://app.opslens.internal/incidents/inc-notif-01');
    expect(timelineSpy).toHaveBeenCalled();
  });

  it('processes INCIDENT_ESCALATED event with escalation level and target', async () => {
    const timelineSpy = vi.spyOn(timelineRepo, 'appendEvent').mockImplementation(async (_t, evt) => evt);

    const result = await processNotificationEvent(
      {
        type: 'INCIDENT_ESCALATED',
        tenantId,
        incidentId,
        escalationLevel: 2,
        escalatedToTeamId: 'TEAM-MAINT',
        reason: 'ACK deadline missed',
      },
      'INCIDENT_ESCALATED',
      timelineRepo,
    );

    expect(result).not.toBeNull();
    expect(result?.subject).toContain('Tier 2');
    expect(result?.recipient).toBe('TEAM-MAINT');
    expect(timelineSpy).toHaveBeenCalled();
  });
});
