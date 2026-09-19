/**
 * Pure key-building functions for the single-table DynamoDB layout.
 * Conforms strictly to CODEBASE_MAP.md §5.
 */

/**
 * Zero-pads a priority score (0-100) to 3 digits.
 * Ensures alphabetical ordering matches numerical ordering in GSI1 sort key
 * (e.g. "080" sorts above "009").
 */
export function padPriorityScore(score: number): string {
  const clamped = Math.max(0, Math.min(999, Math.round(score)));
  return String(clamped).padStart(3, '0');
}

/**
 * Zero-pads a routing rule priority to 2 digits.
 */
export function padRoutingPriority(priority: number): string {
  const clamped = Math.max(0, Math.min(99, Math.round(priority)));
  return String(clamped).padStart(2, '0');
}

// ============================================================================
// Primary Key Builders
// ============================================================================

export function tenantPk(tenantId: string): string {
  return `TENANT#${tenantId}`;
}

export function tenantMetaSk(): string {
  return 'META';
}

export function userSk(userId: string): string {
  return `USER#${userId}`;
}

export function teamSk(teamId: string): string {
  return `TEAM#${teamId}`;
}

export function assetSk(assetId: string): string {
  return `ASSET#${assetId}`;
}

export function locationSk(locationId: string): string {
  return `LOC#${locationId}`;
}

export function slaPolicySk(category: string, severity: string): string {
  return `SLA#${category.toUpperCase()}#${severity.toUpperCase()}`;
}

export function routingRuleSk(priority: number, ruleId: string): string {
  return `ROUTE#${padRoutingPriority(priority)}#${ruleId}`;
}

export function incidentSk(incidentId: string): string {
  return `INCIDENT#${incidentId}`;
}

export function timelineEventSk(incidentId: string, timestamp: string, seq: number | string = 0): string {
  const seqStr = typeof seq === 'number' ? String(seq).padStart(4, '0') : seq;
  return `INCIDENT#${incidentId}#EVT#${timestamp}#${seqStr}`;
}

export function attachmentSk(incidentId: string, attachmentId: string): string {
  return `INCIDENT#${incidentId}#ATT#${attachmentId}`;
}

export function incidentLinkSk(parentIncidentId: string, childIncidentId: string): string {
  return `INCIDENT#${parentIncidentId}#LINK#${childIncidentId}`;
}

export function metricsSk(date: string): string {
  return `METRICS#${date}`;
}

export function recommendationSk(date: string, assetId: string): string {
  return `REC#${date}#${assetId}`;
}

export function budgetSk(date: string): string {
  return `BUDGET#${date}`;
}

// ============================================================================
// Global Secondary Index (GSI) Key Builders
// ============================================================================

/**
 * GSI1: Priority-sorted queue per status.
 * Sort key is zero-padded to 3 digits so PRIO#080 sorts above PRIO#009.
 */
export function gsi1Pk(tenantId: string, status: string): string {
  return `TENANT#${tenantId}#STATUS#${status.toUpperCase()}`;
}

export function gsi1Sk(priorityScore: number, createdAt: string): string {
  return `PRIO#${padPriorityScore(priorityScore)}#${createdAt}`;
}

/**
 * GSI2: Asset history, deduplication candidates, recurrence cluster.
 */
export function gsi2Pk(tenantId: string, assetId: string): string {
  return `TENANT#${tenantId}#ASSET#${assetId}`;
}

export function gsi2Sk(createdAt: string): string {
  return `TS#${createdAt}`;
}

/**
 * GSI3: Active SLA sweeper (SPARSE).
 * Only populated when SLA is running. Omitted/removed when resolved/closed/merged.
 */
export function gsi3Pk(tenantId: string): string {
  return `TENANT#${tenantId}#SLA#ACTIVE`;
}

export function gsi3Sk(earliestDueAt: string): string {
  return `DUE#${earliestDueAt}`;
}

/**
 * GSI4: "My submissions" queried by reporter user ID.
 */
export function gsi4Pk(tenantId: string, reporterId: string): string {
  return `TENANT#${tenantId}#USER#${reporterId}`;
}

export function gsi4Sk(createdAt: string): string {
  return `TS#${createdAt}`;
}
