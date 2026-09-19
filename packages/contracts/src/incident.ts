import { z } from 'zod';
import { ScoreBreakdownSchema } from './scoring.js';

/**
 * Lifecycle states of an OpsLens warehouse incident.
 */
export const IncidentStatusEnum = z.enum([
  'NEW',
  'TRIAGING',
  'ROUTED',
  'ACKNOWLEDGED',
  'IN_PROGRESS',
  'RESOLVED',
  'CLOSED',
  'NEEDS_INFO',
  'MERGED',
  'REOPENED',
]);

/**
 * Inferred TypeScript type for incident status.
 */
export type IncidentStatus = z.infer<typeof IncidentStatusEnum>;

/**
 * Seven primary warehouse incident categories defined in the OpsLens specification.
 */
export const IncidentCategoryEnum = z.enum([
  'EQUIPMENT',
  'SAFETY',
  'FACILITY',
  'INVENTORY',
  'OPERATIONS',
  'ENVIRONMENTAL',
  'SECURITY',
]);

/**
 * Inferred TypeScript type for incident category.
 */
export type IncidentCategory = z.infer<typeof IncidentCategoryEnum>;

/**
 * Operational urgency and impact severity classifications.
 */
export const SeverityEnum = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);

/**
 * Inferred TypeScript type for incident severity.
 */
export type Severity = z.infer<typeof SeverityEnum>;

/**
 * Types of immutable timeline events logged for an incident.
 */
export const TimelineEventTypeEnum = z.enum([
  'CREATED',
  'INCIDENT_CREATED',
  'TRIAGED',
  'ROUTED',
  'ACKNOWLEDGED',
  'STATUS_CHANGED',
  'COMMENT_ADDED',
  'ATTACHMENT_ADDED',
  'SLA_BREACHED',
  'ESCALATED',
  'RESOLVED',
  'CLOSED',
  'REOPENED',
  'MERGED',
  'LINKED',
]);

/**
 * Inferred TypeScript type for timeline event type.
 */
export type TimelineEventType = z.infer<typeof TimelineEventTypeEnum>;

/**
 * Relationship link types between incidents (e.g., duplicates or recurring issues).
 */
export const LinkTypeEnum = z.enum([
  'DUPLICATE',
  'DUPLICATE_CANDIDATE',
  'RELATED',
  'PARENT',
  'CHILD',
]);

/**
 * Inferred TypeScript type for incident link type.
 */
export type LinkType = z.infer<typeof LinkTypeEnum>;

/**
 * Processing mode used during incident extraction and triage.
 */
export const TriageModeEnum = z.enum(['AI', 'RULE', 'FALLBACK', 'MANUAL']);

/**
 * Inferred TypeScript type for triage mode.
 */
export type TriageMode = z.infer<typeof TriageModeEnum>;

/**
 * Origin source of a specific incident property or field value.
 */
export const FieldSourceEnum = z.enum(['AI', 'USER', 'RULE', 'SYSTEM', 'FALLBACK']);

/**
 * Inferred TypeScript type for field source origin.
 */
export type FieldSource = z.infer<typeof FieldSourceEnum>;

/**
 * Runtime Zod schema for the AI extraction and triage evaluation output.
 */
export const TriageResultSchema = z.object({
  category: IncidentCategoryEnum.describe('Classified incident category'),
  severity: SeverityEnum.describe('Assessed incident severity level'),
  locationId: z.string().nullable().describe('Identified warehouse location identifier, if detected'),
  assetId: z.string().nullable().describe('Identified warehouse asset or equipment ID, if detected'),
  summary: z.string().min(1).describe('Concise operational summary of the reported incident'),
  impactSignals: z.array(z.string()).describe('Specific operational impact cues identified'),
  entities: z.record(z.string(), z.string()).describe('Extracted key entities (e.g. equipment codes, zone names)'),
  recommendedFirstAction: z.string().min(1).describe('Immediate suggested mitigation or containment step'),
  confidence: z.number().min(0).max(1).describe('Model classification confidence between 0.0 and 1.0'),
  clarifyingQuestion: z.string().nullable().describe('Optional clarifying question if input is ambiguous'),
  triageMode: TriageModeEnum.default('AI').describe('Processing mode that generated this triage result'),
});

/**
 * Inferred TypeScript type for structured AI triage output.
 */
export type TriageResult = z.infer<typeof TriageResultSchema>;

/**
 * Runtime Zod schema for an append-only timeline audit event.
 */
export const TimelineEventSchema = z.object({
  id: z.string().min(1).describe('Unique timeline event identifier or sequence ULID'),
  incidentId: z.string().min(1).describe('Associated incident identifier'),
  tenantId: z.string().min(1).describe('Tenant identifier for isolation'),
  type: TimelineEventTypeEnum.describe('Type of timeline action occurred'),
  actorId: z.string().min(1).describe('User or system identifier that triggered the event'),
  actorRole: z.string().optional().describe('Role of the actor when event was generated'),
  timestamp: z.string().datetime().describe('UTC ISO-8601 timestamp of event occurrence'),
  data: z.record(z.string(), z.unknown()).optional().describe('Arbitrary payload attributes specific to event type'),
});

