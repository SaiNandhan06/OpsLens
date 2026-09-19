import type { APIGatewayProxyEvent } from 'aws-lambda';
import path from 'node:path';
import { createRequire } from 'node:module';

const req = createRequire(path.resolve('services/api-incidents/package.json'));
const dataReq = createRequire(path.resolve('packages/data/package.json'));
const { ulid } = req('ulid');
const { DeleteCommand } = dataReq('@aws-sdk/lib-dynamodb');
import {
  IncidentRepository,
  TimelineRepository,
  AttachmentRepository,
  BudgetRepository,
  ReferenceRepository,
  getDocClient,
  getTableName,
} from '../packages/data/src/index.js';
import { LlmSchemaError } from '../packages/ai/src/index.js';
import { handler as incidentsApiHandler } from '../services/api-incidents/src/index.js';
import { runTriagePipeline } from '../services/worker-triage/src/triage-pipeline.js';

interface VerificationCheckResult {
  id: number;
  title: string;
  status: 'PASS' | 'FAIL';
  details: string[];
}

function createApiEvent(
  method: string,
  path: string,
  body: unknown,
  authContext = {
    tenantId: 'north-hub',
    userId: 'usr-worker-test',
    role: 'worker',
    email: 'worker@north-hub.local',
  },
  pathParameters: Record<string, string> | null = null,
): APIGatewayProxyEvent {
  return {
    httpMethod: method,
    path,
    body: body ? JSON.stringify(body) : null,
    headers: {
      'content-type': 'application/json',
      'x-correlation-id': ulid(),
    },
    multiValueHeaders: {},
    isBase64Encoded: false,
    pathParameters,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      accountId: '123456789012',
      apiId: 'mock-api',
      authorizer: authContext,
      httpMethod: method,
      identity: {} as any,
      path,
      protocol: 'HTTP/1.1',
      requestId: ulid(),
      requestTimeEpoch: Date.now(),
      resourceId: 'res-id',
      resourcePath: path,
      stage: 'local',
    },
    resource: path,
  };
}

