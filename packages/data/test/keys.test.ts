import { describe, it, expect } from 'vitest';
import {
  padPriorityScore,
  padRoutingPriority,
  tenantPk,
  tenantMetaSk,
  userSk,
  teamSk,
  assetSk,
  locationSk,
  slaPolicySk,
  routingRuleSk,
  incidentSk,
  timelineEventSk,
  attachmentSk,
  incidentLinkSk,
  metricsSk,
  recommendationSk,
  budgetSk,
  gsi1Pk,
  gsi1Sk,
  gsi2Pk,
  gsi2Sk,
  gsi3Pk,
  gsi3Sk,
  gsi4Pk,
  gsi4Sk,
} from '../src/keys.js';

describe('keys.ts: Key Building & Zero-Padding', () => {
  describe('padPriorityScore', () => {
    it('zero-pads single-digit priority score to 3 digits', () => {
      expect(padPriorityScore(9)).toBe('009');
      expect(padPriorityScore(0)).toBe('000');
    });

    it('zero-pads two-digit priority score to 3 digits', () => {
      expect(padPriorityScore(80)).toBe('080');
      expect(padPriorityScore(42)).toBe('042');
    });

    it('retains three-digit priority score without extra padding', () => {
      expect(padPriorityScore(100)).toBe('100');
    });

    it('confirms lexical sorting of padded scores matches numeric order (80 sorts above 9)', () => {
      const score9Key = gsi1Sk(9, '2026-09-18T10:00:00.000Z');
      const score80Key = gsi1Sk(80, '2026-09-18T10:00:00.000Z');
      const score100Key = gsi1Sk(100, '2026-09-18T10:00:00.000Z');

      expect(score9Key).toBe('PRIO#009#2026-09-18T10:00:00.000Z');
      expect(score80Key).toBe('PRIO#080#2026-09-18T10:00:00.000Z');
      expect(score100Key).toBe('PRIO#100#2026-09-18T10:00:00.000Z');

      // Descending sort order (highest priority first)
      const list = [score9Key, score100Key, score80Key];
      list.sort((a, b) => b.localeCompare(a));

      expect(list).toEqual([score100Key, score80Key, score9Key]);
      expect(score80Key > score9Key).toBe(true);
    });

    it('zero-pads routing priority to 2 digits', () => {
      expect(padRoutingPriority(1)).toBe('01');
      expect(padRoutingPriority(10)).toBe('10');
      expect(padRoutingPriority(99)).toBe('99');
    });
  });

  describe('Primary Key builders', () => {
    it('builds tenant PK and meta SK', () => {
      expect(tenantPk('north-hub')).toBe('TENANT#north-hub');
      expect(tenantMetaSk()).toBe('META');
    });

    it('builds reference SKs', () => {
      expect(userSk('usr-123')).toBe('USER#usr-123');
      expect(teamSk('team-maint')).toBe('TEAM#team-maint');
      expect(assetSk('conv-d4')).toBe('ASSET#conv-d4');
      expect(locationSk('loc-dock-4')).toBe('LOC#loc-dock-4');
    });

    it('builds SLA and routing rule SKs', () => {
      expect(slaPolicySk('EQUIPMENT', 'HIGH')).toBe('SLA#EQUIPMENT#HIGH');
      expect(routingRuleSk(1, 'rule-1')).toBe('ROUTE#01#rule-1');
      expect(routingRuleSk(10, 'rule-10')).toBe('ROUTE#10#rule-10');
    });

    it('builds incident, timeline, and link SKs', () => {
      expect(incidentSk('01HRX')).toBe('INCIDENT#01HRX');
      expect(timelineEventSk('01HRX', '2026-09-18T00:00:00Z', 1)).toBe('INCIDENT#01HRX#EVT#2026-09-18T00:00:00Z#0001');
      expect(attachmentSk('01HRX', 'att-1')).toBe('INCIDENT#01HRX#ATT#att-1');
      expect(incidentLinkSk('01PARENT', '01CHILD')).toBe('INCIDENT#01PARENT#LINK#01CHILD');
    });

    it('builds metrics, recommendation, and budget SKs', () => {
      expect(metricsSk('2026-09-18')).toBe('METRICS#2026-09-18');
      expect(recommendationSk('2026-09-18', 'CONV-D4')).toBe('REC#2026-09-18#CONV-D4');
      expect(budgetSk('2026-09-18')).toBe('BUDGET#2026-09-18');
    });
  });

  describe('GSI Key builders', () => {
    it('builds GSI1 keys', () => {
      expect(gsi1Pk('north-hub', 'TRIAGING')).toBe('TENANT#north-hub#STATUS#TRIAGING');
      expect(gsi1Sk(45, '2026-09-18T12:00:00Z')).toBe('PRIO#045#2026-09-18T12:00:00Z');
    });

    it('builds GSI2 keys', () => {
      expect(gsi2Pk('north-hub', 'CONV-D4')).toBe('TENANT#north-hub#ASSET#CONV-D4');
      expect(gsi2Sk('2026-09-18T12:00:00Z')).toBe('TS#2026-09-18T12:00:00Z');
    });

    it('builds GSI3 keys', () => {
      expect(gsi3Pk('north-hub')).toBe('TENANT#north-hub#SLA#ACTIVE');
      expect(gsi3Sk('2026-09-18T14:00:00Z')).toBe('DUE#2026-09-18T14:00:00Z');
    });

    it('builds GSI4 keys', () => {
      expect(gsi4Pk('north-hub', 'usr-1')).toBe('TENANT#north-hub#USER#usr-1');
      expect(gsi4Sk('2026-09-18T12:00:00Z')).toBe('TS#2026-09-18T12:00:00Z');
    });
  });
});
