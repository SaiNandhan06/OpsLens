import path from 'node:path';
import { createRequire } from 'node:module';

const req = createRequire(path.resolve('services/api-incidents/package.json'));
const { ulid } = req('ulid');
import {
  cosineSimilarity,
  rankCandidates,
  type CandidateIncident,
  type CandidateTarget,
} from '../packages/core/src/index.js';
import {
  IncidentRepository,
  TimelineRepository,
  AttachmentRepository,
  LinkRepository,
  MetricsRepository,
} from '../packages/data/src/index.js';
import { runTriagePipeline } from '../services/worker-triage/src/triage-pipeline.js';
import { handleGetRelatedIncidents } from '../services/api-incidents/src/related-incidents.js';
import { handleMergeIncident } from '../services/api-incidents/src/merge-incident.js';
import { MockLLMProvider } from '../packages/ai/src/index.js';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { HandlerContext } from '../packages/platform/src/index.js';
import type { Incident, IncidentAttachment } from '@opslens/contracts';

interface CheckResult {
  id: number;
  title: string;
  status: 'PASS' | 'FAIL';
  details: string[];
}

const results: CheckResult[] = [];

function createMockEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    body: null,
    headers: { 'x-correlation-id': 'corr-verify-dedupe-1' },
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/v1/incidents',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      accountId: '123456789012',
      apiId: 'mock-api',
      authorizer: {
        tenantId: 'north-hub',
        userId: 'usr-supervisor-01',
        role: 'supervisor',
        email: 'supervisor@warehouse.local',
      },
      httpMethod: 'GET',
      identity: {} as any,
      path: '/v1/incidents',
      protocol: 'HTTP/1.1',
      requestId: 'req-verify-dedupe',
      requestTimeEpoch: Date.now(),
      resourceId: '123456',
      resourcePath: '/v1/incidents',
      stage: 'local',
    },
    resource: '/v1/incidents',
    ...overrides,
  };
}

