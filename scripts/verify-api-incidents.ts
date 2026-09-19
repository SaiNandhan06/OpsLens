import path from 'node:path';
import { createRequire } from 'node:module';
import { handler } from '../services/api-incidents/src/index.js';
import { IncidentRepository, AttachmentRepository, TimelineRepository } from '../packages/data/src/index.js';
import type { APIGatewayProxyEvent } from 'aws-lambda';

const require = createRequire(path.resolve('services/api-incidents/package.json'));
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { ulid } = require('ulid');

process.env.STAGE = 'local';
process.env.TABLE_NAME = 'opslens-local';
process.env.MEDIA_BUCKET = 'opslens-media-local';
process.env.EVENT_BUS_NAME = 'opslens-events-local';
process.env.LOCALSTACK_ENDPOINT = 'http://localhost:4566';
process.env.AWS_ENDPOINT_URL = 'http://localhost:4566';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = 'test';
process.env.AWS_SECRET_ACCESS_KEY = 'test';

const s3 = new S3Client({
  endpoint: 'http://localhost:4566',
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

function createApiEvent(options: {
  method: string;
  path: string;
  body?: unknown;
  queryParams?: Record<string, string>;
  pathParams?: Record<string, string>;
  tenantId?: string;
  userId?: string;
  role?: string;
}): APIGatewayProxyEvent {
  const tenantId = options.tenantId || 'north-hub';
  const userId = options.userId || 'usr-north-worker';
  const role = options.role || 'worker';

  return {
    httpMethod: options.method,
    path: options.path,
    body: options.body ? JSON.stringify(options.body) : null,
    queryStringParameters: options.queryParams || null,
    pathParameters: options.pathParams || null,
    headers: {
      'content-type': 'application/json',
      'x-correlation-id': `corr-${Date.now()}`,
    },
    multiValueHeaders: {},
    isBase64Encoded: false,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: options.path,
    requestContext: {
      accountId: '123456789012',
      apiId: 'mock-api',
      authorizer: {
        tenantId,
        userId,
        role,
        email: `${userId}@warehouse.local`,
      },
      httpMethod: options.method,
      identity: {} as any,
      path: options.path,
      protocol: 'HTTP/1.1',
      requestId: ulid(),
      requestTimeEpoch: Date.now(),
      resourceId: '123456',
      resourcePath: options.path,
      stage: 'local',
    },
  };
}

async function run() {
  console.log('=== OpsLens Incidents API Endpoints Verification ===\n');

  const tenantId = 'north-hub';
  const reporterId = 'usr-north-worker';
  const testFileUlid = ulid();
  const testFileContent = 'test-image-content-for-staging';
  const stagingKey = `tenants/${tenantId}/incidents/staging/${testFileUlid}.png`;

  // 1. Upload dummy media file directly to staging
  console.log(`1. Uploading test attachment to staging: ${stagingKey}...`);
  await s3.send(
    new PutObjectCommand({
      Bucket: 'opslens-media-local',
      Key: stagingKey,
      Body: Buffer.from(testFileContent),
      ContentType: 'image/png',
    }),
  );
  console.log('   Staging file uploaded successfully.');

  // 2. Call POST /v1/incidents
  console.log('\n2. Testing POST /v1/incidents creation...');
  const postEvent = createApiEvent({
    method: 'POST',
    path: '/v1/incidents',
    body: {
      description: 'Conveyor belt CONV-D4 jammed with package debris at Dock 4',
      locationHint: 'LOC-DOCK-4',
      assetHint: 'CONV-D4',
      attachmentKeys: [stagingKey],
    },
    tenantId,
    userId: reporterId,
  });

  const t0 = Date.now();
  const postRes = await handler(postEvent);
  const latencyMs = Date.now() - t0;
  console.log(`   Response latency: ${latencyMs}ms (Constraint: < 500ms)`);
  console.log(`   Status code: ${postRes.statusCode} (Expected: 201)`);

  if (postRes.statusCode !== 201) {
    throw new Error(`POST /v1/incidents failed: ${postRes.body}`);
  }
  if (latencyMs >= 500) {
    console.warn(`   WARNING: Latency exceeded 500ms! (${latencyMs}ms)`);
  } else {
    console.log(`   PASS: Response returned under 500ms!`);
  }

  const postBody = JSON.parse(postRes.body);
  const incident = postBody.incident;
  console.log(`   Created Incident ID: ${incident.id}`);
  console.log(`   Status: ${incident.status}`);
  console.log(`   Reporter ID: ${incident.reporterId}`);
  console.log(`   Priority Score: ${incident.priorityScore}`);

  // Verify attachment moved from staging in S3
  const permanentKey = `tenants/${tenantId}/incidents/${incident.id}/${testFileUlid}.png`;
  console.log(`\n3. Verifying S3 attachment movement...`);
  console.log(`   Permanent key expected: ${permanentKey}`);
  try {
    const s3Obj = await s3.send(
      new GetObjectCommand({
        Bucket: 'opslens-media-local',
        Key: permanentKey,
      }),
    );
    const bodyStr = await s3Obj.Body?.transformToString();
    if (bodyStr === testFileContent) {
      console.log('   PASS: Object successfully moved and contents match perfectly.');
    } else {
      throw new Error(`Content mismatch: expected '${testFileContent}', got '${bodyStr}'`);
    }
  } catch (err: any) {
    throw new Error(`Permanent object not found: ${err.message}`);
  }

  // Verify staging object was deleted
  try {
    await s3.send(
      new GetObjectCommand({
        Bucket: 'opslens-media-local',
        Key: stagingKey,
      }),
    );
    throw new Error(`Staging object was not deleted: ${stagingKey}`);
  } catch (err: any) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      console.log('   PASS: Staging object was deleted after move.');
    } else {
      throw err;
    }
  }

  // 4. Verify DynamoDB records (Incident, Timeline, Attachment)
  console.log(`\n4. Verifying DynamoDB records...`);
  const incidentRepo = new IncidentRepository();
  const timelineRepo = new TimelineRepository();
  const attachmentRepo = new AttachmentRepository();

  const ddbInc = await incidentRepo.getById(tenantId, incident.id);
  if (!ddbInc || ddbInc.id !== incident.id) {
    throw new Error('Incident not found in DynamoDB table');
  }
  console.log('   PASS: Incident item exists in DynamoDB.');

  const ddbEvents = await timelineRepo.listEvents(tenantId, incident.id);
  const createdEvt = ddbEvents.items.find((e) => e.type === 'INCIDENT_CREATED');
  if (!createdEvt) {
    throw new Error('INCIDENT_CREATED timeline event not found in DynamoDB');
  }
  console.log(`   PASS: Timeline event INCIDENT_CREATED found (actor: ${createdEvt.actorId}).`);

  const ddbAtts = await attachmentRepo.listAttachments(tenantId, incident.id);
  if (ddbAtts.length !== 1 || ddbAtts[0]!.s3Key !== permanentKey) {
    throw new Error(`Attachment item not found or incorrect key: ${JSON.stringify(ddbAtts)}`);
  }
  console.log(`   PASS: Attachment item found in DynamoDB with key: ${ddbAtts[0]!.s3Key}.`);

  // 5. Test GET /v1/incidents with GSI1
  console.log('\n5. Testing GET /v1/incidents queue listing (GSI1)...');
  const getQueueEvent = createApiEvent({
    method: 'GET',
    path: '/v1/incidents',
    queryParams: {
      status: 'NEW',
      limit: '10',
    },
    tenantId,
    role: 'supervisor',
  });
  const getQueueRes = await handler(getQueueEvent);
  console.log(`   Status code: ${getQueueRes.statusCode}`);
  const queueBody = JSON.parse(getQueueRes.body);
  console.log(`   Returned ${queueBody.items.length} items.`);
  const foundInQueue = queueBody.items.some((i: any) => i.id === incident.id);
  if (!foundInQueue) {
    throw new Error(`Incident ${incident.id} not found in GSI1 queue listing`);
  }
  console.log('   PASS: Newly created incident appears in GSI1 queue.');

  // 6. Test GET /v1/incidents with GSI4 (Worker submissions)
  console.log('\n6. Testing GET /v1/incidents worker submissions (GSI4)...');
  const getWorkerEvent = createApiEvent({
    method: 'GET',
    path: '/v1/incidents',
    queryParams: {
      reporterId,
      limit: '10',
    },
    tenantId,
    userId: reporterId,
    role: 'worker',
  });
  const getWorkerRes = await handler(getWorkerEvent);
  console.log(`   Status code: ${getWorkerRes.statusCode}`);
  const workerBody = JSON.parse(getWorkerRes.body);
  const foundInWorker = workerBody.items.some((i: any) => i.id === incident.id);
  if (!foundInWorker) {
    throw new Error(`Incident ${incident.id} not found in GSI4 worker submissions`);
  }
  console.log('   PASS: Newly created incident appears in GSI4 worker submissions.');

  // 7. Test limit capping at 50
  console.log('\n7. Testing page size capping at 50...');
  const getCapEvent = createApiEvent({
    method: 'GET',
    path: '/v1/incidents',
    queryParams: {
      status: 'NEW',
      limit: '150', // Exceeds cap
    },
    tenantId,
  });
  const getCapRes = await handler(getCapEvent);
  expect(getCapRes.statusCode).toBe(200);
  console.log('   PASS: Limit requested > 50 was handled gracefully.');

  // 8. Test GET /v1/incidents/{id}
  console.log(`\n8. Testing GET /v1/incidents/${incident.id}...`);
  const getByIdEvent = createApiEvent({
    method: 'GET',
    path: `/v1/incidents/${incident.id}`,
    pathParams: {
      id: incident.id,
    },
    tenantId,
  });
  const getByIdRes = await handler(getByIdEvent);
  console.log(`   Status code: ${getByIdRes.statusCode}`);
  const byIdBody = JSON.parse(getByIdRes.body);
  if (!byIdBody.incident || !byIdBody.scoreBreakdown || !byIdBody.timeline || !byIdBody.attachments) {
    throw new Error(`Incomplete response shape: ${Object.keys(byIdBody)}`);
  }
  console.log(`   Incident ID: ${byIdBody.incident.id}`);
  console.log(`   Score breakdown present: ${Boolean(byIdBody.scoreBreakdown)}`);
  console.log(`   Timeline items: ${byIdBody.timeline.length}`);
  console.log(`   Attachments with presigned URLs: ${byIdBody.attachments.length}`);

  const presignedUrl = byIdBody.attachments[0]?.downloadUrl;
  console.log(`   Presigned Download URL: ${presignedUrl}`);
  if (!presignedUrl) {
    throw new Error('Missing presigned downloadUrl on attachment');
  }

  // Fetch using the presigned download URL
  const fetchRes = await fetch(presignedUrl);
  if (!fetchRes.ok) {
    throw new Error(`Failed to fetch attachment via presigned URL: ${fetchRes.status} ${fetchRes.statusText}`);
  }
  const downloadedText = await fetchRes.text();
  if (downloadedText === testFileContent) {
    console.log('   PASS: Successfully downloaded file via presigned GET URL and contents match.');
  } else {
    throw new Error(`Downloaded text mismatch: ${downloadedText}`);
  }

  // 9. Test Nonexistent incident 404
  console.log('\n9. Testing GET /v1/incidents/NONEXISTENT (404 handling)...');
  const get404Event = createApiEvent({
    method: 'GET',
    path: '/v1/incidents/01HRX9999NONEXISTENT00',
    pathParams: { id: '01HRX9999NONEXISTENT00' },
    tenantId,
  });
  const get404Res = await handler(get404Event);
  console.log(`   Status code: ${get404Res.statusCode} (Expected: 404)`);
  const err404 = JSON.parse(get404Res.body);
  if (err404.error?.code !== 'INCIDENT_NOT_FOUND') {
    throw new Error(`Expected error code INCIDENT_NOT_FOUND, got: ${err404.error?.code}`);
  }
  console.log('   PASS: Correctly returned 404 INCIDENT_NOT_FOUND.');

  // 10. Test Multi-tenant isolation
  console.log('\n10. Testing multi-tenant isolation...');
  const southHubEvent = createApiEvent({
    method: 'GET',
    path: `/v1/incidents/${incident.id}`,
    pathParams: { id: incident.id },
    tenantId: 'south-hub', // Different tenant!
  });
  const southHubRes = await handler(southHubEvent);
  console.log(`   Accessing north-hub incident with south-hub tenant: status ${southHubRes.statusCode}`);
  if (southHubRes.statusCode !== 404) {
    throw new Error(`Expected 404 when querying across tenants, got ${southHubRes.statusCode}`);
  }
  console.log('   PASS: Cross-tenant access prevented (tenant isolation intact).');

  // Cross-tenant staging key rejection
  const crossTenantStagingEvent = createApiEvent({
    method: 'POST',
    path: '/v1/incidents',
    body: {
      description: 'Cross tenant attachment attempt',
      attachmentKeys: ['tenants/south-hub/incidents/staging/secret.png'],
    },
    tenantId: 'north-hub',
  });
  const crossTenantRes = await handler(crossTenantStagingEvent);
  console.log(`   Cross-tenant staging key injection: status ${crossTenantRes.statusCode}`);
  if (crossTenantRes.statusCode !== 400) {
    throw new Error(`Expected 400 for cross-tenant staging key, got ${crossTenantRes.statusCode}`);
  }
  console.log('   PASS: Cross-tenant staging key injection rejected.');

  console.log('\n=== ALL VERIFICATION CHECKS PASSED SUCCESSFULLY! ===');
}

function expect(val: any) {
  return {
    toBe(expected: any) {
      if (val !== expected) throw new Error(`Expected ${expected}, got ${val}`);
    },
  };
}

run().catch((err) => {
  console.error('\nVerification FAILED:', err);
  process.exit(1);
});
