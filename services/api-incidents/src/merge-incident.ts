import type { APIGatewayProxyEvent } from 'aws-lambda';
import { ulid } from 'ulid';
import {
  IncidentRepository,
  TimelineRepository,
  AttachmentRepository,
  MetricsRepository,
  LinkRepository,
} from '@opslens/data';
import {
  ApiResponse,
  apiSuccess,
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
  HandlerContext,
} from '@opslens/platform';

/**
 * Merges a duplicate child incident into a parent/canonical incident.
 * Strictly restricted to supervisor+ roles.
 *
 * Operational sequence:
 * 1. Verifies caller has supervisor, manager, or admin role.
 * 2. Enforces non-self-merge and not-already-merged (409 Conflict).
 * 3. Transfers all child attachments to the parent incident.
 * 4. Appends child description and audit details to parent timeline.
 * 5. Appends merge event to child timeline.
 * 6. Sets child status to MERGED and stores canonical reference in metadata.
 *    (IncidentRepository automatically purges child GSI3 SLA sparse keys).
 * 7. Records DUPLICATE link between parent and child.
 * 8. Atomically increments daily duplicates counter.
 */
export async function handleMergeIncident(
  event: APIGatewayProxyEvent,
  context: HandlerContext,
  incidentRepo = new IncidentRepository(),
  timelineRepo = new TimelineRepository(),
  attachmentRepo = new AttachmentRepository(),
  metricsRepo = new MetricsRepository(),
  linkRepo = new LinkRepository(),
): Promise<ApiResponse> {
  const { tenantId, role, userId } = context.authContext;
  const childIncidentId = event.pathParameters?.id;

  if (!childIncidentId) {
    throw new BadRequestError('Incident ID is required');
  }

  const allowedRoles = ['supervisor', 'manager', 'admin'];
  if (!allowedRoles.includes(role)) {
    throw new ForbiddenError('Only supervisors, managers, or admins can merge incidents');
  }

  let body: Record<string, any> = {};
  if (event.body) {
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch {
      throw new BadRequestError('Invalid JSON in request body');
    }
  }

  const parentIncidentId = body.parentIncidentId || body.canonicalIncidentId;
  if (!parentIncidentId) {
    throw new BadRequestError('parentIncidentId is required');
  }

  if (childIncidentId === parentIncidentId) {
    throw new ConflictError('Cannot merge an incident into itself');
  }

  const child = await incidentRepo.getById(tenantId, childIncidentId);
  if (!child) {
    throw new NotFoundError(`Incident ${childIncidentId} not found`);
  }

  if (child.status === 'MERGED') {
    throw new ConflictError(`Incident ${childIncidentId} is already merged`);
  }

  const parent = await incidentRepo.getById(tenantId, parentIncidentId);
  if (!parent) {
    throw new NotFoundError(`Parent incident ${parentIncidentId} not found`);
  }

  const now = new Date().toISOString();
  const reason = body.reason || 'Merged duplicate incident';

  // 1. Transfer attachments from child to parent
  const childAttachments = await attachmentRepo.listAttachments(tenantId, childIncidentId);
  for (const att of childAttachments) {
    await attachmentRepo.createAttachment(tenantId, {
      ...att,
      id: ulid(),
      incidentId: parentIncidentId,
    });
  }

  // 2. Append timeline event to parent recording the merge with child's description
  await timelineRepo.appendEvent(tenantId, {
    id: ulid(),
    incidentId: parentIncidentId,
    tenantId,
    type: 'MERGED',
    actorId: userId,
    actorRole: role,
    timestamp: now,
    data: {
      action: 'MERGED_CHILD',
      childIncidentId,
      childDescription: child.description,
      reason,
      mergedBy: userId,
      attachmentCountTransferred: childAttachments.length,
    },
  });

  // 3. Append timeline event to child
  await timelineRepo.appendEvent(tenantId, {
    id: ulid(),
    incidentId: childIncidentId,
    tenantId,
    type: 'MERGED',
    actorId: userId,
    actorRole: role,
    timestamp: now,
    data: {
      action: 'MERGED_INTO_PARENT',
      parentIncidentId,
      reason,
      mergedBy: userId,
    },
  });

  // 4. Update child status to MERGED, recording parent reference in metadata
  // IncidentRepository.update automatically purges GSI3 SLA attributes for terminal statuses (RESOLVED, CLOSED, MERGED)
  const updatedChild = await incidentRepo.updateStatus(tenantId, childIncidentId, 'MERGED', {
    metadata: {
      ...(child.metadata || {}),
      mergedIntoIncidentId: parentIncidentId,
      mergedBy: userId,
      mergedAt: now,
    },
  });

  // 5. Create duplicate link
  await linkRepo.createLink(tenantId, {
    parentIncidentId,
    childIncidentId,
    linkType: 'DUPLICATE',
    similarityScore: 1.0,
    reason,
    linkedBy: userId,
    createdAt: now,
  });

  // 6. Increment daily duplicate metric counter
  const today = now.slice(0, 10);
  await metricsRepo.incrementDailyCounters(tenantId, today, { duplicates: 1 });

  return apiSuccess(
    {
      childIncident: updatedChild,
      parentIncidentId,
      transferredAttachments: childAttachments.length,
      mergedAt: now,
    },
    200,
  );
}
