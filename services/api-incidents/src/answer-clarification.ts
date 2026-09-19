import type { APIGatewayProxyEvent } from 'aws-lambda';
import { ulid } from 'ulid';
import { IncidentRepository, TimelineRepository } from '@opslens/data';
import {
  ApiResponse,
  apiSuccess,
  ValidationError,
  NotFoundError,
  HandlerContext,
  logger,
} from '@opslens/platform';
import { runTriagePipeline } from '@opslens/service-worker-triage';

export async function handleAnswerClarification(
  event: APIGatewayProxyEvent,
  context: HandlerContext,
  repos: {
    incidentRepo?: IncidentRepository;
    timelineRepo?: TimelineRepository;
  } = {},
): Promise<ApiResponse> {
  const { authContext, correlationId } = context;
  const { tenantId } = authContext;

  const incidentRepo = repos.incidentRepo || new IncidentRepository();
  const timelineRepo = repos.timelineRepo || new TimelineRepository();

  const incidentId = event.pathParameters?.id;
  if (!incidentId) {
    throw new ValidationError('Incident ID path parameter is required');
  }

  let body: { answer?: string };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  const answer = body.answer?.trim();
  if (!answer || answer.length === 0) {
    throw new ValidationError('Clarification answer must be a non-empty string');
  }

  // 1. Fetch incident and confirm existence within tenant
  const incident = await incidentRepo.getById(tenantId, incidentId);
  if (!incident) {
    throw new NotFoundError(`Incident ${incidentId} not found`);
  }

  // 2. Validate current lifecycle status
  if (incident.status !== 'NEEDS_INFO') {
    throw new ValidationError(
      `Cannot answer clarification for incident in status ${incident.status}; expected NEEDS_INFO`,
    );
  }

  // 3. Append clarification answer to description
  const updatedDescription = `${incident.description}\n\nClarification: ${answer}`;
  const now = new Date().toISOString();
  const triageRunCount = ((incident.metadata?.triageRunCount as number) || 1) + 1;

  await incidentRepo.update(tenantId, incidentId, {
    description: updatedDescription,
    metadata: {
      ...incident.metadata,
      clarificationAnswer: answer,
      triageRunCount,
    },
  });

  // 4. Append timeline event
  await timelineRepo.appendEvent(tenantId, {
    id: ulid(),
    incidentId,
    tenantId,
    type: 'COMMENT_ADDED',
    actorId: authContext.userId,
    actorRole: authContext.role,
    timestamp: now,
    data: {
      action: 'CLARIFICATION_ANSWERED',
      answer,
      question: incident.metadata?.clarifyingQuestion,
    },
  });

  logger.info('Recorded clarification answer; re-running triage pipeline once', {
    tenantId,
    incidentId,
    correlationId,
    triageRunCount,
  });

  // 5. Re-run triage pipeline exactly once
  const triagedIncident = await runTriagePipeline({
    tenantId,
    incidentId,
    correlationId,
  });

  return apiSuccess({ incident: triagedIncident });
}