/**
 * Inferred TypeScript type for an incident timeline event.
 */
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

/**
 * Runtime Zod schema for an incident media attachment.
 */
export const IncidentAttachmentSchema = z.object({
  id: z.string().min(1).describe('Attachment unique ID'),
  incidentId: z.string().min(1).describe('Associated incident ID'),
  tenantId: z.string().min(1).describe('Tenant identifier'),
  fileName: z.string().min(1).describe('Original file name'),
  contentType: z.string().min(1).describe('MIME content type'),
  s3Key: z.string().min(1).describe('S3 object key in media bucket'),
  sizeBytes: z.number().nonnegative().describe('File size in bytes'),
  uploadedBy: z.string().min(1).describe('User ID who uploaded the attachment'),
  createdAt: z.string().datetime().describe('UTC ISO-8601 upload timestamp'),
});

/**
 * Inferred TypeScript type for an incident attachment item.
 */
export type IncidentAttachment = z.infer<typeof IncidentAttachmentSchema>;

/**
 * Runtime Zod schema for an incident duplicate or relationship link.
 */
export const IncidentLinkSchema = z.object({
  parentIncidentId: z.string().min(1).describe('Parent or canonical incident ID'),
  childIncidentId: z.string().min(1).describe('Child or duplicate incident ID'),
  linkType: LinkTypeEnum.describe('Relationship type classification'),
  similarityScore: z.number().min(0).max(1).optional().describe('Cosine similarity score for duplicate links'),
  reason: z.string().optional().describe('Human-readable one-line reason for link classification'),
  linkedBy: z.string().min(1).describe('User or AI system that created the link'),
  createdAt: z.string().datetime().describe('UTC ISO-8601 link creation timestamp'),
});

/**
 * Inferred TypeScript type for linked incident relationship.
 */
export type IncidentLink = z.infer<typeof IncidentLinkSchema>;

/**
 * Runtime Zod schema for full OpsLens incident entity.
 */
export const IncidentSchema = z.object({
  id: z.string().min(1).describe('Unique incident ULID identifier'),
  tenantId: z.string().min(1).describe('Multi-tenant isolation identifier'),
  title: z.string().min(1).describe('Headline summary or title of incident'),
  description: z.string().describe('Full textual incident description or transcription'),
  status: IncidentStatusEnum.describe('Current lifecycle status'),
  category: IncidentCategoryEnum.describe('Assigned warehouse incident category'),
  severity: SeverityEnum.describe('Assigned incident severity'),
  priorityScore: z.number().min(0).max(100).describe('Composite business impact priority score (0 to 100)'),
  scoreBreakdown: ScoreBreakdownSchema.describe('Detailed mathematical breakdown across five scoring factors'),
  confidence: z.number().min(0).max(1).describe('Triage classification confidence score (0 to 1)'),
  triageMode: TriageModeEnum.describe('Triage strategy applied (AI, RULE, or FALLBACK)'),
  assetId: z.string().nullable().describe('Referenced warehouse asset identifier (e.g. Dock-4, Forklift-12)'),
  locationId: z.string().nullable().describe('Referenced warehouse location or bay identifier'),
  assignedTeamId: z.string().nullable().describe('Assigned maintenance or response team identifier'),
  ackDueAt: z.string().datetime().nullable().describe('SLA deadline for acknowledgment (UTC ISO-8601)'),
  resolveDueAt: z.string().datetime().nullable().describe('SLA deadline for resolution (UTC ISO-8601)'),
  earliestDueAt: z.string().datetime().nullable().optional().describe('Earliest upcoming SLA deadline for GSI3 (UTC ISO-8601)'),
  slaActive: z.boolean().optional().describe('Whether SLA tracking is actively monitored in GSI3'),
  slaBreached: z.boolean().optional().describe('Whether incident breached SLA deadline'),
  escalationLevel: z.number().int().nonnegative().optional().describe('Current escalation ladder rung (1: Assignee, 2: Supervisor, 3: Manager)'),
  acknowledgedAt: z.string().datetime().nullable().optional().describe('Actual timestamp acknowledged (UTC ISO-8601)'),
  resolvedAt: z.string().datetime().nullable().optional().describe('Actual timestamp resolved (UTC ISO-8601)'),
  closedAt: z.string().datetime().nullable().optional().describe('Actual timestamp closed (UTC ISO-8601)'),
  reporterId: z.string().min(1).describe('User identifier of original reporter'),
  embedding: z.array(z.number()).optional().describe('256-dimensional semantic embedding vector'),
  tags: z.array(z.string()).default([]).describe('Optional categorization tags'),
  metadata: z.record(z.string(), z.unknown()).default({}).describe('Custom tenant or integration metadata'),
  createdAt: z.string().datetime().describe('UTC ISO-8601 record creation timestamp'),
  updatedAt: z.string().datetime().describe('UTC ISO-8601 record last modified timestamp'),
});

/**
 * Inferred TypeScript type representing a complete OpsLens incident.
 */
export type Incident = z.infer<typeof IncidentSchema>;
