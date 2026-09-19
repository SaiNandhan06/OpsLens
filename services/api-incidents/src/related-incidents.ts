import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  LinkRepository,
  IncidentRepository,
} from '@opslens/data';
import {
  ApiResponse,
  apiSuccess,
  BadRequestError,
  NotFoundError,
  HandlerContext,
} from '@opslens/platform';

export async function handleGetRelatedIncidents(
  event: APIGatewayProxyEvent,
  context: HandlerContext,
  linkRepo = new LinkRepository(),
  incidentRepo = new IncidentRepository(),
): Promise<ApiResponse> {
  const { tenantId } = context.authContext;
  const incidentId = event.pathParameters?.id;

  if (!incidentId) {
    throw new BadRequestError('Incident ID is required');
  }

  const existing = await incidentRepo.getById(tenantId, incidentId);
  if (!existing) {
    throw new NotFoundError(`Incident ${incidentId} not found`);
  }

  const links = await linkRepo.getLinks(tenantId, incidentId);

  // Hydrate related incident metadata
  const items = await Promise.all(
    links.map(async (link) => {
      const relatedId =
        link.parentIncidentId === incidentId ? link.childIncidentId : link.parentIncidentId;
      const relatedIncident = await incidentRepo.getById(tenantId, relatedId);

      return {
        linkType: link.linkType,
        similarityScore: link.similarityScore ?? 0,
        reason: link.reason || 'Related incident link',
        linkedBy: link.linkedBy,
        createdAt: link.createdAt,
        relatedIncidentId: relatedId,
        incident: relatedIncident
          ? {
              id: relatedIncident.id,
              title: relatedIncident.title,
              description: relatedIncident.description,
              status: relatedIncident.status,
              category: relatedIncident.category,
              severity: relatedIncident.severity,
              priorityScore: relatedIncident.priorityScore,
              assetId: relatedIncident.assetId,
              locationId: relatedIncident.locationId,
              createdAt: relatedIncident.createdAt,
            }
          : null,
      };
    }),
  );

  // Filter out nulls and ensure sorted descending by similarity score
  items.sort((a, b) => b.similarityScore - a.similarityScore);

  return apiSuccess({
    incidentId,
    total: items.length,
    items,
  });
}