async function runVerification() {
  console.log('================================================================');
  console.log(' OPSLENS DUPLICATE & RELATED DETECTION VERIFICATION (Task B11)');
  console.log('================================================================\n');

  const tenantId = 'north-hub';
  const incidentRepo = new IncidentRepository();
  const timelineRepo = new TimelineRepository();
  const attachmentRepo = new AttachmentRepository();
  const linkRepo = new LinkRepository();
  const metricsRepo = new MetricsRepository();
  const mockAi = new MockLLMProvider();

  // ---------------------------------------------------------------------------
  // Check 1: Pure similarity math & candidate ranker in packages/core/src/similarity
  // ---------------------------------------------------------------------------
  {
    console.log('--- Running Check 1: Pure cosine similarity & ranking math ---');
    const details: string[] = [];
    try {
      const v1 = [1, 0, 0];
      const v2 = [1, 0, 0];
      const v3 = [0, 1, 0];
      const v4 = [-1, 0, 0];

      const simIdentical = cosineSimilarity(v1, v2);
      const simOrthogonal = cosineSimilarity(v1, v3);
      const simOpposite = cosineSimilarity(v1, v4);

      details.push(`cosineSimilarity(v1, v1) = ${simIdentical.toFixed(4)} (Expected: 1.0000)`);
      details.push(`cosineSimilarity(v1, v_orth) = ${simOrthogonal.toFixed(4)} (Expected: 0.0000)`);
      details.push(`cosineSimilarity(v1, v_opp) = ${simOpposite.toFixed(4)} (Expected: -1.0000)`);

      if (Math.abs(simIdentical - 1.0) > 0.001 || Math.abs(simOrthogonal) > 0.001 || Math.abs(simOpposite - (-1.0)) > 0.001) {
        throw new Error('Cosine similarity calculation does not match mathematical definition');
      }

      // Test rankCandidates with realistic target and candidates
      const target: CandidateTarget = {
        id: 'inc-target',
        assetId: 'CONV-D4',
        locationId: 'LOC-DOCK-4',
        embedding: [0.8, 0.6, 0.0],
      };

      const candidates: CandidateIncident[] = [
        {
          id: 'inc-target', // self candidate should be filtered out
          assetId: 'CONV-D4',
          locationId: 'LOC-DOCK-4',
          status: 'OPEN',
          createdAt: '2026-03-01T00:00:00Z',
          embedding: [0.8, 0.6, 0.0],
        },
        {
          id: 'inc-dup-1',
          assetId: 'CONV-D4',
          locationId: 'LOC-DOCK-4',
          status: 'IN_PROGRESS',
          createdAt: '2026-02-28T10:00:00Z',
          embedding: [0.79, 0.61, 0.0], // > 0.99 similarity, same asset, open
        },
        {
          id: 'inc-rel-1',
          assetId: 'CONV-D4',
          locationId: 'LOC-DOCK-4',
          status: 'RESOLVED',
          createdAt: '2026-02-20T10:00:00Z',
          embedding: [0.55, 0.83, 0.0], // ~0.93 similarity, but RESOLVED -> RELATED
        },
        {
          id: 'inc-unrelated',
          assetId: 'FORK-02',
          locationId: 'LOC-AISLE-12',
          status: 'OPEN',
          createdAt: '2026-02-25T10:00:00Z',
          embedding: [0.0, 0.0, 1.0], // 0.0 similarity -> IGNORE
        },
      ];

      const ranked = rankCandidates(target, candidates);
      details.push(`Ranked results count: ${ranked.length} (excluded self and unrelated)`);
      for (const r of ranked) {
        details.push(`  Candidate ${r.candidate.id}: sim=${r.similarity.toFixed(4)}, class=${r.classification}, reason="${r.reason}"`);
      }

      const dupMatch = ranked.find((r) => r.candidate.id === 'inc-dup-1');
      const relMatch = ranked.find((r) => r.candidate.id === 'inc-rel-1');
      const selfMatch = ranked.find((r) => r.candidate.id === 'inc-target');

      if (!dupMatch || dupMatch.classification !== 'DUPLICATE_CANDIDATE') {
        throw new Error('Expected inc-dup-1 to be classified as DUPLICATE_CANDIDATE');
      }
      if (!relMatch || relMatch.classification !== 'RELATED') {
        throw new Error('Expected inc-rel-1 to be classified as RELATED');
      }
      if (selfMatch) {
        throw new Error('Candidate target itself was not filtered out');
      }

      results.push({ id: 1, title: 'Pure Cosine Similarity & Ranker Math', status: 'PASS', details });
      console.log('Check 1 PASS\n');
    } catch (err: any) {
      details.push(`Error: ${err.message}`);
      results.push({ id: 1, title: 'Pure Cosine Similarity & Ranker Math', status: 'FAIL', details });
      console.error('Check 1 FAIL:', err.message, '\n');
    }
  }

  // ---------------------------------------------------------------------------
  // Check 2: Triage Pipeline Deduplication & Linking (NEVER auto-close / auto-merge)
  // ---------------------------------------------------------------------------
  let parentIncidentId = '';
  let childIncidentId = '';
  {
    console.log('--- Running Check 2: Triage Pipeline Deduplication & Linking ---');
    const details: string[] = [];
    try {
      // 1. Seed canonical parent incident directly
      parentIncidentId = ulid();
      const parentDesc = 'Conveyor belt stopped at Dock 4 CONV-D4 with smoke observed near primary motor';
      const parentEmbed = await mockAi.embed(`Dock 4 conveyor motor stoppage. ${parentDesc} CONV-D4`);
      const parentIncident: Incident = {
        id: parentIncidentId,
        tenantId,
        title: 'Dock 4 conveyor belt jammed and motor tripped',
        description: parentDesc,
        status: 'OPEN',
        category: 'EQUIPMENT',
        severity: 'HIGH',
        priorityScore: 85,
        assetId: 'CONV-D4',
        locationId: 'LOC-DOCK-4',
        reporterId: 'usr-worker-01',
        embedding: parentEmbed.vector,
        createdAt: new Date(Date.now() - 3600000).toISOString(),
        updatedAt: new Date(Date.now() - 3600000).toISOString(),
      };
      await incidentRepo.create(tenantId, parentIncident);
      details.push(`Seeded canonical parent incident ${parentIncidentId} on asset CONV-D4 with 256-dim embedding`);

      // 2. Create child incident that describes the same issue (duplicate submission)
      childIncidentId = ulid();
      const childInitial: Incident = {
        id: childIncidentId,
        tenantId,
        title: 'Dock 4 conveyor motor stopped with smoke',
        description: 'Conveyor belt stopped at Dock 4 CONV-D4 with smoke observed near primary motor and belt stopped',
        status: 'NEW',
        category: 'EQUIPMENT',
        severity: 'HIGH',
        priorityScore: 0,
        assetId: 'CONV-D4',
        locationId: 'LOC-DOCK-4',
        reporterId: 'usr-worker-02',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await incidentRepo.create(tenantId, childInitial);

      // 3. Run child incident through worker-triage pipeline
      const triagedResult = await runTriagePipeline(
        {
          tenantId,
          incidentId: childIncidentId,
          correlationId: ulid(),
        },
        {
          incidentRepo,
          timelineRepo,
          linkRepo,
        },
        {
          provider: mockAi,
        },
      );

      details.push(`Triage pipeline executed with triageMode: ${triagedResult.triageMode}`);

      // Verify child incident in DynamoDB
      const triagedChild = await incidentRepo.getById(tenantId, childIncidentId);
      if (!triagedChild) throw new Error('Child incident not found after triage');

      details.push(`Triaged status: ${triagedChild.status} (CRITICAL: must NOT be MERGED or CLOSED)`);
      if (triagedChild.status === 'MERGED' || triagedChild.status === 'CLOSED') {
        throw new Error(`CRITICAL VIOLATION: Incident was auto-merged or auto-closed (status: ${triagedChild.status})`);
      }

      // Check embedding persisted
      const hasEmbedding = Array.isArray(triagedChild.embedding) && triagedChild.embedding.length === 256;
      details.push(`256-dim embedding persisted on incident: ${hasEmbedding} (dims: ${triagedChild.embedding?.length})`);
      if (!hasEmbedding) throw new Error('256-dimensional embedding was not persisted on the incident');

      // Check duplicate candidate metadata flag
      const hasDuplicateFlag = triagedChild.metadata?.hasDuplicateCandidate === true;
      details.push(`metadata.hasDuplicateCandidate flag set: ${hasDuplicateFlag}`);
      if (!hasDuplicateFlag) throw new Error('metadata.hasDuplicateCandidate flag was not set');

      // Verify link item in DynamoDB
      const links = await linkRepo.getLinks(tenantId, childIncidentId);
      details.push(`Links found for child incident: ${links.length}`);
      const dupLink = links.find((l) => l.linkType === 'DUPLICATE_CANDIDATE');
      if (!dupLink) throw new Error('No DUPLICATE_CANDIDATE link item was created in DynamoDB');

      details.push(`  Link: type=${dupLink.linkType}, similarity=${dupLink.similarityScore}, reason="${dupLink.reason}"`);
      if ((dupLink.similarityScore ?? 0) < 0.85) {
        throw new Error(`Duplicate candidate similarity score (${dupLink.similarityScore}) is below threshold 0.85`);
      }

      results.push({ id: 2, title: 'Triage Pipeline Deduplication & Linking', status: 'PASS', details });
      console.log('Check 2 PASS\n');
    } catch (err: any) {
      details.push(`Error: ${err.message}`);
      results.push({ id: 2, title: 'Triage Pipeline Deduplication & Linking', status: 'FAIL', details });
      console.error('Check 2 FAIL:', err.message, '\n');
    }
  }

  // ---------------------------------------------------------------------------
  // Check 3: GET /v1/incidents/{id}/related endpoint
  // ---------------------------------------------------------------------------
  {
    console.log('--- Running Check 3: GET /v1/incidents/{id}/related endpoint ---');
    const details: string[] = [];
    try {
      const event = createMockEvent({
        httpMethod: 'GET',
        path: `/v1/incidents/${childIncidentId}/related`,
        pathParameters: { id: childIncidentId },
      });

      const context: HandlerContext = {
        correlationId: 'corr-rel-1',
        authContext: {
          tenantId,
          userId: 'usr-supervisor-01',
          role: 'supervisor',
          email: 'supervisor@warehouse.local',
        },
      };

      const response = await handleGetRelatedIncidents(event, context, linkRepo, incidentRepo);
      details.push(`HTTP Status: ${response.statusCode}`);
      if (response.statusCode !== 200) {
        throw new Error(`Expected HTTP 200 from related incidents endpoint, got ${response.statusCode}`);
      }

      const body = JSON.parse(response.body);
      details.push(`Total related links returned: ${body.total}`);
      details.push(`Items length: ${body.items?.length}`);

      if (!body.items || body.items.length === 0) {
        throw new Error('No related items returned in response');
      }

      const firstItem = body.items[0];
      details.push(`Item 0: linkType=${firstItem.linkType}, similarityScore=${firstItem.similarityScore}, relatedIncidentId=${firstItem.relatedIncidentId}`);
      details.push(`Hydrated incident details: title="${firstItem.incident?.title}", status=${firstItem.incident?.status}`);

      if (!firstItem.incident?.id) {
        throw new Error('Related incident details were not hydrated');
      }

      results.push({ id: 3, title: 'Related Incidents Listing API', status: 'PASS', details });
      console.log('Check 3 PASS\n');
    } catch (err: any) {
      details.push(`Error: ${err.message}`);
      results.push({ id: 3, title: 'Related Incidents Listing API', status: 'FAIL', details });
      console.error('Check 3 FAIL:', err.message, '\n');
    }
  }

  // ---------------------------------------------------------------------------
  // Check 4: Authorization and 409 Conflict validation for merge
  // ---------------------------------------------------------------------------
  {
    console.log('--- Running Check 4: Authorization & 409 Conflict Validation ---');
    const details: string[] = [];
    try {
      // 1. Worker attempt -> 403 Forbidden
      let workerForbidden = false;
      try {
        const workerEvent = createMockEvent({
          httpMethod: 'POST',
          path: `/v1/incidents/${childIncidentId}/merge`,
          pathParameters: { id: childIncidentId },
          body: JSON.stringify({ parentIncidentId }),
        });
        const workerContext: HandlerContext = {
          correlationId: 'corr-merge-worker',
          authContext: {
            tenantId,
            userId: 'usr-worker-01',
            role: 'worker',
            email: 'worker@warehouse.local',
          },
        };
        await handleMergeIncident(workerEvent, workerContext, incidentRepo, timelineRepo, attachmentRepo, metricsRepo, linkRepo);
      } catch (err: any) {
        if (err.statusCode === 403) {
          workerForbidden = true;
          details.push(`Worker merge attempt rejected: HTTP 403 (${err.message})`);
        } else {
          details.push(`Unexpected error from worker attempt: ${err.message}`);
        }
      }
      if (!workerForbidden) throw new Error('Worker was able to perform merge; expected 403 Forbidden');

      // 2. Self-merge -> 409 Conflict
      let selfMergeConflict = false;
      try {
        const selfEvent = createMockEvent({
          httpMethod: 'POST',
          path: `/v1/incidents/${childIncidentId}/merge`,
          pathParameters: { id: childIncidentId },
          body: JSON.stringify({ parentIncidentId: childIncidentId }),
        });
        const supervisorContext: HandlerContext = {
          correlationId: 'corr-merge-self',
          authContext: {
            tenantId,
            userId: 'usr-supervisor-01',
            role: 'supervisor',
            email: 'supervisor@warehouse.local',
          },
        };
        await handleMergeIncident(selfEvent, supervisorContext, incidentRepo, timelineRepo, attachmentRepo, metricsRepo, linkRepo);
      } catch (err: any) {
        if (err.statusCode === 409) {
          selfMergeConflict = true;
          details.push(`Self-merge attempt rejected: HTTP 409 (${err.message})`);
        } else {
          details.push(`Unexpected error from self-merge attempt: ${err.message}`);
        }
      }
      if (!selfMergeConflict) throw new Error('Self-merge did not return 409 Conflict');

      results.push({ id: 4, title: 'Authorization & 409 Conflict Validation', status: 'PASS', details });
      console.log('Check 4 PASS\n');
    } catch (err: any) {
      details.push(`Error: ${err.message}`);
      results.push({ id: 4, title: 'Authorization & 409 Conflict Validation', status: 'FAIL', details });
      console.error('Check 4 FAIL:', err.message, '\n');
    }
  }

  // ---------------------------------------------------------------------------
  // Check 5: POST /v1/incidents/{id}/merge execution & GSI3 SLA Purge & Metric Increment
  // ---------------------------------------------------------------------------
  {
    console.log('--- Running Check 5: Merge Execution, SLA Purge & Metrics Counter ---');
    const details: string[] = [];
    try {
      // 1. Attach a test attachment to child incident
      const testAttachmentId = ulid();
      const testAttachment: IncidentAttachment = {
        id: testAttachmentId,
        incidentId: childIncidentId,
        tenantId,
        fileName: 'conveyor_belt_jam.jpg',
        contentType: 'image/jpeg',
        s3Key: `tenants/${tenantId}/incidents/${childIncidentId}/${testAttachmentId}.jpg`,
        sizeBytes: 24500,
        uploadedBy: 'usr-worker-02',
        createdAt: new Date().toISOString(),
      };
      await attachmentRepo.createAttachment(tenantId, testAttachment);
      details.push(`Created test attachment ${testAttachmentId} on child incident ${childIncidentId}`);

      // 2. Perform merge as supervisor
      const supervisorContext: HandlerContext = {
        correlationId: 'corr-merge-exec',
        authContext: {
          tenantId,
          userId: 'usr-supervisor-01',
          role: 'supervisor',
          email: 'supervisor@warehouse.local',
        },
      };

      const mergeEvent = createMockEvent({
        httpMethod: 'POST',
        path: `/v1/incidents/${childIncidentId}/merge`,
        pathParameters: { id: childIncidentId },
        body: JSON.stringify({
          parentIncidentId,
          reason: 'Duplicate report of Dock 4 conveyor stoppage',
        }),
      });

      const response = await handleMergeIncident(
        mergeEvent,
        supervisorContext,
        incidentRepo,
        timelineRepo,
        attachmentRepo,
        metricsRepo,
        linkRepo,
      );

      details.push(`Merge API HTTP Status: ${response.statusCode}`);
      if (response.statusCode !== 200) {
        throw new Error(`Expected HTTP 200 from merge endpoint, got ${response.statusCode}`);
      }

      const body = JSON.parse(response.body);
      details.push(`Transferred attachments reported: ${body.transferredAttachments}`);
      details.push(`Child status in response: ${body.childIncident.status}`);

      // 3. Verify child status is MERGED and metadata has parent reference
      const updatedChild = await incidentRepo.getById(tenantId, childIncidentId);
      if (!updatedChild) throw new Error('Could not fetch child incident');
      details.push(`Child incident status in DB: ${updatedChild.status}`);
      details.push(`Child metadata.mergedIntoIncidentId: ${updatedChild.metadata?.mergedIntoIncidentId}`);
      if (updatedChild.status !== 'MERGED') {
        throw new Error(`Expected child status MERGED, got ${updatedChild.status}`);
      }
      if (updatedChild.metadata?.mergedIntoIncidentId !== parentIncidentId) {
        throw new Error('Child metadata does not contain parent incident ID reference');
      }

      // 4. Verify GSI3 sparse SLA attributes are purged from DynamoDB
      const childRaw = updatedChild as any;
      const gsi3Purged = !childRaw.gsi3pk && !childRaw.gsi3sk && !childRaw.slaActive && !childRaw.earliestDueAt;
      details.push(`GSI3 sparse SLA attributes purged from DynamoDB: ${gsi3Purged} (gsi3pk=${childRaw.gsi3pk})`);
      if (!gsi3Purged) {
        throw new Error('GSI3 sparse SLA attributes were not purged upon merge!');
      }

      // 5. Verify attachments transferred to parent
      const parentAttachments = await attachmentRepo.listAttachments(tenantId, parentIncidentId);
      details.push(`Parent incident attachments count: ${parentAttachments.length}`);
      const transferred = parentAttachments.find((a) => a.fileName === 'conveyor_belt_jam.jpg');
      if (!transferred) {
        throw new Error('Child attachment was not transferred to parent incident');
      }
      details.push(`  Transferred attachment: id=${transferred.id}, file=${transferred.fileName}`);

      // 6. Verify timeline events
      const parentTimeline = await timelineRepo.listEvents(tenantId, parentIncidentId);
      const parentMergeEvent = parentTimeline.items.find((e) => (e.data as any)?.action === 'MERGED_CHILD');
      details.push(`Parent timeline contains MERGED_CHILD event: ${Boolean(parentMergeEvent)}`);
      if (!parentMergeEvent) {
        throw new Error('Parent timeline missing MERGED_CHILD audit event');
      }
      details.push(`  Parent timeline recorded child description: "${(parentMergeEvent.data as any)?.childDescription?.slice(0, 50)}..."`);

      const childTimeline = await timelineRepo.listEvents(tenantId, childIncidentId);
      const childMergeEvent = childTimeline.items.find((e) => (e.data as any)?.action === 'MERGED_INTO_PARENT');
      details.push(`Child timeline contains MERGED_INTO_PARENT event: ${Boolean(childMergeEvent)}`);
      if (!childMergeEvent) {
        throw new Error('Child timeline missing MERGED_INTO_PARENT audit event');
      }

      // 7. Verify daily duplicate metric counter in DynamoDB
      const today = new Date().toISOString().slice(0, 10);
      const dailyMetrics = await metricsRepo.getDailyMetrics(tenantId, today);
      details.push(`Daily metrics for ${today}: duplicates = ${dailyMetrics?.duplicates}`);
      if (!dailyMetrics || (dailyMetrics.duplicates ?? 0) < 1) {
        throw new Error(`Daily duplicate metric was not incremented! Value: ${dailyMetrics?.duplicates}`);
      }

      // 8. Verify already-merged child cannot be merged again (409 Conflict)
      let alreadyMergedConflict = false;
      try {
        await handleMergeIncident(mergeEvent, supervisorContext, incidentRepo, timelineRepo, attachmentRepo, metricsRepo, linkRepo);
      } catch (err: any) {
        if (err.statusCode === 409) {
          alreadyMergedConflict = true;
          details.push(`Second merge attempt on already-merged child rejected: HTTP 409 (${err.message})`);
        }
      }
      if (!alreadyMergedConflict) {
        throw new Error('Subsequent merge on already-merged incident did not return 409 Conflict');
      }

      results.push({ id: 5, title: 'Merge Execution, SLA Purge & Metrics Counter', status: 'PASS', details });
      console.log('Check 5 PASS\n');
    } catch (err: any) {
      details.push(`Error: ${err.message}`);
      results.push({ id: 5, title: 'Merge Execution, SLA Purge & Metrics Counter', status: 'FAIL', details });
      console.error('Check 5 FAIL:', err.message, '\n');
    }
  }

  // ---------------------------------------------------------------------------
  // Summary Table
  // ---------------------------------------------------------------------------
  console.log('================================================================');
  console.log(' VERIFICATION SUMMARY');
  console.log('================================================================');
  for (const r of results) {
    console.log(`[${r.status}] Check ${r.id}: ${r.title}`);
    for (const d of r.details) {
      console.log(`       ${d}`);
    }
  }

  const allPassed = results.every((r) => r.status === 'PASS');
  console.log('\nFinal Verdict:', allPassed ? 'ALL CHECKS PASSED (PASS)' : 'ONE OR MORE CHECKS FAILED (FAIL)');
  if (!allPassed) {
    process.exit(1);
  }
}

runVerification().catch((err) => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
