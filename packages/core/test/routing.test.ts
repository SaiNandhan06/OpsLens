import { describe, it, expect } from 'vitest';
import {
  resolveRoute,
  isTeamOnShift,
  getLocalTimeDetails,
  type RoutingRule,
  type TeamRoutingProfile,
} from '../src/routing/index.js';

describe('packages/core/src/routing', () => {
  const teams: TeamRoutingProfile[] = [
    {
      id: 'TEAM-MAINT',
      name: 'Maintenance & Facility Engineering',
      shiftPattern: '24x7_ROTATIONAL',
      skills: ['EQUIPMENT', 'FACILITY'],
    },
    {
      id: 'TEAM-SAFETY',
      name: 'EHS & Warehouse Safety',
      shiftPattern: 'STANDARD_DAY',
      skills: ['SAFETY', 'ENVIRONMENTAL'],
    },
    {
      id: 'TEAM-INVENTORY',
      name: 'Inventory Control & Quality Assurance',
      shiftPattern: 'TWO_SHIFT',
      skills: ['INVENTORY'],
    },
    {
      id: 'TEAM-LOGISTICS',
      name: 'Outbound Logistics & Dispatch Operations',
      shiftPattern: 'TWO_SHIFT',
      skills: ['OPERATIONS'],
    },
  ];

  const rules: RoutingRule[] = [
    {
      id: 'ROUTE-CONV-D4',
      priority: 1,
      name: 'Dock 4 Conveyor Critical Routing',
      conditions: { assetId: 'CONV-D4' },
      targetTeamId: 'TEAM-MAINT',
      reason: 'Asset CONV-D4 is high-criticality conveyor reserved for direct engineering dispatch',
    },
    {
      id: 'ROUTE-EQUIP-DOCK',
      priority: 5,
      name: 'Dock Area Equipment Failure',
      conditions: { category: 'EQUIPMENT', locationId: 'LOC-DOCK-4' },
      targetTeamId: 'TEAM-MAINT',
      reason: 'Equipment failure at Dock 4 dispatched to maintenance',
    },
    {
      id: 'ROUTE-EQUIPMENT-DEFAULT',
      priority: 10,
      name: 'Equipment Maintenance Default',
      conditions: { category: 'EQUIPMENT' },
      targetTeamId: 'TEAM-MAINT',
      reason: 'Route equipment failures directly to Maintenance team',
    },
    {
      id: 'ROUTE-SAFETY-DEFAULT',
      priority: 12,
      name: 'Safety Incidents',
      conditions: { category: 'SAFETY' },
      targetTeamId: 'TEAM-SAFETY',
      reason: 'Route safety hazards to EHS team',
    },
    {
      id: 'ROUTE-INVENTORY-DEFAULT',
      priority: 13,
      name: 'Inventory Spills',
      conditions: { category: 'INVENTORY' },
      targetTeamId: 'TEAM-INVENTORY',
      reason: 'Route damaged items to Inventory team',
    },
    {
      id: 'ROUTE-FALLBACK',
      priority: 99,
      name: 'Default Fallback Team',
      conditions: {},
      targetTeamId: 'TEAM-LOGISTICS',
      reason: 'Default catch-all routing rule when no specific policy triggers',
    },
  ];

  // A daytime timestamp on a Wednesday: 2026-09-16T06:30:00Z (which is 12:00 PM in Asia/Kolkata)
  const wednesdayNoonKolkata = new Date('2026-09-16T06:30:00Z');
  // A nighttime timestamp on Wednesday: 2026-09-16T18:30:00Z (which is 00:00 midnight Thursday in Asia/Kolkata)
  const midnightKolkata = new Date('2026-09-16T18:30:00Z');
  // Sunday afternoon: 2026-09-20T08:30:00Z (which is 14:00 Sunday in Asia/Kolkata)
  const sundayAfternoonKolkata = new Date('2026-09-20T08:30:00Z');

  describe('Precedence Order Verification', () => {
    it('resolves asset-specific rule when assetId matches (Tier 1)', () => {
      const result = resolveRoute(
        { category: 'EQUIPMENT', assetId: 'CONV-D4', locationId: 'LOC-DOCK-4' },
        rules,
        teams,
        wednesdayNoonKolkata,
        { timezone: 'Asia/Kolkata' },
      );

      expect(result.ruleId).toBe('ROUTE-CONV-D4');
      expect(result.targetTeamId).toBe('TEAM-MAINT');
      expect(result.routedOutOfShift).toBe(false);
      expect(result.reason).toContain('CONV-D4');
    });

    it('enforces precedence: asset-specific rule wins over category+location and category default', () => {
      // Matches:
      // 1. assetId: CONV-D4 (ROUTE-CONV-D4)
      // 2. category: EQUIPMENT, locationId: LOC-DOCK-4 (ROUTE-EQUIP-DOCK)
      // 3. category: EQUIPMENT (ROUTE-EQUIPMENT-DEFAULT)
      const result = resolveRoute(
        { category: 'EQUIPMENT', assetId: 'CONV-D4', locationId: 'LOC-DOCK-4' },
        rules,
        teams,
        wednesdayNoonKolkata,
        { timezone: 'Asia/Kolkata' },
      );

      expect(result.ruleId).toBe('ROUTE-CONV-D4');
    });

    it('resolves category + location rule when no asset rule matches (Tier 2)', () => {
      const result = resolveRoute(
        { category: 'EQUIPMENT', assetId: 'UNKNOWN-ASSET', locationId: 'LOC-DOCK-4' },
        rules,
        teams,
        wednesdayNoonKolkata,
        { timezone: 'Asia/Kolkata' },
      );

      expect(result.ruleId).toBe('ROUTE-EQUIP-DOCK');
      expect(result.targetTeamId).toBe('TEAM-MAINT');
      expect(result.routedOutOfShift).toBe(false);
    });

    it('resolves category default rule when location has no specific rule (Tier 3)', () => {
      const result = resolveRoute(
        { category: 'EQUIPMENT', assetId: null, locationId: 'LOC-STORAGE-9' },
        rules,
        teams,
        wednesdayNoonKolkata,
        { timezone: 'Asia/Kolkata' },
      );

      expect(result.ruleId).toBe('ROUTE-EQUIPMENT-DEFAULT');
      expect(result.targetTeamId).toBe('TEAM-MAINT');
      expect(result.routedOutOfShift).toBe(false);
    });

    it('resolves tenant fallback team when no rules match (Tier 4)', () => {
      const result = resolveRoute(
        { category: 'SECURITY' as any, assetId: null, locationId: 'LOC-GATE-1' },
        rules,
        teams,
        wednesdayNoonKolkata,
        { timezone: 'Asia/Kolkata' },
      );

      expect(result.ruleId).toBe('ROUTE-FALLBACK');
      expect(result.targetTeamId).toBe('TEAM-LOGISTICS');
      expect(result.routedOutOfShift).toBe(false);
    });
  });

  describe('Shift Awareness & Timezone Arithmetic', () => {
    it('verifies getLocalTimeDetails correctly converts UTC to Asia/Kolkata (+5:30)', () => {
      // 06:30 UTC -> 12:00 in Kolkata
      const details = getLocalTimeDetails(wednesdayNoonKolkata, 'Asia/Kolkata');
      expect(details.hour).toBe(12);
      expect(details.minute).toBe(0);
      expect(details.weekday).toBe('Wed');
      expect(details.isWeekend).toBe(false);

      // 18:30 UTC -> 00:00 midnight next day in Kolkata
      const midnightDetails = getLocalTimeDetails(midnightKolkata, 'Asia/Kolkata');
      expect(midnightDetails.hour).toBe(0);
      expect(midnightDetails.minute).toBe(0);
      expect(midnightDetails.weekday).toBe('Thu');
    });

    it('24x7_ROTATIONAL is always on shift day and night', () => {
      expect(isTeamOnShift('24x7_ROTATIONAL', 'Asia/Kolkata', wednesdayNoonKolkata)).toBe(true);
      expect(isTeamOnShift('24x7_ROTATIONAL', 'Asia/Kolkata', midnightKolkata)).toBe(true);
      expect(isTeamOnShift('24x7_ROTATIONAL', 'Asia/Kolkata', sundayAfternoonKolkata)).toBe(true);
    });

    it('STANDARD_DAY is on-shift on weekday business hours, off-shift at night and weekends', () => {
      // Wednesday 12:00 PM -> on shift
      expect(isTeamOnShift('STANDARD_DAY', 'Asia/Kolkata', wednesdayNoonKolkata)).toBe(true);

      // Wednesday 00:00 midnight -> off shift
      expect(isTeamOnShift('STANDARD_DAY', 'Asia/Kolkata', midnightKolkata)).toBe(false);

      // Sunday 14:00 -> off shift (weekend)
      expect(isTeamOnShift('STANDARD_DAY', 'Asia/Kolkata', sundayAfternoonKolkata)).toBe(false);
    });

    it('TWO_SHIFT is on-shift 06:00 to 22:00, off-shift during night hours (22:00 to 06:00)', () => {
      // Wednesday 12:00 PM -> on shift
      expect(isTeamOnShift('TWO_SHIFT', 'Asia/Kolkata', wednesdayNoonKolkata)).toBe(true);

      // Midnight -> off shift
      expect(isTeamOnShift('TWO_SHIFT', 'Asia/Kolkata', midnightKolkata)).toBe(false);
    });

    it('diverts to fallback team and sets routedOutOfShift when matched team is off-shift', () => {
      // SAFETY category matches TEAM-SAFETY (STANDARD_DAY).
      // At midnight in Kolkata, TEAM-SAFETY is off-shift.
      const result = resolveRoute(
        { category: 'SAFETY', assetId: null, locationId: null },
        rules,
        teams,
        midnightKolkata,
        { timezone: 'Asia/Kolkata', fallbackTeamId: 'TEAM-MAINT' },
      );

      expect(result.ruleId).toBe('ROUTE-SAFETY-DEFAULT');
      expect(result.matchedTeamId).toBe('TEAM-SAFETY');
      expect(result.targetTeamId).toBe('TEAM-MAINT'); // Rerouted to fallback
      expect(result.routedOutOfShift).toBe(true);
      expect(result.reason).toContain('off-shift');
      expect(result.reason).toContain('Asia/Kolkata');
    });

    it('keeps original team assignment when matched team is 24x7 continuous even at midnight', () => {
      const result = resolveRoute(
        { category: 'EQUIPMENT', assetId: 'CONV-D4', locationId: 'LOC-DOCK-4' },
        rules,
        teams,
        midnightKolkata,
        { timezone: 'Asia/Kolkata' },
      );

      // TEAM-MAINT is 24x7_ROTATIONAL
      expect(result.targetTeamId).toBe('TEAM-MAINT');
      expect(result.routedOutOfShift).toBe(false);
    });
  });
});
