import { z } from 'zod';
import { TriageResultSchema, IncidentStatusEnum } from './incident.js';
import { ScoreBreakdownSchema } from './scoring.js';

/**
 * Standard event names published on the opslens-events bus.
 */
export const OpsLensEventTypeEnum = z.enum([
  'INCIDENT_CREATED',
  'INCIDENT_TRIAGED',
  'INCIDENT_ROUTED',
  'INCIDENT_NEEDS_INFO',
  'SLA_BREACHED',
  'INCIDENT_ESCALATED',
  'INCIDENT_RESOLVED',
]);

/**
 * Inferred TypeScript type for OpsLens event names.
 */
export type OpsLensEventType = z.infer<typeof OpsLensEventTypeEnum>;

/**
 * Runtime Zod base schema for every event on the opslens-events EventBridge bus.
 */
export const BaseEventSchema = z.object({
  tenantId: z.string().min(1).describe('Tenant identifier for isolation'),
  incidentId: z.string().min(1).describe('Target incident identifier'),
  correlationId: z.string().min(1).describe('Correlation ID for distributed tracing'),
  occurredAt: z.string().datetime().describe('UTC ISO-8601 timestamp when event occurred'),
});

/**
 * Inferred TypeScript type for base event envelope headers.
 */
export type BaseEvent = z.infer<typeof BaseEventSchema>;

/**
 * Runtime Zod schema for INCIDENT_CREATED event emitted when a new report is received.
 */
export const IncidentCreatedEventSchema = BaseEventSchema.extend({
  type: z.literal('INCIDENT_CREATED'),
  reporterId: z.string().min(1).describe('User ID of the reporter'),
  title: z.string().min(1).describe('Initial title or headline of the report'),
  description: z.string().describe('Unstructured report text or notes'),
  mediaUrls: z.array(z.string()).default([]).describe('Uploaded photo/voice media S3 URLs'),
  locationId: z.string().nullable().optional().describe('Warehouse location if provided during intake'),
  assetId: z.string().nullable().optional().describe('Warehouse asset if provided during intake'),
});

/**
 * Inferred TypeScript type for the INCIDENT_CREATED event.
 */
export type IncidentCreatedEvent = z.infer<typeof IncidentCreatedEventSchema>;

/**
 * Runtime Zod schema for INCIDENT_TRIAGED event emitted after AI classification and scoring.
 */
export const IncidentTriagedEventSchema = BaseEventSchema.extend({
  type: z.literal('INCIDENT_TRIAGED'),
  triageResult: TriageResultSchema.describe('Extracted classification, category, severity, and entities'),
  priorityScore: z.number().min(0).max(100).describe('Calculated composite priority score'),
  scoreBreakdown: ScoreBreakdownSchema.describe('Full 5-factor mathematical score breakdown'),
  isDuplicate: z.boolean().default(false).describe('Whether this incident was detected as a duplicate'),
  canonicalIncidentId: z.string().nullable().optional().describe('Canonical incident ID if marked as duplicate'),
});

/**
 * Inferred TypeScript type for the INCIDENT_TRIAGED event.
 */
export type IncidentTriagedEvent = z.infer<typeof IncidentTriagedEventSchema>;

/**
 * Runtime Zod schema for INCIDENT_ROUTED event emitted when incident is dispatched to a team.
 */
export const IncidentRoutedEventSchema = BaseEventSchema.extend({
  type: z.literal('INCIDENT_ROUTED'),
  assignedTeamId: z.string().min(1).describe('Team ID assigned to handle the work item'),
  ruleId: z.string().optional().describe('Identifier of the matching routing rule'),
  reason: z.string().optional().describe('Explanation of why this team was selected'),
});

/**
 * Inferred TypeScript type for the INCIDENT_ROUTED event.
 */
export type IncidentRoutedEvent = z.infer<typeof IncidentRoutedEventSchema>;

/**
 * Runtime Zod schema for INCIDENT_NEEDS_INFO event emitted when AI requires worker clarification.
 */
export const IncidentNeedsInfoEventSchema = BaseEventSchema.extend({
  type: z.literal('INCIDENT_NEEDS_INFO'),
  question: z.string().min(1).describe('Clarifying question to ask the reporter'),
  confidence: z.number().min(0).max(1).describe('Confidence score prompting the clarification'),
});

/**
 * Inferred TypeScript type for the INCIDENT_NEEDS_INFO event.
 */
export type IncidentNeedsInfoEvent = z.infer<typeof IncidentNeedsInfoEventSchema>;

/**
 * Runtime Zod schema for SLA_BREACHED event emitted when acknowledgment or resolution exceeds deadline.
 */
export const SlaBreachedEventSchema = BaseEventSchema.extend({
  type: z.literal('SLA_BREACHED'),
  breachType: z.enum(['ACK', 'RESOLVE']).describe('Stage of SLA policy that was breached'),
  dueAt: z.string().datetime().describe('Target deadline that was missed (UTC ISO-8601)'),
  elapsedMinutes: z.number().nonnegative().describe('Number of minutes elapsed since incident creation'),
  severity: z.string().describe('Severity level of the breached incident'),
});

/**
 * Inferred TypeScript type for the SLA_BREACHED event.
 */
export type SlaBreachedEvent = z.infer<typeof SlaBreachedEventSchema>;

/**
 * Runtime Zod schema for INCIDENT_ESCALATED event emitted on SLA breach or manual trigger.
 */
export const IncidentEscalatedEventSchema = BaseEventSchema.extend({
  type: z.literal('INCIDENT_ESCALATED'),
  escalationLevel: z.number().int().positive().describe('Current escalation tier (e.g. 1, 2)'),
  escalatedToTeamId: z.string().min(1).describe('Team or manager escalated to'),
  reason: z.string().min(1).describe('Reason for escalation (e.g. SLA breach)'),
});

/**
 * Inferred TypeScript type for the INCIDENT_ESCALATED event.
 */
export type IncidentEscalatedEvent = z.infer<typeof IncidentEscalatedEventSchema>;

/**
 * Runtime Zod schema for INCIDENT_RESOLVED event emitted when work is completed.
 */
export const IncidentResolvedEventSchema = BaseEventSchema.extend({
  type: z.literal('INCIDENT_RESOLVED'),
  resolvedBy: z.string().min(1).describe('User identifier who marked incident resolved'),
  resolutionNotes: z.string().optional().describe('Optional summary of work done to resolve'),
  durationMinutes: z.number().nonnegative().describe('Total time to resolution from creation'),
  previousStatus: IncidentStatusEnum.optional().describe('Status immediately preceding RESOLVED'),
});

/**
 * Inferred TypeScript type for the INCIDENT_RESOLVED event.
 */
export type IncidentResolvedEvent = z.infer<typeof IncidentResolvedEventSchema>;

/**
 * Discriminated union schema encompassing all valid OpsLens EventBridge event payloads.
 */
export const OpsLensEventSchema = z.discriminatedUnion('type', [
  IncidentCreatedEventSchema,
  IncidentTriagedEventSchema,
  IncidentRoutedEventSchema,
  IncidentNeedsInfoEventSchema,
  SlaBreachedEventSchema,
  IncidentEscalatedEventSchema,
  IncidentResolvedEventSchema,
]);

/**
 * Inferred TypeScript type for any valid OpsLens EventBridge event payload.
 */
export type OpsLensEvent = z.infer<typeof OpsLensEventSchema>;