async function runVerification() {
  console.log('================================================================');
  console.log('  OPSLENS V9 VERIFICATION: WORKER-TRIAGE PIPELINE               ');
  console.log('================================================================\n');

  process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
  process.env.LOCALSTACK_ENDPOINT = process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566';
  process.env.TABLE_NAME = process.env.TABLE_NAME || 'opslens-local';
  process.env.EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'opslens-events-local';
  process.env.MEDIA_BUCKET = process.env.MEDIA_BUCKET || 'opslens-media-local';

  const tenantId = 'north-hub';
  const checks: VerificationCheckResult[] = [];
  const incidentRepo = new IncidentRepository();
  const timelineRepo = new TimelineRepository();
  const attachmentRepo = new AttachmentRepository();
  const budgetRepo = new BudgetRepository();
  const referenceRepo = new ReferenceRepository();
  // Reset north-hub budget for clean test execution
  const doc = getDocClient();
  const today = new Date().toISOString().split('T')[0]!;
  await doc.send(
    new DeleteCommand({
      TableName: getTableName(),
      Key: {
        PK: 'TENANT#north-hub',
        SK: `BUDGET#${today}`,
      },
    }),
  ).catch(() => {});

  let goldenTriageOutputJson = '';

  // ---------------------------------------------------------------------------
  // Check 1: Golden-path incident triage
  // ---------------------------------------------------------------------------
  {
    const details: string[] = [];
    const t0 = Date.now();
    try {
      const goldenDescription = 'Dock 4 conveyor stopped again. Packages piling up. Third time this week.';

      // Create incident via intake API
      const createEvent = createApiEvent('POST', '/v1/incidents', {
        description: goldenDescription,
      });
      const createRes = await incidentsApiHandler(createEvent);
      const createBody = JSON.parse(createRes.body);
      const incidentId = createBody.incident?.id;

      details.push(`Created Incident: ID=${incidentId}, Status=${createBody.incident?.status}`);

      // Run triage pipeline
      const triagedIncident = await runTriagePipeline({
        tenantId,
        incidentId,
        correlationId: ulid(),
      });

      const elapsedMs = Date.now() - t0;
      details.push(`Pipeline Execution Time: ${elapsedMs}ms (target < 10000ms)`);

      goldenTriageOutputJson = JSON.stringify(
        {
          id: triagedIncident.id,
          category: triagedIncident.category,
          severity: triagedIncident.severity,
          locationId: triagedIncident.locationId,
          assetId: triagedIncident.assetId,
          summary: triagedIncident.metadata.summary,
          recommendedFirstAction: triagedIncident.metadata.recommendedFirstAction,
          confidence: triagedIncident.confidence,
          triageMode: triagedIncident.triageMode,
          fieldSources: triagedIncident.metadata.fieldSources,
        },
        null,
        2,
      );

      const passTime = elapsedMs < 10000;
      const passCategory = triagedIncident.category === 'EQUIPMENT';
      const passSeverity = triagedIncident.severity === 'HIGH';
      const passLocation = triagedIncident.locationId === 'LOC-DOCK-4';
      const passAsset = triagedIncident.assetId === 'CONV-D4';
      const passSummary = Boolean(triagedIncident.metadata.summary);
      const passAction = Boolean(triagedIncident.metadata.recommendedFirstAction);

      details.push(`Category === EQUIPMENT: ${passCategory} (${triagedIncident.category})`);
      details.push(`Severity === HIGH: ${passSeverity} (${triagedIncident.severity})`);
      details.push(`LocationId === LOC-DOCK-4: ${passLocation} (${triagedIncident.locationId})`);
      details.push(`AssetId === CONV-D4: ${passAsset} (${triagedIncident.assetId})`);
      details.push(`Summary present: ${passSummary}`);
      details.push(`RecommendedAction present: ${passAction}`);

      const pass =
        passTime &&
        passCategory &&
        passSeverity &&
        passLocation &&
        passAsset &&
        passSummary &&
        passAction;

      checks.push({
        id: 1,
        title: 'Submit golden-path incident; verify category, severity, location, asset, summary, action within 10s',
        status: pass ? 'PASS' : 'FAIL',
        details,
      });
    } catch (err) {
      details.push(`Exception: ${err instanceof Error ? err.message : String(err)}`);
      checks.push({
        id: 1,
        title: 'Submit golden-path incident; verify category, severity, location, asset, summary, action within 10s',
        status: 'FAIL',
        details,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Check 2: Confirm each extracted field carries a source of "ai"
  // ---------------------------------------------------------------------------
  {
    const details: string[] = [];
    try {
      const parsedOutput = JSON.parse(goldenTriageOutputJson);
      const sources = parsedOutput.fieldSources || {};
      details.push(`Field Sources: ${JSON.stringify(sources)}`);

      const passCategory = sources.category === 'ai';
      const passSeverity = sources.severity === 'ai';
      const passSummary = sources.summary === 'ai';
      const passAction = sources.recommendedFirstAction === 'ai';

      details.push(`sources.category === 'ai': ${passCategory}`);
      details.push(`sources.severity === 'ai': ${passSeverity}`);
      details.push(`sources.summary === 'ai': ${passSummary}`);
      details.push(`sources.recommendedFirstAction === 'ai': ${passAction}`);

      const pass = passCategory && passSeverity && passSummary && passAction;
      checks.push({
        id: 2,
        title: 'Confirm each extracted field carries a source of "ai"',
        status: pass ? 'PASS' : 'FAIL',
        details,
      });
    } catch (err) {
      details.push(`Exception: ${err instanceof Error ? err.message : String(err)}`);
      checks.push({
        id: 2,
        title: 'Confirm each extracted field carries a source of "ai"',
        status: 'FAIL',
        details,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Check 3: Force an LlmSchemaError; confirm FALLBACK mode, confidence 0.3, timeline event
  // ---------------------------------------------------------------------------
  {
    const details: string[] = [];
    try {
      const inc = await incidentRepo.create(tenantId, {
        id: ulid(),
        tenantId,
        title: 'Forced schema error test',
        description: 'Conveyor 4 motor overheating',
        status: 'NEW',
        category: 'OPERATIONS',
        severity: 'LOW',
        priorityScore: 0,
        scoreBreakdown: {
          businessImpact: { rawValue: 0, normalisedValue: 0, weight: 0.3, contribution: 0, explanation: '' },
          safetyRisk: { rawValue: 0, normalisedValue: 0, weight: 0.25, contribution: 0, explanation: '' },
          slaUrgency: { rawValue: 0, normalisedValue: 0, weight: 0.2, contribution: 0, explanation: '' },
          recurrence: { rawValue: 0, normalisedValue: 0, weight: 0.15, contribution: 0, explanation: '' },
          downtime: { rawValue: 0, normalisedValue: 0, weight: 0.1, contribution: 0, explanation: '' },
          total: 0,
        },
        confidence: 0,
        triageMode: 'AI',
        assetId: null,
        locationId: null,
        assignedTeamId: null,
        ackDueAt: null,
        resolveDueAt: null,
        reporterId: 'usr-worker-test',
        tags: [],
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const failingProvider = {
        providerName: 'mock' as const,
        extractAndClassify: async () => {
          throw new LlmSchemaError('Forced schema validation error', '{"corrupt": true}', [], 2);
        },
        embed: async () => ({ vector: [], tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, modelId: 'mock' }),
        answerQuery: async () => ({ answer: '', tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, modelId: 'mock' }),
      };

      const result = await runTriagePipeline(
        { tenantId, incidentId: inc.id },
        { incidentRepo, timelineRepo, attachmentRepo, referenceRepo, budgetRepo },
        { provider: failingProvider },
      );

      const timeline = await timelineRepo.listEvents(tenantId, inc.id);
      const fallbackEvent = timeline.items.find(
        (e) => e.type === 'TRIAGED' && e.data?.triageMode === 'FALLBACK',
      );

      details.push(`TriageMode: ${result.triageMode}`);
      details.push(`Confidence: ${result.confidence}`);
      details.push(`Fallback timeline event found: ${Boolean(fallbackEvent)}`);
      details.push(`Fallback event reason: ${fallbackEvent?.data?.reason}`);

      const pass =
        result.triageMode === 'FALLBACK' &&
        result.confidence === 0.3 &&
        Boolean(fallbackEvent);

      checks.push({
        id: 3,
        title: 'Force an LlmSchemaError; confirm triageMode FALLBACK, confidence 0.3, and fallback timeline event',
        status: pass ? 'PASS' : 'FAIL',
        details,
      });
    } catch (err) {
      details.push(`Exception: ${err instanceof Error ? err.message : String(err)}`);
      checks.push({
        id: 3,
        title: 'Force an LlmSchemaError; confirm triageMode FALLBACK, confidence 0.3, and fallback timeline event',
        status: 'FAIL',
        details,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Check 4: Vague report -> NEEDS_INFO with ONE question -> answer via API -> triage re-runs once
  // ---------------------------------------------------------------------------
  {
    const details: string[] = [];
    try {
      // 1. Submit vague report
      const createRes = await incidentsApiHandler(
        createApiEvent('POST', '/v1/incidents', {
          description: 'something is wrong near the back',
        }),
      );
      const incidentId = JSON.parse(createRes.body).incident.id;

      // Run triage
      const initialTriage = await runTriagePipeline({
        tenantId,
        incidentId,
        correlationId: ulid(),
      });

      details.push(`Initial Status: ${initialTriage.status}`);
      details.push(`Clarifying Question: "${initialTriage.metadata.clarifyingQuestion}"`);
      details.push(`Initial Confidence: ${initialTriage.confidence}`);

      const passStatus = initialTriage.status === 'NEEDS_INFO';
      const passQuestion =
        typeof initialTriage.metadata.clarifyingQuestion === 'string' &&
        (initialTriage.metadata.clarifyingQuestion as string).length > 0;

      // 2. Answer via answer endpoint
      const answerRes = await incidentsApiHandler(
        createApiEvent(
          'POST',
          `/v1/incidents/${incidentId}/answer`,
          { answer: 'Dock 4 conveyor belt stopped with smoke from the drive motor.' },
          undefined,
          { id: incidentId },
        ),
      );

      const answeredBody = JSON.parse(answerRes.body);
      const triagedAgain = answeredBody.incident;

      details.push(`Answer API Response Status: ${answerRes.statusCode}`);
      details.push(`Updated Status after Answer: ${triagedAgain?.status}`);
      details.push(`Updated Description: "${triagedAgain?.description}"`);
      details.push(`Updated Confidence: ${triagedAgain?.confidence}`);
      details.push(`Triage Run Count: ${triagedAgain?.metadata?.triageRunCount}`);

      const passAnswer =
        answerRes.statusCode === 200 &&
        triagedAgain.status !== 'NEEDS_INFO' &&
        triagedAgain.status !== 'TRIAGING' &&
        triagedAgain.description.includes('Clarification:') &&
        triagedAgain.confidence > 0.6 &&
        triagedAgain.metadata.triageRunCount === 2;

      const pass = passStatus && passQuestion && passAnswer;

      checks.push({
        id: 4,
        title: 'Vague report -> NEEDS_INFO with 1 question -> answer via API -> triage re-runs once',
        status: pass ? 'PASS' : 'FAIL',
        details,
      });
    } catch (err) {
      details.push(`Exception: ${err instanceof Error ? err.message : String(err)}`);
      checks.push({
        id: 4,
        title: 'Vague report -> NEEDS_INFO with 1 question -> answer via API -> triage re-runs once',
        status: 'FAIL',
        details,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Check 5: Exhaust token budget -> rule-based fallback used without failing
  // ---------------------------------------------------------------------------
  {
    const details: string[] = [];
    try {
      const budgetTenant = 'budget-test-hub';
      const today = new Date().toISOString().split('T')[0]!;
      // Consume 250,000 tokens (limit is 200,000)
      await budgetRepo.recordTokenUsage(budgetTenant, today, {
        inputTokens: 150000,
        outputTokens: 100000,
      });

      const currentBudget = await budgetRepo.getBudget(budgetTenant, today);
      details.push(`Current Daily Token Usage: ${currentBudget?.totalTokens} (Threshold: 200,000)`);

      const inc = await incidentRepo.create(budgetTenant, {
        id: ulid(),
        tenantId: budgetTenant,
        title: 'Token budget exhaustion test',
        description: 'Forklift 1 hydraulic fluid leak in zone 2',
        status: 'NEW',
        category: 'OPERATIONS',
        severity: 'LOW',
        priorityScore: 0,
        scoreBreakdown: {
          businessImpact: { rawValue: 0, normalisedValue: 0, weight: 0.3, contribution: 0, explanation: '' },
          safetyRisk: { rawValue: 0, normalisedValue: 0, weight: 0.25, contribution: 0, explanation: '' },
          slaUrgency: { rawValue: 0, normalisedValue: 0, weight: 0.2, contribution: 0, explanation: '' },
          recurrence: { rawValue: 0, normalisedValue: 0, weight: 0.15, contribution: 0, explanation: '' },
          downtime: { rawValue: 0, normalisedValue: 0, weight: 0.1, contribution: 0, explanation: '' },
          total: 0,
        },
        confidence: 0,
        triageMode: 'AI',
        assetId: null,
        locationId: null,
        assignedTeamId: null,
        ackDueAt: null,
        resolveDueAt: null,
        reporterId: 'usr-worker-test',
        tags: [],
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const triaged = await runTriagePipeline({
        tenantId: budgetTenant,
        incidentId: inc.id,
      });

      details.push(`TriageMode: ${triaged.triageMode}`);
      details.push(`Confidence: ${triaged.confidence}`);
      details.push(`Status: ${triaged.status}`);
      details.push(`Fallback Reason: ${triaged.metadata.fallbackReason}`);

      const pass =
        triaged.triageMode === 'FALLBACK' &&
        triaged.confidence === 0.3 &&
        triaged.status !== 'TRIAGING';

      checks.push({
        id: 5,
        title: 'Exhaust token budget; confirm rule-based fallback is used without error state',
        status: pass ? 'PASS' : 'FAIL',
        details,
      });
    } catch (err) {
      details.push(`Exception: ${err instanceof Error ? err.message : String(err)}`);
      checks.push({
        id: 5,
        title: 'Exhaust token budget; confirm rule-based fallback is used without error state',
        status: 'FAIL',
        details,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Check 6: Kill pipeline mid-run (throw after step 4); confirm no stuck TRIAGING
  // ---------------------------------------------------------------------------
  {
    const details: string[] = [];
    try {
      const inc = await incidentRepo.create(tenantId, {
        id: ulid(),
        tenantId,
        title: 'Mid-run failure test',
        description: 'Conveyor 4 emergency stop engaged',
        status: 'NEW',
        category: 'OPERATIONS',
        severity: 'LOW',
        priorityScore: 0,
        scoreBreakdown: {
          businessImpact: { rawValue: 0, normalisedValue: 0, weight: 0.3, contribution: 0, explanation: '' },
          safetyRisk: { rawValue: 0, normalisedValue: 0, weight: 0.25, contribution: 0, explanation: '' },
          slaUrgency: { rawValue: 0, normalisedValue: 0, weight: 0.2, contribution: 0, explanation: '' },
          recurrence: { rawValue: 0, normalisedValue: 0, weight: 0.15, contribution: 0, explanation: '' },
          downtime: { rawValue: 0, normalisedValue: 0, weight: 0.1, contribution: 0, explanation: '' },
          total: 0,
        },
        confidence: 0,
        triageMode: 'AI',
        assetId: null,
        locationId: null,
        assignedTeamId: null,
        ackDueAt: null,
        resolveDueAt: null,
        reporterId: 'usr-worker-test',
        tags: [],
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const recovered = await runTriagePipeline(
        { tenantId, incidentId: inc.id },
        { incidentRepo, timelineRepo, attachmentRepo, referenceRepo, budgetRepo },
        { testHookThrowAfterStep4: true },
      );

      // Verify DynamoDB state directly
      const ddbIncident = await incidentRepo.getById(tenantId, inc.id);

      details.push(`Recovered Status in DynamoDB: ${ddbIncident?.status}`);
      details.push(`Recovered TriageMode: ${ddbIncident?.triageMode}`);
      details.push(`Recovered Confidence: ${ddbIncident?.confidence}`);
      details.push(`Fallback Reason: ${ddbIncident?.metadata.fallbackReason}`);

      const pass =
        ddbIncident?.status !== 'TRIAGING' &&
        ddbIncident?.status === 'NEW' &&
        ddbIncident?.triageMode === 'FALLBACK';

      checks.push({
        id: 6,
        title: 'Kill pipeline mid-run (throw after step 4); confirm no incident remains stuck in TRIAGING',
        status: pass ? 'PASS' : 'FAIL',
        details,
      });
    } catch (err) {
      details.push(`Exception: ${err instanceof Error ? err.message : String(err)}`);
      checks.push({
        id: 6,
        title: 'Kill pipeline mid-run (throw after step 4); confirm no incident remains stuck in TRIAGING',
        status: 'FAIL',
        details,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Check 7: Confirm timeline events record prompt version and model identifier
  // ---------------------------------------------------------------------------
  {
    const details: string[] = [];
    try {
      const parsedOutput = JSON.parse(goldenTriageOutputJson);
      const timeline = await timelineRepo.listEvents(tenantId, parsedOutput.id);
      const triageEvt = timeline.items.find((e) => e.type === 'TRIAGED');

      details.push(`Triage Event Found: ${Boolean(triageEvt)}`);
      details.push(`Model Identifier: "${triageEvt?.data?.modelId}"`);
      details.push(`Prompt Version: "${triageEvt?.data?.promptVersion}"`);

      const passModel = Boolean(triageEvt?.data?.modelId);
      const passVersion = triageEvt?.data?.promptVersion === 'triage-extract.v1';

      const pass = passModel && passVersion;
      checks.push({
        id: 7,
        title: 'Confirm timeline events record prompt version (triage-extract.v1) and model identifier',
        status: pass ? 'PASS' : 'FAIL',
        details,
      });
    } catch (err) {
      details.push(`Exception: ${err instanceof Error ? err.message : String(err)}`);
      checks.push({
        id: 7,
        title: 'Confirm timeline events record prompt version (triage-extract.v1) and model identifier',
        status: 'FAIL',
        details,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Check 8: Submit Hindi voice note fixture; confirm original Hindi text & 'hi' language stored
  // ---------------------------------------------------------------------------
  {
    const details: string[] = [];
    try {
      // Create incident
      const inc = await incidentRepo.create(tenantId, {
        id: ulid(),
        tenantId,
        title: 'Hindi voice note intake report',
        description: 'Voice note uploaded from floor worker',
        status: 'NEW',
        category: 'OPERATIONS',
        severity: 'LOW',
        priorityScore: 0,
        scoreBreakdown: {
          businessImpact: { rawValue: 0, normalisedValue: 0, weight: 0.3, contribution: 0, explanation: '' },
          safetyRisk: { rawValue: 0, normalisedValue: 0, weight: 0.25, contribution: 0, explanation: '' },
          slaUrgency: { rawValue: 0, normalisedValue: 0, weight: 0.2, contribution: 0, explanation: '' },
          recurrence: { rawValue: 0, normalisedValue: 0, weight: 0.15, contribution: 0, explanation: '' },
          downtime: { rawValue: 0, normalisedValue: 0, weight: 0.1, contribution: 0, explanation: '' },
          total: 0,
        },
        confidence: 0,
        triageMode: 'AI',
        assetId: null,
        locationId: null,
        assignedTeamId: null,
        ackDueAt: null,
        resolveDueAt: null,
        reporterId: 'usr-worker-test',
        tags: [],
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Add Hindi audio attachment
      const att = await attachmentRepo.createAttachment(tenantId, {
        id: ulid(),
        incidentId: inc.id,
        tenantId,
        fileName: 'dock4_hindi_recording.webm',
        contentType: 'audio/webm',
        s3Key: `tenants/${tenantId}/incidents/${inc.id}/dock4_hindi_recording.webm`,
        sizeBytes: 4096,
        uploadedBy: 'usr-worker-test',
        createdAt: new Date().toISOString(),
      });

      details.push(`Created Audio Attachment: ${att.id} (${att.fileName})`);

      // Run triage
      const triaged = await runTriagePipeline({
        tenantId,
        incidentId: inc.id,
      });

      details.push(`Stored Language: "${triaged.metadata.detectedLanguage}"`);
      details.push(`Original Transcript: "${triaged.metadata.originalTranscript}"`);
      details.push(`Translated Transcript: "${triaged.metadata.translatedTranscript}"`);
      details.push(`Result Category: ${triaged.category}`);
      details.push(`Result AssetId: ${triaged.assetId}`);

      const passLang = triaged.metadata.detectedLanguage === 'hi';
      const passOriginal =
        typeof triaged.metadata.originalTranscript === 'string' &&
        triaged.metadata.originalTranscript.includes('कन्वेयर');
      const passTranslated =
        typeof triaged.metadata.translatedTranscript === 'string' &&
        triaged.metadata.translatedTranscript.includes('Dock 4 conveyor');
      const passClassification =
        triaged.category === 'EQUIPMENT' && triaged.assetId === 'CONV-D4';

      const pass = passLang && passOriginal && passTranslated && passClassification;

      checks.push({
        id: 8,
        title: 'Submit Hindi voice note fixture; confirm original Hindi transcript and "hi" language stored and translation used for analysis',
        status: pass ? 'PASS' : 'FAIL',
        details,
      });
    } catch (err) {
      details.push(`Exception: ${err instanceof Error ? err.message : String(err)}`);
      checks.push({
        id: 8,
        title: 'Submit Hindi voice note fixture; confirm original Hindi transcript and "hi" language stored and translation used for analysis',
        status: 'FAIL',
        details,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Summary and Output
  // ---------------------------------------------------------------------------
  console.log('--- VERIFICATION RESULTS ---\n');
  for (const check of checks) {
    const icon = check.status === 'PASS' ? '✅ PASS' : '❌ FAIL';
    console.log(`${icon} [Check ${check.id}] ${check.title}`);
    for (const d of check.details) {
      console.log(`     ${d}`);
    }
    console.log('');
  }

  console.log('--- CHECK 1 ACTUAL TRIAGE OUTPUT JSON ---');
  console.log(goldenTriageOutputJson);
  console.log('-----------------------------------------\n');

  const allPassed = checks.every((c) => c.status === 'PASS');
  console.log(`FINAL RESULT: ${allPassed ? 'ALL CHECKS PASSED ✅' : 'SOME CHECKS FAILED ❌'}`);

  if (!allPassed) {
    process.exit(1);
  }
}

runVerification().catch((err) => {
  console.error('Unhandled verification error:', err);
  process.exit(1);
});
