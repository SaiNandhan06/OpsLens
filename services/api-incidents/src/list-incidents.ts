import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  Incident,
  ListIncidentsQuerySchema,
} from '@opslens/contracts';
import { IncidentRepository } from '@opslens/data';
import {
  ApiResponse,
  apiSuccess,
  ValidationError,
  HandlerContext,
} from '@opslens/platform';

export async function handleListIncidents(
  event: APIGatewayProxyEvent,
  context: HandlerContext,
  repos: { incidentRepo?: IncidentRepository } = {},
): Promise<ApiResponse> {
  const { authContext } = context;
  const { tenantId } = authContext;

  const incidentRepo = repos.incidentRepo || new IncidentRepository();

  // 1. Parse and validate query parameters
  const rawQuery = event.queryStringParameters || {};
  const queryResult = ListIncidentsQuerySchema.safeParse(rawQuery);
  if (!queryResult.success) {
    throw new ValidationError(
      'Invalid query parameters for ListIncidents',
      queryResult.error.issues,
    );
  }

  const query = queryResult.data;

  // 2. Enforce hard cap: max 50 items per page
  const limit = Math.min(50, Math.max(1, query.limit ?? 25));
  const cursor = query.cursor;

  // 3. Index routing:
  // - GSI4: Worker querying own submissions if reporterId matches or specified
  // - GSI1: Status-scoped priority-sorted queue listing (descending priority)
  let items: Incident[];
  let nextCursor: string | null = null;

  const isQueryingOwn =
    Boolean(query.reporterId) ||
    rawQuery['my'] === 'true' ||
    (authContext.role === 'worker' && !query.status);

  if (isQueryingOwn) {
    const targetReporterId = query.reporterId || authContext.userId;
    const result = await incidentRepo.queryByReporter(tenantId, targetReporterId, {
      limit,
      cursor,
    });
    items = result.items;
    nextCursor = result.nextCursor;
  } else if (query.status === 'OPEN') {
    const openStatuses: Array<'NEW' | 'ACKNOWLEDGED' | 'ROUTED' | 'IN_PROGRESS' | 'NEEDS_INFO' | 'TRIAGING'> = [
      'NEW',
      'ROUTED',
      'ACKNOWLEDGED',
      'IN_PROGRESS',
      'NEEDS_INFO',
      'TRIAGING',
    ];
    const results = await Promise.all(
      openStatuses.map((s) => incidentRepo.queryQueue(tenantId, s, { limit })),
    );
    const combined = results.flatMap((r) => r.items);
    combined.sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
    items = combined.slice(0, limit);
    nextCursor = null;
  } else {
    // Default queue status is 'NEW' if not specified
    const status = query.status || 'NEW';
    const result = await incidentRepo.queryQueue(tenantId, status, {
      limit,
      cursor,
    });
    items = result.items;
    nextCursor = result.nextCursor;
  }

  // 4. Apply in-memory secondary filters if requested
  if (query.category) {
    items = items.filter((i) => i.category === query.category);
  }
  if (query.severity) {
    items = items.filter((i) => i.severity === query.severity);
  }
  if (query.assignedTeamId) {
    items = items.filter((i) => i.assignedTeamId === query.assignedTeamId);
  }
  if (query.assetId) {
    items = items.filter((i) => i.assetId === query.assetId);
  }

  return apiSuccess({
    items,
    nextCursor,
  });
}
