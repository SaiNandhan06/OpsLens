import { describe, it, expect } from 'vitest';
import {
  calculatePriority,
  calculateBusinessImpact,
  calculateSafetyRisk,
  calculateSlaUrgency,
  calculateRecurrence,
  calculateDowntime,
  validateWeights,
  DEFAULT_SCORING_WEIGHTS,
  InvalidWeightsError,
} from '../src/index.js';

describe('packages/core/scoring', () => {
  // ---------------------------------------------------------------------------
  // Factor 1: Business Impact
  // ---------------------------------------------------------------------------
  describe('calculateBusinessImpact', () => {
    const cases = [
      { orders: 200, tier: 'TIER_1' as const, expectedMin: 90, desc: 'Critical line large backlog' },
      { orders: 120, tier: 'TIER_1' as const, expectedMin: 85, desc: 'Tier 1 equipment > 100 orders' },
      { orders: 75, tier: 'TIER_1' as const, expectedMin: 65, desc: 'Moderate backlog on Tier 1' },
      { orders: 75, tier: 'TIER_2' as const, expectedMin: 45, desc: 'Tier 2 scaling' },
      { orders: 75, tier: 'TIER_3' as const, expectedMin: 25, desc: 'Tier 3 scaling' },
      { orders: 25, tier: 'TIER_1' as const, expectedMin: 35, desc: 'Low backlog on Tier 1' },
      { orders: 5, tier: 'TIER_1' as const, expectedMin: 15, desc: 'Minor orders' },
      { orders: 0, tier: 'TIER_1' as const, expectedMin: 10, desc: 'Zero orders' },
    ];

    for (const c of cases) {
      it(`evaluates ${c.desc} (${c.orders} orders, ${c.tier})`, () => {
        const factor = calculateBusinessImpact(
          { affectedOrders: c.orders, assetCriticality: c.tier },
          0.3,
        );
        expect(factor.normalisedValue).toBeGreaterThanOrEqual(c.expectedMin);
        expect(factor.normalisedValue).toBeLessThanOrEqual(100);
        expect(factor.weight).toBe(0.3);
        expect(factor.contribution).toBe(Math.round(factor.normalisedValue * 0.3 * 10) / 10);
        expect(factor.explanation.length).toBeGreaterThan(10);
      });
    }

    it('infers affected orders from description if not provided', () => {
      const factor = calculateBusinessImpact(
        { description: 'Dock 4 conveyor stopped again. Packages piling up.' },
        0.3,
      );
      expect(factor.normalisedValue).toBeGreaterThanOrEqual(85);
      expect(factor.explanation).toContain('backlog');
    });
  });

  // ---------------------------------------------------------------------------
  // Factor 2: Safety Risk
  // ---------------------------------------------------------------------------
  describe('calculateSafetyRisk', () => {
    const cases = [
      { desc: 'Severe acid chemical spill with worker injury', cat: 'OPERATIONS', expected: 95 },
      { desc: 'Smoke and excessive heat from motor', cat: 'EQUIPMENT', expected: 80 },
      { desc: 'Circuit breaker tripped on line', cat: 'EQUIPMENT', expected: 60 },
      { desc: 'Normal pallet placement query', cat: 'OPERATIONS', expected: 10 },
    ];

    for (const c of cases) {
      it(`scores hazard: "${c.desc}" -> ${c.expected}`, () => {
        const factor = calculateSafetyRisk({ description: c.desc, category: c.cat }, 0.25);
        expect(factor.normalisedValue).toBe(c.expected);
        expect(factor.explanation.length).toBeGreaterThan(10);
      });
    }

    it('STRICT: floors safetyRisk at 70 for SAFETY category even with minor cue', () => {
      const factor = calculateSafetyRisk(
        { category: 'SAFETY', description: 'Worker forgot safety glasses on bench' },
        0.25,
      );
      expect(factor.normalisedValue).toBeGreaterThanOrEqual(70);
      expect(factor.explanation).toContain('safety floor');
    });

    it('STRICT: floors safetyRisk at 70 for SAFETY_INCIDENT category', () => {
      const factor = calculateSafetyRisk(
        { category: 'SAFETY_INCIDENT', description: 'Minor wet floor sign displaced' },
        0.25,
      );
      expect(factor.normalisedValue).toBeGreaterThanOrEqual(70);
    });
  });

  // ---------------------------------------------------------------------------
  // Factor 3: SLA Urgency
  // ---------------------------------------------------------------------------
  describe('calculateSlaUrgency', () => {
    const createdAt = new Date('2026-09-18T10:00:00.000Z');
    const resolveDueAt = new Date('2026-09-18T11:00:00.000Z'); // 60 min window

    it('scores 0 when the window has just started', () => {
      const factor = calculateSlaUrgency(
        { createdAt, resolveDueAt },
        0.2,
        new Date('2026-09-18T10:00:00.000Z'),
      );
      expect(factor.normalisedValue).toBe(0);
      expect(factor.contribution).toBe(0);
    });

    it('scores proportional urgency midway through the window', () => {
      const factor = calculateSlaUrgency(
        { createdAt, resolveDueAt },
        0.2,
        new Date('2026-09-18T10:30:00.000Z'), // 30 min in -> 50%
      );
      expect(factor.normalisedValue).toBe(50);
      expect(factor.contribution).toBe(10);
    });

    it('scores 100 at or past the deadline', () => {
      const factorAtDeadline = calculateSlaUrgency(
        { createdAt, resolveDueAt },
        0.2,
        new Date('2026-09-18T11:00:00.000Z'),
      );
      expect(factorAtDeadline.normalisedValue).toBe(100);

      const factorPastDeadline = calculateSlaUrgency(
        { createdAt, resolveDueAt },
        0.2,
        new Date('2026-09-18T11:30:00.000Z'),
      );
      expect(factorPastDeadline.normalisedValue).toBe(100);
      expect(factorPastDeadline.explanation).toContain('breached');
    });

    it('strictly increases score as time advances (+30 minutes)', () => {
      const t1 = new Date('2026-09-18T10:10:00.000Z');
      const t2 = new Date('2026-09-18T10:40:00.000Z');

      const factor1 = calculateSlaUrgency({ createdAt, resolveDueAt }, 0.2, t1);
      const factor2 = calculateSlaUrgency({ createdAt, resolveDueAt }, 0.2, t2);

      expect(factor2.normalisedValue).toBeGreaterThan(factor1.normalisedValue);
      expect(factor2.contribution).toBeGreaterThan(factor1.contribution);
    });
  });

  // ---------------------------------------------------------------------------
  // Factor 4: Recurrence
  // ---------------------------------------------------------------------------
  describe('calculateRecurrence', () => {
    const cases = [
      { count: 0, expected: 0, desc: '0 incidents in 30 days -> 0' },
      { count: 1, expected: 30, desc: '1 incident in 30 days -> 30' },
      { count: 2, expected: 60, desc: '2 incidents in 30 days -> 60' },
      { count: 3, expected: 100, desc: '3 incidents in 30 days -> 100' },
      { count: 7, expected: 100, desc: '3+ incidents in 30 days -> 100' },
    ];

    for (const c of cases) {
      it(c.desc, () => {
        const factor = calculateRecurrence(
          { sameCategoryIncidentCount30Days: c.count, assetId: 'CONV-D4' },
          0.15,
        );
        expect(factor.normalisedValue).toBe(c.expected);
        expect(factor.contribution).toBe(Math.round(c.expected * 0.15 * 10) / 10);
        expect(factor.explanation.length).toBeGreaterThan(10);
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Factor 5: Downtime
  // ---------------------------------------------------------------------------
  describe('calculateDowntime', () => {
    const cases = [
      { minutes: 2, expected: 15, band: '0-5 min' },
      { minutes: 5, expected: 15, band: '0-5 min' },
      { minutes: 10, expected: 40, band: '6-15 min' },
      { minutes: 15, expected: 40, band: '6-15 min' },
      { minutes: 20, expected: 65, band: '16-30 min' },
      { minutes: 30, expected: 65, band: '16-30 min' },
      { minutes: 45, expected: 85, band: '31-60 min' },
      { minutes: 60, expected: 85, band: '31-60 min' },
      { minutes: 90, expected: 100, band: '>60 min' },
    ];

    for (const c of cases) {
      it(`maps ${c.minutes} mins to band ${c.band} -> score ${c.expected}`, () => {
        const factor = calculateDowntime({ estimatedStoppageMinutes: c.minutes }, 0.1);
        expect(factor.normalisedValue).toBe(c.expected);
        expect(factor.contribution).toBe(Math.round(c.expected * 0.1 * 10) / 10);
        expect(factor.explanation.length).toBeGreaterThan(10);
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Weight Validation
  // ---------------------------------------------------------------------------
  describe('validateWeights', () => {
    it('accepts weights that sum to 1.0', () => {
      expect(() => validateWeights(DEFAULT_SCORING_WEIGHTS)).not.toThrow();
      expect(() =>
        validateWeights({
          businessImpact: 0.2,
          safetyRisk: 0.2,
          slaUrgency: 0.2,
          recurrence: 0.2,
          downtime: 0.2,
        }),
      ).not.toThrow();
    });

    it('rejects weights that do not sum to 1.0 (±0.001)', () => {
      expect(() =>
        validateWeights({
          businessImpact: 0.5,
          safetyRisk: 0.5,
          slaUrgency: 0.2,
          recurrence: 0.1,
          downtime: 0.1,
        }),
      ).toThrow(InvalidWeightsError);

      expect(() =>
        validateWeights({
          businessImpact: 0.1,
          safetyRisk: 0.1,
          slaUrgency: 0.1,
          recurrence: 0.1,
          downtime: 0.1,
        }),
      ).toThrow(InvalidWeightsError);
    });

    it('rejects negative weights or weights > 1', () => {
      expect(() =>
        validateWeights({
          businessImpact: -0.2,
          safetyRisk: 0.4,
          slaUrgency: 0.3,
          recurrence: 0.3,
          downtime: 0.2,
        }),
      ).toThrow(InvalidWeightsError);
    });
  });

  // ---------------------------------------------------------------------------
  // Composite Calculation: Golden Path
  // ---------------------------------------------------------------------------
  describe('calculatePriority (Golden Path)', () => {
    it('scores golden path >= 78 with elevated recurrence and complete explanations', () => {
      const now = new Date('2026-09-18T10:30:00.000Z');
      const createdAt = new Date('2026-09-18T10:00:00.000Z'); // 30 min elapsed
      const resolveDueAt = new Date('2026-09-18T11:00:00.000Z'); // 60 min window -> 50% consumed

      const breakdown = calculatePriority(
        {
          category: 'EQUIPMENT',
          severity: 'HIGH',
          assetId: 'CONV-D4',
          locationId: 'LOC-DOCK-4',
          createdAt,
          resolveDueAt,
          description: 'Dock 4 conveyor stopped again. Packages piling up. Third time this week.',
          impactSignals: ['conveyor', 'stopped', 'packages', 'piling'],
          sameCategoryIncidentCount30Days: 3,
        },
        DEFAULT_SCORING_WEIGHTS,
        now,
      );

      // Verify each factor
      expect(breakdown.businessImpact.normalisedValue).toBeGreaterThanOrEqual(85);
      expect(breakdown.safetyRisk.normalisedValue).toBeGreaterThanOrEqual(50);
      expect(breakdown.slaUrgency.normalisedValue).toBeGreaterThanOrEqual(35);
      expect(breakdown.recurrence.normalisedValue).toBe(100); // 3rd time in 30 days
      expect(breakdown.downtime.normalisedValue).toBeGreaterThanOrEqual(65);

      // Confirm composite total >= 78
      expect(breakdown.total).toBeGreaterThanOrEqual(78);

      // Verify all explanations are non-empty and warehouse manager friendly
      expect(breakdown.businessImpact.explanation).toBeTruthy();
      expect(breakdown.safetyRisk.explanation).toBeTruthy();
      expect(breakdown.slaUrgency.explanation).toBeTruthy();
      expect(breakdown.recurrence.explanation).toBeTruthy();
      expect(breakdown.downtime.explanation).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // Recalculate Open Incidents
  // ---------------------------------------------------------------------------
  describe('recalculateOpenIncidents', () => {
    it('recalculates open incidents and preserves manual override', async () => {
      const tenantId = 'tenant-scoring-test';
      const openIncident = {
        id: 'inc-normal-1',
        tenantId,
        title: 'Belt stoppage',
        description: 'conveyor stopped',
        status: 'NEW' as const,
        category: 'EQUIPMENT' as const,
        severity: 'HIGH' as const,
        priorityScore: 30,
        scoreBreakdown: {
          businessImpact: { rawValue: 10, normalisedValue: 10, weight: 0.3, contribution: 3, explanation: '' },
          safetyRisk: { rawValue: 10, normalisedValue: 10, weight: 0.25, contribution: 2.5, explanation: '' },
          slaUrgency: { rawValue: 0, normalisedValue: 0, weight: 0.2, contribution: 0, explanation: '' },
          recurrence: { rawValue: 0, normalisedValue: 0, weight: 0.15, contribution: 0, explanation: '' },
          downtime: { rawValue: 0, normalisedValue: 0, weight: 0.1, contribution: 0, explanation: '' },
          total: 30,
        },
        confidence: 0.9,
        triageMode: 'AI' as const,
        assetId: 'CONV-D4',
        locationId: 'LOC-DOCK-4',
        assignedTeamId: null,
        ackDueAt: null,
        resolveDueAt: null,
        reporterId: 'usr-1',
        tags: [],
        metadata: {},
        createdAt: new Date('2026-09-18T10:00:00.000Z').toISOString(),
        updatedAt: new Date('2026-09-18T10:00:00.000Z').toISOString(),
      };

      const overrideIncident = {
        id: 'inc-override-2',
        tenantId,
        title: 'Safety spill',
        description: 'oil spill',
        status: 'NEW' as const,
        category: 'SAFETY' as const,
        severity: 'MEDIUM' as const,
        priorityScore: 99, // manual override
        scoreBreakdown: {
          businessImpact: { rawValue: 10, normalisedValue: 10, weight: 0.3, contribution: 3, explanation: '' },
          safetyRisk: { rawValue: 70, normalisedValue: 70, weight: 0.25, contribution: 17.5, explanation: '' },
          slaUrgency: { rawValue: 0, normalisedValue: 0, weight: 0.2, contribution: 0, explanation: '' },
          recurrence: { rawValue: 0, normalisedValue: 0, weight: 0.15, contribution: 0, explanation: '' },
          downtime: { rawValue: 0, normalisedValue: 0, weight: 0.1, contribution: 0, explanation: '' },
          total: 45,
        },
        confidence: 0.9,
        triageMode: 'AI' as const,
        assetId: null,
        locationId: null,
        assignedTeamId: null,
        ackDueAt: null,
        resolveDueAt: null,
        reporterId: 'usr-1',
        tags: [],
        metadata: {
          manualPriority: 99,
          overriddenBy: 'supervisor-1',
        },
        createdAt: new Date('2026-09-18T10:00:00.000Z').toISOString(),
        updatedAt: new Date('2026-09-18T10:00:00.000Z').toISOString(),
      };

      const updatedRecords: Array<{ id: string; patch: any }> = [];

      const mockIncidentRepo = {
        queryQueue: async (_t: string, status: string) => {
          if (status === 'NEW') {
            return { items: [{ ...openIncident }, { ...overrideIncident }], nextCursor: null };
          }
          return { items: [], nextCursor: null };
        },
        queryByAsset: async () => ({ items: [], nextCursor: null }),
        update: async (_t: string, id: string, patch: any) => {
          updatedRecords.push({ id, patch });
          return { id, ...patch };
        },
      } as any;

      const mockReferenceRepo = {
        getTenant: async () => ({ scoringWeights: DEFAULT_SCORING_WEIGHTS }),
      } as any;

      const { recalculateOpenIncidents } = await import('../src/index.js');
      const result = await recalculateOpenIncidents(tenantId, {
        incidentRepo: mockIncidentRepo,
        referenceRepo: mockReferenceRepo,
      });

      expect(result.totalEvaluated).toBe(2);
      expect(result.totalUpdated).toBe(2);

      // Verify normal incident updated priorityScore to computed total
      const normalUpdate = updatedRecords.find((r) => r.id === 'inc-normal-1');
      expect(normalUpdate).toBeDefined();
      expect(normalUpdate!.patch.priorityScore).toBe(normalUpdate!.patch.scoreBreakdown.total);

      // Verify override incident preserved manualPriority 99 for priorityScore
      const overrideUpdate = updatedRecords.find((r) => r.id === 'inc-override-2');
      expect(overrideUpdate).toBeDefined();
      expect(overrideUpdate!.patch.priorityScore).toBe(99);
      expect(overrideUpdate!.patch.scoreBreakdown).toBeDefined();
    });
  });
});
