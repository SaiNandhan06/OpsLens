import { z } from 'zod';
import {
  IncidentSchema,
  IncidentStatusEnum,
  IncidentCategoryEnum,
  SeverityEnum,
  TimelineEventSchema,
  IncidentAttachmentSchema,
  IncidentLinkSchema,
} from './incident.js';
import { ScoringWeightsSchema, ScoreBreakdownSchema } from './scoring.js';

// ============================================================================
// Incident Endpoints
// ============================================================================

/**
 * Runtime Zod schema for creating a new incident report.
 */
export const CreateIncidentRequestSchema = z.object({
  title: z.string().min(1, 'Title cannot be empty').max(200, 'Title too long').optional(),
  description: z.string().min(1, 'Description is required'),
  attachmentKeys: z.array(z.string()).default([]),
  locationHint: z.string().nullable().optional(),
  assetHint: z.string().nullable().optional(),
  isAnonymous: z.boolean().default(false),
  locationId: z.string().nullable().optional(),
  assetId: z.string().nullable().optional(),
  mediaUrls: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Inferred TypeScript type for CreateIncident request payload.
 */
export type CreateIncidentRequest = z.infer<typeof CreateIncidentRequestSchema>;

/**
 * Runtime Zod schema for CreateIncident response.
 */
export const CreateIncidentResponseSchema = z.object({
  incident: IncidentSchema,
});

/**
 * Inferred TypeScript type for CreateIncident response payload.
 */
export type CreateIncidentResponse = z.infer<typeof CreateIncidentResponseSchema>;

/**
 * Runtime Zod schema for listing incidents with filtering and pagination.
 */
export const ListIncidentsQuerySchema = z.object({
  status: z.union([IncidentStatusEnum, z.literal('OPEN')]).optional(),
  category: IncidentCategoryEnum.optional(),
  severity: SeverityEnum.optional(),
  assignedTeamId: z.string().optional(),
  assetId: z.string().optional(),
  reporterId: z.string().optional(),
  priorityMin: z.coerce.number().min(0).max(100).optional(),
  priorityMax: z.coerce.number().min(0).max(100).optional(),
  limit: z.coerce.number().int().min(1).default(25),
  cursor: z.string().optional(),
});

/**
 * Inferred TypeScript type for ListIncidents query parameters.
 */
export type ListIncidentsQuery = z.infer<typeof ListIncidentsQuerySchema>;

/**
 * Runtime Zod schema for ListIncidents response.
 */
export const ListIncidentsResponseSchema = z.object({
  items: z.array(IncidentSchema),
  nextCursor: z.string().nullable(),
  totalCount: z.number().int().nonnegative().optional(),
});

/**
 * Inferred TypeScript type for ListIncidents response.
 */
export type ListIncidentsResponse = z.infer<typeof ListIncidentsResponseSchema>;

/**
 * Runtime Zod schema for GetIncident path parameters.
 */
export const GetIncidentParamsSchema = z.object({
  id: z.string().min(1, 'Incident ID is required'),
});

/**
 * Inferred TypeScript type for GetIncident path parameters.
 */
export type GetIncidentParams = z.infer<typeof GetIncidentParamsSchema>;

/**
 * Runtime Zod schema for an incident attachment with a presigned GET download URL.
 */
export const IncidentAttachmentWithUrlSchema = IncidentAttachmentSchema.extend({
  downloadUrl: z.string().url(),
});

/**
 * Inferred TypeScript type for an incident attachment with download URL.
 */
export type IncidentAttachmentWithUrl = z.infer<typeof IncidentAttachmentWithUrlSchema>;

/**
 * Runtime Zod schema for GetIncident response.
 */
export const GetIncidentResponseSchema = z.object({
  incident: IncidentSchema,
  scoreBreakdown: ScoreBreakdownSchema.optional(),
  timeline: z.array(TimelineEventSchema).default([]),
  attachments: z.array(IncidentAttachmentWithUrlSchema).default([]),
  relatedIncidents: z.array(z.union([IncidentLinkSchema, IncidentSchema, z.record(z.string(), z.unknown())])).default([]),
});

/**
 * Inferred TypeScript type for GetIncident response.
 */
export type GetIncidentResponse = z.infer<typeof GetIncidentResponseSchema>;

/**
 * Runtime Zod schema for patching incident properties.
 */
export const PatchIncidentRequestSchema = z.object({
  status: IncidentStatusEnum.optional(),
  severity: SeverityEnum.optional(),
  assignedTeamId: z.string().nullable().optional(),
  locationId: z.string().nullable().optional(),
  assetId: z.string().nullable().optional(),
  notes: z.string().optional(),
});

/**
 * Inferred TypeScript type for PatchIncident request.
 */
export type PatchIncidentRequest = z.infer<typeof PatchIncidentRequestSchema>;

/**
 * Runtime Zod schema for PatchIncident response.
 */
export const PatchIncidentResponseSchema = z.object({
  incident: IncidentSchema,
});

/**
 * Inferred TypeScript type for PatchIncident response.
 */
export type PatchIncidentResponse = z.infer<typeof PatchIncidentResponseSchema>;

/**
 * Runtime Zod schema for adding a comment to an incident.
 */
export const AddCommentRequestSchema = z.object({
  content: z.string().min(1, 'Comment content cannot be empty'),
});

/**
 * Inferred TypeScript type for AddComment request.
 */
export type AddCommentRequest = z.infer<typeof AddCommentRequestSchema>;

/**
 * Runtime Zod schema for AddComment response.
 */
export const AddCommentResponseSchema = z.object({
  event: TimelineEventSchema,
});

/**
 * Inferred TypeScript type for AddComment response.
 */
export type AddCommentResponse = z.infer<typeof AddCommentResponseSchema>;

/**
 * Runtime Zod schema for merging a duplicate incident into a canonical parent.
 */
export const MergeIncidentRequestSchema = z.object({
  targetIncidentId: z.string().min(1, 'Target incident ID is required'),
  reason: z.string().min(1, 'Merge reason is required'),
});

/**
 * Inferred TypeScript type for MergeIncident request.
 */
export type MergeIncidentRequest = z.infer<typeof MergeIncidentRequestSchema>;

/**
 * Runtime Zod schema for MergeIncident response.
 */
export const MergeIncidentResponseSchema = z.object({
  sourceIncident: IncidentSchema,
  targetIncident: IncidentSchema,
});

/**
 * Inferred TypeScript type for MergeIncident response.
 */
export type MergeIncidentResponse = z.infer<typeof MergeIncidentResponseSchema>;

/**
 * Runtime Zod schema for answering an AI clarification question.
 */
export const AnswerClarificationRequestSchema = z.object({
  answer: z.string().min(1, 'Clarification answer is required'),
});

/**
 * Inferred TypeScript type for AnswerClarification request.
 */
export type AnswerClarificationRequest = z.infer<typeof AnswerClarificationRequestSchema>;

/**
 * Runtime Zod schema for AnswerClarification response.
 */
export const AnswerClarificationResponseSchema = z.object({
  incident: IncidentSchema,
});

/**
 * Inferred TypeScript type for AnswerClarification response.
 */
export type AnswerClarificationResponse = z.infer<typeof AnswerClarificationResponseSchema>;

// ============================================================================
// Uploads Endpoints
// ============================================================================

/**
 * Allowed media upload categories: photo (images) or audio (voice memos).
 */
export const UploadKindEnum = z.enum(['photo', 'audio']);
export type UploadKind = z.infer<typeof UploadKindEnum>;

/**
 * Runtime Zod schema for requesting a presigned S3 upload URL with media type and size constraints.
 */
export const PresignedUploadRequestSchema = z.object({
  kind: UploadKindEnum,
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  fileName: z.string().optional(),
});
export type PresignedUploadRequest = z.infer<typeof PresignedUploadRequestSchema>;

/**
 * Runtime Zod schema for requesting a presigned S3 upload URL.
 */
export const GetPresignedUploadUrlRequestSchema = z.object({
  kind: UploadKindEnum.optional(),
  fileName: z.string().optional(),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive().max(50 * 1024 * 1024, 'Max upload size is 50MB'),
});

/**
 * Inferred TypeScript type for presigned upload request.
 */
export type GetPresignedUploadUrlRequest = z.infer<typeof GetPresignedUploadUrlRequestSchema>;

/**
 * Runtime Zod schema for presigned S3 upload URL response.
 */
export const GetPresignedUploadUrlResponseSchema = z.object({
  uploadUrl: z.string().url(),
  s3Key: z.string().min(1),
  key: z.string().min(1).optional(),
  expiresAt: z.string().datetime(),
});

/**
 * Inferred TypeScript type for presigned upload response.
 */
export type GetPresignedUploadUrlResponse = z.infer<typeof GetPresignedUploadUrlResponseSchema>;

// ============================================================================
// Dashboard Endpoints
// ============================================================================

/**
 * Runtime Zod schema for operational dashboard summary metrics.
 */
export const GetDashboardSummaryResponseSchema = z.object({
  totalIncidents: z.number().int().nonnegative(),
  activeCount: z.number().int().nonnegative(),
  criticalCount: z.number().int().nonnegative(),
  breachedCount: z.number().int().nonnegative(),
  avgResolutionMinutes: z.number().nonnegative(),
  todayVolume: z.number().int().nonnegative(),
  slaComplianceRate: z.number().min(0).max(100),
});

/**
 * Inferred TypeScript type for dashboard summary metrics.
 */
export type GetDashboardSummaryResponse = z.infer<typeof GetDashboardSummaryResponseSchema>;

/**
 * Runtime Zod schema for a warehouse incident recurrence hotspot.
 */
export const HotspotItemSchema = z.object({
  assetId: z.string().nullable(),
  locationId: z.string().nullable(),
  incidentCount: z.number().int().positive(),
  primaryCategory: IncidentCategoryEnum,
  riskScore: z.number().min(0).max(100),
  lastIncidentAt: z.string().datetime(),
});

/**
 * Inferred TypeScript type for a hotspot item.
 */
export type HotspotItem = z.infer<typeof HotspotItemSchema>;

/**
 * Runtime Zod schema for the hotspots response.
 */
export const GetHotspotsResponseSchema = z.object({
  hotspots: z.array(HotspotItemSchema),
});

/**
 * Inferred TypeScript type for the hotspots response.
 */
export type GetHotspotsResponse = z.infer<typeof GetHotspotsResponseSchema>;

/**
 * Runtime Zod schema for an automated prevention recommendation.
 */
export const RecommendationItemSchema = z.object({
  id: z.string().min(1),
  assetId: z.string().nullable(),
  title: z.string().min(1),
  description: z.string().min(1),
  suggestedAction: z.string().min(1),
  confidence: z.number().min(0).max(1),
  estimatedSavingsHours: z.number().nonnegative(),
  createdAt: z.string().datetime(),
});

/**
 * Inferred TypeScript type for a recommendation item.
 */
export type RecommendationItem = z.infer<typeof RecommendationItemSchema>;

/**
 * Runtime Zod schema for prevention recommendations response.
 */
export const GetRecommendationsResponseSchema = z.object({
  recommendations: z.array(RecommendationItemSchema),
});

/**
 * Inferred TypeScript type for recommendations response.
 */
export type GetRecommendationsResponse = z.infer<typeof GetRecommendationsResponseSchema>;

// ============================================================================
// Config Endpoints
// ============================================================================

/**
 * Runtime Zod schema for an SLA policy definition.
 */
export const SlaPolicySchema = z.object({
  category: IncidentCategoryEnum,
  severity: SeverityEnum,
  ackTargetMinutes: z.number().int().positive(),
  resolveTargetMinutes: z.number().int().positive(),
  escalationTeamId: z.string().min(1),
});

/**
 * Inferred TypeScript type for an SLA policy.
 */
export type SlaPolicy = z.infer<typeof SlaPolicySchema>;

/**
 * Runtime Zod schema for system configuration response.
 */
export const GetConfigResponseSchema = z.object({
  tenantId: z.string().min(1),
  scoringWeights: ScoringWeightsSchema,
  slaPolicies: z.array(SlaPolicySchema),
  demoMode: z.boolean(),
});

/**
 * Inferred TypeScript type for system configuration response.
 */
export type GetConfigResponse = z.infer<typeof GetConfigResponseSchema>;

/**
 * Runtime Zod schema for updating scoring weights.
 */
export const UpdateScoringWeightsRequestSchema = z.object({
  scoringWeights: ScoringWeightsSchema,
});

/**
 * Inferred TypeScript type for updating scoring weights request.
 */
export type UpdateScoringWeightsRequest = z.infer<typeof UpdateScoringWeightsRequestSchema>;

/**
 * Runtime Zod schema for updating scoring weights response.
 */
export const UpdateScoringWeightsResponseSchema = z.object({
  scoringWeights: ScoringWeightsSchema,
});

/**
 * Inferred TypeScript type for updating scoring weights response.
 */
export type UpdateScoringWeightsResponse = z.infer<typeof UpdateScoringWeightsResponseSchema>;

/**
 * Runtime Zod schema for updating SLA policies.
 */
export const UpdateSlaPoliciesRequestSchema = z.object({
  slaPolicies: z.array(SlaPolicySchema),
});

/**
 * Inferred TypeScript type for updating SLA policies request.
 */
export type UpdateSlaPoliciesRequest = z.infer<typeof UpdateSlaPoliciesRequestSchema>;

/**
 * Runtime Zod schema for updating SLA policies response.
 */
export const UpdateSlaPoliciesResponseSchema = z.object({
  slaPolicies: z.array(SlaPolicySchema),
});

/**
 * Inferred TypeScript type for updating SLA policies response.
 */
export type UpdateSlaPoliciesResponse = z.infer<typeof UpdateSlaPoliciesResponseSchema>;

/**
 * Runtime Zod schema for warehouse reference data (teams, assets, users).
 */
export const GetReferenceDataResponseSchema = z.object({
  teams: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      skills: z.array(IncidentCategoryEnum),
    }),
  ),
  assets: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      zone: z.string().min(1),
      category: IncidentCategoryEnum,
    }),
  ),
});

