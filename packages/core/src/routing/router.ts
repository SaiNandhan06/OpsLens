import type { Incident } from '@opslens/contracts';
import type {
  RoutingRule,
  TeamRoutingProfile,
  RouteResolution,
  RoutingOptions,
} from './types.js';
import { isTeamOnShift, getLocalTimeDetails } from './shift.js';

/**
 * Resolves the target operational team for an incident in strict precedence order:
 * 1. Asset-specific rule (assetId matches)
 * 2. Category + Location rule (category and locationId match)
 * 3. Category default rule (category matches without location or asset constraints)
 * 4. Tenant fallback team (catch-all rule or tenant default)
 *
 * Shift awareness:
 * If the resolved team is off-shift at `now` in the tenant's timezone, the incident
 * is diverted to the fallback team and flagged with `routedOutOfShift: true`.
 */
export function resolveRoute(
  incident: Pick<Incident, 'category' | 'assetId' | 'locationId'>,
  rules: RoutingRule[],
  teams: TeamRoutingProfile[] | Record<string, TeamRoutingProfile>,
  now: Date | string | number = new Date(),
  options: RoutingOptions = {},
): RouteResolution {
  const teamMap = new Map<string, TeamRoutingProfile>();
  if (Array.isArray(teams)) {
    for (const t of teams) {
      if (t?.id) teamMap.set(t.id, t);
    }
  } else if (teams && typeof teams === 'object') {
    for (const [k, v] of Object.entries(teams)) {
      teamMap.set(v.id || k, v);
    }
  }

  const timezone = options.timezone || 'UTC';

  // Sort rules by priority ascending (lowest number = highest priority)
  const sortedRules = [...rules].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));

  // Locate the default fallback rule / team
  const fallbackRule = sortedRules.find(
    (r) =>
      r.id === 'ROUTE-FALLBACK' ||
      (!r.conditions?.assetId && !r.conditions?.category && !r.conditions?.locationId),
  );
  const fallbackTeamId = options.fallbackTeamId || fallbackRule?.targetTeamId || 'TEAM-LOGISTICS';

  let matchedRule: RoutingRule | null = null;
  let matchType = '';

  // 1. Asset-specific rule
  if (incident.assetId) {
    const assetRule = sortedRules.find((r) => r.conditions?.assetId === incident.assetId);
    if (assetRule) {
      matchedRule = assetRule;
      matchType = 'asset-specific';
    }
  }

  // 2. Category + Location rule
  if (!matchedRule && incident.category && incident.locationId) {
    const catLocRule = sortedRules.find(
      (r) =>
        r.conditions?.category === incident.category &&
        r.conditions?.locationId === incident.locationId,
    );
    if (catLocRule) {
      matchedRule = catLocRule;
      matchType = 'category + location';
    }
  }

  // 3. Category default rule
  if (!matchedRule && incident.category) {
    const catRule = sortedRules.find(
      (r) =>
        r.conditions?.category === incident.category &&
        !r.conditions?.locationId &&
        !r.conditions?.assetId,
    );
    if (catRule) {
      matchedRule = catRule;
      matchType = 'category default';
    }
  }

  // 4. Tenant fallback team
  if (!matchedRule) {
    matchedRule = fallbackRule || {
      id: 'TENANT-FALLBACK',
      priority: 999,
      name: 'Tenant Default Fallback Team',
      conditions: {},
      targetTeamId: fallbackTeamId,
      reason: 'Default tenant fallback team assigned (no rule matched)',
    };
    matchType = 'tenant fallback';
  }

  const matchedTeamId = matchedRule.targetTeamId;
  const matchedTeam = teamMap.get(matchedTeamId);

  // Evaluate shift awareness
  const onShift = isTeamOnShift(matchedTeam?.shiftPattern, timezone, now);

  if (!onShift) {
    const timeDetails = getLocalTimeDetails(now, timezone);
    const timeStr = `${String(timeDetails.hour).padStart(2, '0')}:${String(timeDetails.minute).padStart(2, '0')}`;
    const reason = `${matchedRule.reason} [Note: Team ${matchedTeam?.name || matchedTeamId} is currently off-shift at ${timeStr} ${timezone} (${matchedTeam?.shiftPattern || 'OFF-SHIFT'}). Diverted to fallback team ${fallbackTeamId}]`;

    return {
      targetTeamId: fallbackTeamId,
      ruleId: matchedRule.id,
      reason,
      routedOutOfShift: true,
      matchedTeamId,
    };
  }

  return {
    targetTeamId: matchedTeamId,
    ruleId: matchedRule.id,
    reason: matchedRule.reason || `Routed via ${matchType} rule ${matchedRule.id}`,
    routedOutOfShift: false,
    matchedTeamId,
  };
}
