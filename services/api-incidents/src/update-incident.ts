import type { APIGatewayProxyEvent } from 'aws-lambda';
import { ulid } from 'ulid';
import {
  IncidentRepository,
  TimelineRepository,
  MetricsRepository,
} from '@opslens/data';
import {
  ApiResponse,
  apiSuccess,
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  HandlerContext,
} from '@opslens/platform';
import { validateTransition } from '@opslens/core';
import type { IncidentStatus } from '@opslens/contracts';

interface UpdateIncidentBody {
  manualPriority?: number;
  overrideReason?: string;
  status?: IncidentStatus;
  assignedTeamId?: string;
  reason?: string;
  reassignmentReason?: string;
}

export async function handleUpdateIncident(
  event: APIGatewayProxyEvent,
  context: HandlerContext,
  incidentRepo = new IncidentRepository(),
  timelineRepo = new TimelineRepository(),
  metricsRepo = new MetricsRepository(),
): Promise<ApiResponse> {
  const { tenantId, userId, role } = context.authContext;
  const incidentId = event.pathParameters?.id;

  if (!incidentId) {
    throw new BadRequestError('Incident ID is required');
  }

  if (!event.body) {
    throw new BadRequestError('Request body is required');
  }

  let body: UpdateIncidentBody;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    throw new BadRequestError('Invalid JSON body');
  }

  if (body.manualPriority !== undefined) {
    if (typeof body.manualPriority !== 'number' || body.manualPriority < 0 || body.manualPriority > 100) {
      throw new BadRequestError('manualPriority must be a number between 0 and 100');
    }
  }

  const existing = await incidentRepo.getById(tenantId, incidentId);
  if (!existing) {
    throw new NotFoundError(`Incident ${incidentId} not found`);
  }

  const patch: Record<string, unknown> = {};
  const nowIso = new Date().toISOString();

  // 1. Handle manual priority override
  if (body.manualPriority !== undefined) {
    patch.priorityScore = body.manualPriority;
    patch.metadata = {
      ...(existing.metadata || {}),
      manualPriority: body.manualPriority,
      overrideReason: body.overrideReason || 'Supervisor manual priority override',
      overriddenBy: userId,
      overriddenAt: nowIso,
    };

    await timelineRepo.appendEvent(tenantId, {
      id: ulid(),
      incidentId,
      tenantId,
      type: 'COMMENT_ADDED',
      actorId: userId,
      actorRole: role,
      timestamp: nowIso,
      data: {
        action: 'PRIORITY_OVERRIDE',
        previousPriority: existing.priorityScore,
        manualPriority: body.manualPriority,
        overriddenBy: userId,
        reason: body.overrideReason || 'Supervisor manual priority override',
        computedScore: existing.scoreBreakdown?.total ?? existing.priorityScore,
      },
    });
  }

  // 2. Handle team reassignment (supervisor+ only, requires reason, does NOT reset SLA timers)
  if (body.assignedTeamId !== undefined) {
    const allowedRoles = ['supervisor', 'manager', 'admin'];
    if (!allowedRoles.includes(role)) {
      throw new ForbiddenError('Only supervisors, managers, or admins can reassign incidents');
    }

    const reassignmentReason = (body.reason || body.reassignmentReason || '').trim();
    if (!reassignmentReason) {
      throw new BadRequestError('Reason is required for team reassignment');
    }

    patch.assignedTeamId = body.assignedTeamId;

    await timelineRepo.appendEvent(tenantId, {
      id: ulid(),
      incidentId,
      tenantId,
      type: 'ROUTED',
      actorId: userId,
      actorRole: role,
      timestamp: nowIso,
      data: {
        action: 'REASSIGNED',
        previousTeamId: existing.assignedTeamId,
        assignedTeamId: body.assignedTeamId,
        reason: reassignmentReason,
      },
    });
  }

  // 3. Handle lifecycle status transition (enforces state machine, illegal -> 409 INCIDENT_INVALID_TRANSITION)
  if (body.status !== undefined) {
    validateTransition(existing.status, body.status);
    patch.status = body.status;

    const todayDate = nowIso.slice(0, 10);
    const createdMs = new Date(existing.createdAt).getTime();
    const currentMs = new Date(nowIso).getTime();

    // On ACKNOWLEDGED: stop ack timer, record actor and timestamp, update earliestDueAt to resolveDueAt
    if (body.status === 'ACKNOWLEDGED') {
      patch.acknowledgedAt = nowIso;
      patch.earliestDueAt = existing.resolveDueAt || null;

      const mttaMinutes = Math.max(0, Math.round((currentMs - createdMs) / 60000));
      try {
        await metricsRepo.incrementDailyCounters(tenantId, todayDate, {
          mttaTotalMinutes: mttaMinutes,
          mttaCount: 1,
          mtta: mttaMinutes,
          acknowledgedCount: 1,
        });
      } catch (mErr) {
        // Non-blocking metrics update
      }
    }

    // On RESOLVED: record resolvedAt, remove slaActive & earliestDueAt from GSI3, update MTTR metrics
    if (body.status === 'RESOLVED') {
      patch.resolvedAt = nowIso;
      patch.slaActive = false;
      patch.earliestDueAt = null;

      const mttrMinutes = Math.max(0, Math.round((currentMs - createdMs) / 60000));
      try {
        await metricsRepo.incrementDailyCounters(tenantId, todayDate, {
          mttrTotalMinutes: mttrMinutes,
          mttrCount: 1,
          mttr: mttrMinutes,
          resolvedCount: 1,
        });
      } catch (mErr) {
        // Non-blocking metrics update
      }
    }

    // On CLOSED or MERGED: remove slaActive and earliestDueAt so incident leaves GSI3
    if (body.status === 'CLOSED') {
      patch.closedAt = nowIso;
      patch.slaActive = false;
      patch.earliestDueAt = null;
    } else if (body.status === 'MERGED') {
      patch.slaActive = false;
      patch.earliestDueAt = null;
    }

    await timelineRepo.appendEvent(tenantId, {
      id: ulid(),
      incidentId,
      tenantId,
      type: 'STATUS_CHANGED',
      actorId: userId,
      actorRole: role,
      timestamp: nowIso,
      data: {
        action: 'STATUS_CHANGED',
        previousStatus: existing.status,
        newStatus: body.status,
      },
    });
  }

  const updated = await incidentRepo.update(tenantId, incidentId, patch);

  return apiSuccess(updated, 200);
}
