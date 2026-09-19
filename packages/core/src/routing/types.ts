import type { IncidentCategory } from '@opslens/contracts';

/**
 * Standard shift patterns supported in warehouse team definitions.
 */
export type ShiftPattern = '24x7_ROTATIONAL' | 'STANDARD_DAY' | 'TWO_SHIFT' | string;

/**
 * Operational conditions evaluated against an incident during routing.
 */
export interface RoutingRuleConditions {
  assetId?: string | null;
  category?: IncidentCategory | string | null;
  locationId?: string | null;
  [key: string]: unknown;
}

/**
 * Declarative rule determining target team dispatch.
 */
export interface RoutingRule {
  id: string;
  priority: number;
  name: string;
  conditions: RoutingRuleConditions;
  targetTeamId: string;
  reason: string;
  [key: string]: unknown;
}

/**
 * Team profile for routing evaluation and shift awareness.
 */
export interface TeamRoutingProfile {
  id: string;
  name: string;
  shiftPattern?: ShiftPattern;
  skills?: string[];
  supervisorId?: string;
  contactRadioChannel?: string;
  [key: string]: unknown;
}

/**
 * Result of the pure routing resolution.
 */
export interface RouteResolution {
  /** Target team ID assigned to receive the incident */
  targetTeamId: string;
  /** Matched rule ID that triggered the assignment */
  ruleId: string;
  /** Human-readable explanation of the routing decision */
  reason: string;
  /** Whether the incident was redirected to a fallback team due to off-shift hours */
  routedOutOfShift: boolean;
  /** The original team that matched the rule prior to shift evaluation */
  matchedTeamId: string;
}

/**
 * Options provided to resolveRoute.
 */
export interface RoutingOptions {
  /** Fallback team ID for tenant if no specific rule matches or when out-of-shift */
  fallbackTeamId?: string;
  /** IANA timezone identifier for tenant facility (e.g., 'Asia/Kolkata', 'UTC') */
  timezone?: string;
}
