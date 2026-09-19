import type { APIGatewayProxyEvent } from 'aws-lambda';
import { createApiHandler, BadRequestError, ApiResponse } from '@opslens/platform';
import { handleCreateIncident } from './create-incident.js';
import { handleListIncidents } from './list-incidents.js';
import { handleGetIncident } from './get-incident.js';
import { handleAnswerClarification } from './answer-clarification.js';
import { handleGetRelatedIncidents } from './related-incidents.js';
import { handleMergeIncident } from './merge-incident.js';

import { handleUpdateIncident } from './update-incident.js';

export {
  moveStagingAttachment,
  generatePresignedGetUrl,
  createS3Client,
  getS3Client,
  getMediaBucket,
} from './s3.js';
export {
  publishIncidentCreatedEvent,
  createEventBridgeClient,
  getEventBridgeClient,
  getEventBusName,
} from './eventbridge.js';
export * from './create-incident.js';
export * from './list-incidents.js';
export * from './get-incident.js';
export * from './update-incident.js';
export * from './answer-clarification.js';
export * from './related-incidents.js';
export * from './merge-incident.js';

/**
 * Main Lambda handler for the OpsLens Incidents API.
 * Uses shared createApiHandler wrapper for error translation, correlation IDs, and structured logging.
 */
export const handler = createApiHandler(
  async (event: APIGatewayProxyEvent, context): Promise<ApiResponse> => {
    const method = event.httpMethod.toUpperCase();
    const rawPath = event.path.split('?')[0]!.replace(/\/+$/, '') || '/';
    const cleanPath = rawPath.startsWith('/v1') ? rawPath.slice(3) || '/' : rawPath;

    // POST /v1/incidents or /incidents
    if (method === 'POST' && cleanPath === '/incidents') {
      return handleCreateIncident(event, context);
    }

    // GET /v1/incidents or /incidents
    if (method === 'GET' && cleanPath === '/incidents') {
      return handleListIncidents(event, context);
    }

    // POST /v1/incidents/{id}/answer or /incidents/{id}/answer
    if (method === 'POST' && (/\/incidents\/[^/]+\/answer$/.test(cleanPath))) {
      const parts = cleanPath.split('/');
      event.pathParameters = { ...event.pathParameters, id: parts[2] };
      return handleAnswerClarification(event, context);
    }

    // GET /v1/incidents/{id}/related or /incidents/{id}/related
    if (method === 'GET' && (/\/incidents\/[^/]+\/related$/.test(cleanPath))) {
      const parts = cleanPath.split('/');
      event.pathParameters = { ...event.pathParameters, id: parts[2] };
      return handleGetRelatedIncidents(event, context);
    }

    // POST /v1/incidents/{id}/merge or /incidents/{id}/merge
    if (method === 'POST' && (/\/incidents\/[^/]+\/merge$/.test(cleanPath))) {
      const parts = cleanPath.split('/');
      event.pathParameters = { ...event.pathParameters, id: parts[2] };
      return handleMergeIncident(event, context);
    }

    // PATCH /v1/incidents/{id} or /incidents/{id} (or priority override)
    if (method === 'PATCH' && (Boolean(event.pathParameters?.id) || /^\/incidents\/[^/]+$/.test(cleanPath))) {
      if (!event.pathParameters?.id) {
        const parts = cleanPath.split('/');
        event.pathParameters = { ...event.pathParameters, id: parts[2] };
      }
      return handleUpdateIncident(event, context);
    }

    // GET /v1/incidents/{id} or /incidents/{id}
    if (method === 'GET' && (Boolean(event.pathParameters?.id) || /^\/incidents\/[^/]+$/.test(cleanPath))) {
      // Ensure pathParameters has id if parsed from cleanPath
      if (!event.pathParameters?.id) {
        const parts = cleanPath.split('/');
        event.pathParameters = { ...event.pathParameters, id: parts[2] };
      }
      return handleGetIncident(event, context);
    }

    throw new BadRequestError(`Unsupported route: ${method} ${event.path}`);
  },
);
