import type { Incident, IncidentStatus, ScoringWeights } from '@opslens/contracts';
import { IncidentRepository, ReferenceRepository } from '@opslens/data';
import { calculatePriority } from './calculator.js';
import { DEFAULT_SCORING_WEIGHTS, validateWeights } from './types.js';

export interface RecalculateOpenIncidentsOptions {
  weights?: ScoringWeights;
  now?: Date;
  incidentRepo?: IncidentRepository;
  referenceRepo?: ReferenceRepository;
}

export interface RecalculateResult {
  tenantId: string;
  totalEvaluated: number;
  totalUpdated: number;
  incidents: Incident[];
}

const OPEN_STATUSES: IncidentStatus[] = [
  'NEW',
  'TRIAGING',
  'ROUTED',
  'ACKNOWLEDGED',
  'IN_PROGRESS',
  'NEEDS_INFO',
];

/**
 * Recomputes priority scores for all active open incidents under a tenant.
 * Triggered when tenant scoring weights change or when the SLA sweeper refreshes SLA urgency.
 *
 * Updates both scoreBreakdown and the composite priorityScore (which updates GSI1 sort key).
 * If an incident has a supervisor manual priority override, the manual priority is preserved
 * for queue sorting while the updated computed breakdown is stored.
 */
export async function recalculateOpenIncidents(
  tenantId: string,
  weightsOrOptions: ScoringWeights | RecalculateOpenIncidentsOptions = {},
  extraOptions: RecalculateOpenIncidentsOptions = {},
): Promise<RecalculateResult> {
  let options: RecalculateOpenIncidentsOptions = {};
  if (weightsOrOptions) {
    if ('businessImpact' in weightsOrOptions) {
      options = { weights: weightsOrOptions as ScoringWeights, ...extraOptions };
    } else {
      options = weightsOrOptions as RecalculateOpenIncidentsOptions;
    }
  }

  const incidentRepo = options.incidentRepo || new IncidentRepository();
  const referenceRepo = options.referenceRepo || new ReferenceRepository();
  const now = options.now || new Date();

  // 1. Resolve scoring weights
  let weights = options.weights;
  if (!weights) {
    const tenantMeta = await referenceRepo.getTenant(tenantId).catch(() => null);
    weights = (tenantMeta?.scoringWeights as ScoringWeights) || DEFAULT_SCORING_WEIGHTS;
  }
  validateWeights(weights);

  // 2. Fetch all open incidents across active lifecycle states
  const openIncidents: Incident[] = [];
  for (const status of OPEN_STATUSES) {
    let cursor: string | null = null;
    do {
      const page = await incidentRepo.queryQueue(tenantId, status, {
        limit: 50,
        cursor: cursor || undefined,
      });
      openIncidents.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
  }

  // 3. Recalculate each open incident
  const updatedIncidents: Incident[] = [];

  for (const incident of openIncidents) {
    // Determine 30-day recurrence count on asset if assetId exists
    let recurrenceCount = incident.scoreBreakdown?.recurrence?.rawValue ?? 0;
    if (incident.assetId) {
      try {
        const history = await incidentRepo.queryByAsset(tenantId, incident.assetId, {
          limit: 20,
        });
        const thirtyDaysAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;
        const matchingPrior = history.items.filter(
          (item) =>
            item.id !== incident.id &&
            item.category === incident.category &&
            new Date(item.createdAt).getTime() >= thirtyDaysAgo,
        );
        recurrenceCount = matchingPrior.length;
      } catch {
        // Retain previous recurrence if query unavailable
      }
    }

    const newBreakdown = calculatePriority(
      {
        category: incident.category,
        severity: incident.severity,
        assetId: incident.assetId,
        locationId: incident.locationId,
        createdAt: incident.createdAt,
        resolveDueAt: incident.resolveDueAt,
        ackDueAt: incident.ackDueAt,
        impactSignals: incident.metadata?.impactSignals as string[] | undefined,
        affectedOrders: incident.scoreBreakdown?.businessImpact?.rawValue,
        estimatedStoppageMinutes: incident.scoreBreakdown?.downtime?.rawValue,
        sameCategoryIncidentCount30Days: recurrenceCount,
        description: incident.description,
      },
      weights,
      now,
    );

    // Queue sort key uses manual override if present; otherwise new computed total
    const hasManualOverride =
      incident.metadata?.manualPriority !== undefined &&
      incident.metadata?.manualPriority !== null;

    const finalPriorityScore = hasManualOverride
      ? Number(incident.metadata!.manualPriority)
      : newBreakdown.total;

    const updated = await incidentRepo.update(tenantId, incident.id, {
      priorityScore: finalPriorityScore,
      scoreBreakdown: newBreakdown,
      metadata: {
        ...incident.metadata,
        computedPriorityScore: newBreakdown.total,
        lastRescoredAt: now.toISOString(),
      },
    });

    updatedIncidents.push(updated);
  }

  return {
    tenantId,
    totalEvaluated: openIncidents.length,
    totalUpdated: updatedIncidents.length,
    incidents: updatedIncidents,
  };
}
