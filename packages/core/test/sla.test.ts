import { describe, it, expect } from 'vitest';
import {
  resolveSlaPolicy,
  computeDueDates,
  evaluateBreach,
  nextEscalationLevel,
} from '../src/sla/index.js';

describe('packages/core/src/sla', () => {
  describe('resolveSlaPolicy', () => {
    it('resolves HIGH EQUIPMENT incident to 20min ack and 120min resolve', () => {
      const policy = resolveSlaPolicy('north-hub', 'EQUIPMENT', 'HIGH');
      expect(policy.ackMinutes).toBe(20);
      expect(policy.resolveMinutes).toBe(120);
      expect(policy.escalationTeamId).toBe('TEAM-MAINT');
    });

    it('resolves CRITICAL SAFETY incident to 5min ack and 30min resolve', () => {
      const policy = resolveSlaPolicy('north-hub', 'SAFETY', 'CRITICAL');
      expect(policy.ackMinutes).toBe(5);
      expect(policy.resolveMinutes).toBe(30);
      expect(policy.escalationTeamId).toBe('TEAM-SAFETY');
    });

    it('honors tenant custom policies when provided', () => {
      const custom = [
        {
          category: 'EQUIPMENT' as const,
          severity: 'HIGH' as const,
          ackTargetMinutes: 15,
          resolveTargetMinutes: 60,
          escalationTeamId: 'CUSTOM-MAINT',
        },
      ];
      const policy = resolveSlaPolicy('north-hub', 'EQUIPMENT', 'HIGH', {
        customPolicies: custom,
      });
      expect(policy.ackMinutes).toBe(15);
      expect(policy.resolveMinutes).toBe(60);
      expect(policy.escalationTeamId).toBe('CUSTOM-MAINT');
    });
  });

  describe('computeDueDates', () => {
    it('calculates ackDueAt, resolveDueAt, and earliestDueAt', () => {
      const routedAt = '2026-09-19T10:00:00.000Z';
      const policy = { ackMinutes: 20, resolveMinutes: 120 };
      const dueDates = computeDueDates(routedAt, policy);

      expect(dueDates.ackDueAt).toBe('2026-09-19T10:20:00.000Z');
      expect(dueDates.resolveDueAt).toBe('2026-09-19T12:00:00.000Z');
      expect(dueDates.earliestDueAt).toBe('2026-09-19T10:20:00.000Z');
    });
  });

  describe('evaluateBreach', () => {
    const ackDueAt = '2026-09-19T10:20:00.000Z';
    const resolveDueAt = '2026-09-19T12:00:00.000Z';

    it('returns null before ack deadline', () => {
      const breach = evaluateBreach(
        {
          status: 'ROUTED',
          acknowledgedAt: null,
          ackDueAt,
          resolveDueAt,
          resolvedAt: null,
        },
        new Date('2026-09-19T10:10:00.000Z'),
      );
      expect(breach).toBeNull();
    });

    it('returns ACK when unacknowledged and clock is past ackDueAt', () => {
      const breach = evaluateBreach(
        {
          status: 'ROUTED',
          acknowledgedAt: null,
          ackDueAt,
          resolveDueAt,
          resolvedAt: null,
        },
        new Date('2026-09-19T10:21:00.000Z'),
      );
      expect(breach).toBe('ACK');
    });

    it('does not return ACK if already acknowledged before ackDueAt', () => {
      const breach = evaluateBreach(
        {
          status: 'ACKNOWLEDGED',
          acknowledgedAt: '2026-09-19T10:15:00.000Z',
          ackDueAt,
          resolveDueAt,
          resolvedAt: null,
        },
        new Date('2026-09-19T10:25:00.000Z'),
      );
      expect(breach).toBeNull();
    });

    it('returns RESOLVE when past resolveDueAt even if acknowledged', () => {
      const breach = evaluateBreach(
        {
          status: 'IN_PROGRESS',
          acknowledgedAt: '2026-09-19T10:15:00.000Z',
          ackDueAt,
          resolveDueAt,
          resolvedAt: null,
        },
        new Date('2026-09-19T12:05:00.000Z'),
      );
      expect(breach).toBe('RESOLVE');
    });

    it('returns null if resolved before resolveDueAt', () => {
      const breach = evaluateBreach(
        {
          status: 'RESOLVED',
          acknowledgedAt: '2026-09-19T10:15:00.000Z',
          ackDueAt,
          resolveDueAt,
          resolvedAt: '2026-09-19T11:45:00.000Z',
        },
        new Date('2026-09-19T12:15:00.000Z'),
      );
      expect(breach).toBeNull();
    });
  });

  describe('nextEscalationLevel', () => {
    it('escalates from Level 0 to Level 1 (Assignee)', () => {
      const res = nextEscalationLevel({
        assignedTeamId: 'TEAM-MAINT',
        escalationLevel: 0,
      });
      expect(res).not.toBeNull();
      expect(res?.nextLevel).toBe(1);
      expect(res?.role).toBe('assignee');
      expect(res?.targetTeamId).toBe('TEAM-MAINT');
    });

    it('escalates from Level 1 to Level 2 (Supervisor)', () => {
      const res = nextEscalationLevel(
        {
          assignedTeamId: 'TEAM-MAINT',
          escalationLevel: 1,
          metadata: { lastEscalatedAt: '2026-09-19T10:00:00.000Z' },
        },
        new Date('2026-09-19T10:20:00.000Z'),
      );
      expect(res).not.toBeNull();
      expect(res?.nextLevel).toBe(2);
      expect(res?.role).toBe('supervisor');
    });

    it('escalates from Level 2 to Level 3 (Operations Manager)', () => {
      const res = nextEscalationLevel(
        {
          assignedTeamId: 'TEAM-MAINT',
          escalationLevel: 2,
          metadata: { lastEscalatedAt: '2026-09-19T10:20:00.000Z' },
        },
        new Date('2026-09-19T10:40:00.000Z'),
      );
      expect(res).not.toBeNull();
      expect(res?.nextLevel).toBe(3);
      expect(res?.role).toBe('manager');
      expect(res?.targetTeamId).toBe('TEAM-OPERATIONS');
    });

    it('returns null when already at top of ladder (Level 3)', () => {
      const res = nextEscalationLevel({
        assignedTeamId: 'TEAM-MAINT',
        escalationLevel: 3,
      });
      expect(res).toBeNull();
    });

    it('enforces idempotency within cooldown window', () => {
      const res = nextEscalationLevel(
        {
          assignedTeamId: 'TEAM-MAINT',
          escalationLevel: 1,
          metadata: { lastEscalatedAt: '2026-09-19T10:00:00.000Z' },
        },
        new Date('2026-09-19T10:02:00.000Z'), // Only 2 mins later, cooldown is 10 mins
      );
      expect(res).toBeNull();
    });
  });
});
