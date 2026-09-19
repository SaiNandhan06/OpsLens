import type { APIGatewayProxyEvent } from 'aws-lambda';
import { ulid } from 'ulid';
import {
  CreateIncidentRequestSchema,
  Incident,
  IncidentCreatedEvent,
  ScoreBreakdown,
  TimelineEvent,
} from '@opslens/contracts';
import {
  IncidentRepository,
  TimelineRepository,
  AttachmentRepository,
} from '@opslens/data';
import {
  ApiResponse,
  apiSuccess,
  ValidationError,
  HandlerContext,
} from '@opslens/platform';
import { moveStagingAttachment } from './s3.js';
import { publishIncidentCreatedEvent } from './eventbridge.js';

function createInitialBreakdown(): ScoreBreakdown {
  return {
    businessImpact: {
      rawValue: 0,
      normalisedValue: 0,
      weight: 0.3,
      contribution: 0,
      explanation: 'Initial intake - pending AI triage',
    },
    safetyRisk: {
      rawValue: 0,
      normalisedValue: 0,
      weight: 0.25,
      contribution: 0,
      explanation: 'Initial intake - pending AI triage',
    },
    slaUrgency: {
      rawValue: 0,
      normalisedValue: 0,
      weight: 0.2,
      contribution: 0,
      explanation: 'Initial intake - pending AI triage',
    },
    recurrence: {
      rawValue: 0,
      normalisedValue: 0,
      weight: 0.15,
      contribution: 0,
      explanation: 'Initial intake - pending AI triage',
    },
    downtime: {
      rawValue: 0,
      normalisedValue: 0,
      weight: 0.1,
      contribution: 0,
      explanation: 'Initial intake - pending AI triage',
    },
    total: 0,
  };
}

export async function handleCreateIncident(
  event: APIGatewayProxyEvent,
  context: HandlerContext,
  repos: {
    incidentRepo?: IncidentRepository;
    timelineRepo?: TimelineRepository;
    attachmentRepo?: AttachmentRepository;
  } = {},
): Promise<ApiResponse> {
  const { authContext, correlationId } = context;
  const { tenantId } = authContext;

  const incidentRepo = repos.incidentRepo || new IncidentRepository();
  const timelineRepo = repos.timelineRepo || new TimelineRepository();
  const attachmentRepo = repos.attachmentRepo || new AttachmentRepository();

  // 1. Parse and validate JSON request body against contracts schema
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(event.body || '{}');
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  const validationResult = CreateIncidentRequestSchema.safeParse(parsedJson);
  if (!validationResult.success) {
    throw new ValidationError(
      'Validation failed for CreateIncidentRequest',
      validationResult.error.issues,
    );
  }

  const body = validationResult.data;

  // 2. Generate identity, timestamps, and identifiers
  const incidentId = ulid();
  const now = new Date().toISOString();
  const isAnonymous = Boolean(body.isAnonymous);
  const reporterId = isAnonymous ? 'ANONYMOUS' : authContext.userId;

  const title =
    body.title ||
    (body.description.length > 80
      ? `${body.description.substring(0, 77)}...`
      : body.description);

  // 3. Move attachments from staging prefix to permanent prefix concurrently
  const attachmentKeys = body.attachmentKeys || [];
  const movedAttachments = await Promise.all(
    attachmentKeys.map((stagingKey) =>
      moveStagingAttachment({
        tenantId,
        incidentId,
        stagingKey,
        uploadedBy: reporterId,
        attachmentRepo,
      }),
    ),
  );

  // 4. Construct incident entity with status NEW
  const incident: Incident = {
    id: incidentId,
    tenantId,
    title,
    description: body.description,
    status: 'NEW',
    category: 'OPERATIONS',
    severity: 'MEDIUM',
    priorityScore: 0,
    scoreBreakdown: createInitialBreakdown(),
    confidence: 0,
    triageMode: 'AI',
    assetId: body.assetId || body.assetHint || null,
    locationId: body.locationId || body.locationHint || null,
    assignedTeamId: null,
    ackDueAt: null,
    resolveDueAt: null,
    reporterId,
    tags: body.tags || [],
    metadata: {
      ...body.metadata,
      locationHint: body.locationHint || null,
      assetHint: body.assetHint || null,
      isAnonymous,
      attachmentKeys: movedAttachments.map((a) => a.s3Key),
    },
    createdAt: now,
    updatedAt: now,
  };

  // 5. Persist the incident entity to DynamoDB
  await incidentRepo.create(tenantId, incident);

  // 6. Write the INCIDENT_CREATED timeline audit event
  const timelineEvent: TimelineEvent = {
    id: ulid(),
    incidentId,
    tenantId,
    type: 'INCIDENT_CREATED',
    actorId: reporterId,
    actorRole: authContext.role,
    timestamp: now,
    data: {
      description: incident.description,
      attachmentCount: movedAttachments.length,
      isAnonymous,
    },
  };
  await timelineRepo.appendEvent(tenantId, timelineEvent);

  // 7. Publish INCIDENT_CREATED to EventBridge custom bus with correlationId
  const eventPayload: IncidentCreatedEvent = {
    type: 'INCIDENT_CREATED',
    tenantId,
    incidentId,
    correlationId,
    occurredAt: now,
    reporterId,
    title: incident.title,
    description: incident.description,
    mediaUrls: movedAttachments.map((a) => a.s3Key),
    locationId: incident.locationId,
    assetId: incident.assetId,
  };
  await publishIncidentCreatedEvent(eventPayload);

  // 8. Return HTTP 201 without calling AI synchronously (< 500ms response time)
  return apiSuccess({ incident }, 201);
}