/**
 * Inferred TypeScript type for reference data.
 */
export type GetReferenceDataResponse = z.infer<typeof GetReferenceDataResponseSchema>;

// ============================================================================
// Admin Endpoints
// ============================================================================

/**
 * Runtime Zod schema for resetting demo state.
 */
export const ResetDemoRequestSchema = z.object({
  confirm: z.literal(true),
});

/**
 * Inferred TypeScript type for demo reset request.
 */
export type ResetDemoRequest = z.infer<typeof ResetDemoRequestSchema>;

/**
 * Runtime Zod schema for demo reset response.
 */
export const ResetDemoResponseSchema = z.object({
  reset: z.literal(true),
  timestamp: z.string().datetime(),
});

/**
 * Inferred TypeScript type for demo reset response.
 */
export type ResetDemoResponse = z.infer<typeof ResetDemoResponseSchema>;

/**
 * Runtime Zod schema for seeding demo data.
 */
export const SeedDemoRequestSchema = z.object({
  dataset: z.string().default('default'),
});

/**
 * Inferred TypeScript type for demo seed request.
 */
export type SeedDemoRequest = z.infer<typeof SeedDemoRequestSchema>;

/**
 * Runtime Zod schema for demo seed response.
 */
export const SeedDemoResponseSchema = z.object({
  seeded: z.literal(true),
  incidentCount: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
});

/**
 * Inferred TypeScript type for demo seed response.
 */
export type SeedDemoResponse = z.infer<typeof SeedDemoResponseSchema>;
