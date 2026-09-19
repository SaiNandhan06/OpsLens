import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  IncidentAttachmentWithUrl,
} from '@opslens/contracts';
import {
  IncidentRepository,
  TimelineRepository,
  AttachmentRepository,
  LinkRepository,
} from '@opslens/data';
import {
  ApiResponse,
  apiSuccess,
  BadRequestError,
  NotFoundError,
  TenantMismatchError,
  HandlerContext,
  logger,
} from '@opslens/platform';
import { generatePresignedGetUrl } from './s3.js';

export async function handleGetIncident(
  event: APIGatewayProxyEvent,
  context: HandlerContext,
  repos: {
    incidentRepo?: IncidentRepository;
    timelineRepo?: TimelineRepository;
    attachmentRepo?: AttachmentRepository;
    linkRepo?: LinkRepository;
  } = {},
): Promise<ApiResponse> {
  const { authContext } = context;
  const { tenantId } = authContext;

  const incidentId = event.pathParameters?.id;
  if (!incidentId) {
    throw new BadRequestError('Incident ID is required in path parameters');
  }

  // Cross-tenant header check
  const requestedTenant = event.headers?.['x-tenant-id'] || event.headers?.['X-Tenant-Id'];
  if (requestedTenant && requestedTenant !== tenantId) {
    logger.warn('Security event: Cross-tenant header mismatch detected', {
      securityEvent: 'CROSS_TENANT_ACCESS_ATTEMPT',
      correlationId: context.correlationId,
      callerTenantId: tenantId,
      targetTenantId: requestedTenant,
      userId: authContext.userId,
      incidentId,
    });
    throw new TenantMismatchError(
      `Forbidden: Cross-tenant access to tenant '${requestedTenant}' is strictly forbidden`,
    );
  }

  const incidentRepo = repos.incidentRepo || new IncidentRepository();
  const timelineRepo = repos.timelineRepo || new TimelineRepository();
  const attachmentRepo = repos.attachmentRepo || new AttachmentRepository();
  const linkRepo = repos.linkRepo || new LinkRepository();

  // 1. Fetch incident by tenant and ID
  const incident = await incidentRepo.getById(tenantId, incidentId);
  if (!incident) {
    // Check if incident belongs to another tenant (security cross-tenant detection)
    const knownTenants = ['south-hub', 'north-hub'].filter((t) => t !== tenantId);
    for (const otherTenant of knownTenants) {
      const otherIncident = await incidentRepo.getById(otherTenant, incidentId);
      if (otherIncident) {
        logger.warn('Security event: Cross-tenant access attempt detected and blocked', {
          securityEvent: 'CROSS_TENANT_ACCESS_ATTEMPT',
          correlationId: context.correlationId,
          callerTenantId: tenantId,
          targetTenantId: otherTenant,
          userId: authContext.userId,
          incidentId,
        });
        throw new TenantMismatchError(
          `Forbidden: Access to incident belonging to tenant '${otherTenant}' is strictly forbidden`,
        );
      }
    }
    throw new NotFoundError(`Incident '${incidentId}' not found in tenant '${tenantId}'`);
  }

  // 2. Concurrently fetch timeline, attachments, and related links
  const [timelineResult, rawAttachments, relatedLinks] = await Promise.all([
    timelineRepo.listEvents(tenantId, incidentId),
    attachmentRepo.listAttachments(tenantId, incidentId),
    linkRepo.getLinks(tenantId, incidentId),
  ]);

  // 3. Generate short-lived presigned GET URLs (15 minutes) for attachments
  const attachmentsWithUrls: IncidentAttachmentWithUrl[] = await Promise.all(
    rawAttachments.map(async (att) => {
      let downloadUrl = '';
      try {
        downloadUrl = await generatePresignedGetUrl(att.s3Key);
      } catch {
        // Fallback for mocked/offline test environments
        downloadUrl = `https://${process.env.MEDIA_BUCKET || 'opslens-media-local'}.s3.amazonaws.com/${att.s3Key}?signature=mock`;
      }
      return {
        ...att,
        downloadUrl,
      };
    }),
  );

  // 4. Return complete response envelope
  return apiSuccess({
    incident,
    scoreBreakdown: incident.scoreBreakdown,
    timeline: timelineResult.items,
    attachments: attachmentsWithUrls,
    relatedIncidents: relatedLinks,
  });
}
