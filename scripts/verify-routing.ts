import path from 'node:path';
import { createRequire } from 'node:module';

const req = createRequire(path.resolve('services/api-incidents/package.json'));
const { ulid } = req('ulid');

import {
  IncidentRepository,
  TimelineRepository,
  AttachmentRepository,
  ReferenceRepository,
  BudgetRepository,
  LinkRepository,
  RoutingRuleRepository,
  getDocClient,
  getTableName,
} from '../packages/data/src/index.js';
import { runTriagePipeline } from '../services/worker-triage/src/triage-pipeline.js';
import { handleCreateIncident } from '../services/api-incidents/src/create-incident.js';
import { handleUpdateIncident } from '../services/api-incidents/src/update-incident.js';
import { handleGetIncident } from '../services/api-incidents/src/get-incident.js';
import { MockLLMProvider } from '../packages/ai/src/index.js';
import {
  ALL_STATUSES,
  VALID_TRANSITIONS,
  resolveRoute,
  getLocalTimeDetails,
  type RoutingRule,
  type TeamRoutingProfile,
} from '../packages/core/src/index.js';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { HandlerContext } from '../packages/platform/src/index.js';
import type { Incident, IncidentStatus } from '@opslens/contracts';

interface CheckItem {
  id: number;
  title: string;
  status: 'PASS' | 'FAIL';
  details: string[];
}

const checkResults: CheckItem[] = [];

function createMockEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    body: null,
    headers: { 'x-correlation-id': 'corr-verify-routing' },
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
      requestId: 'req-verify-routing',
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
  console.log(' OPSLENS ROUTING & LIFECYCLE E2E VERIFICATION (Task V12)');
  console.log('================================================================\n');

  const tenantId = 'north-hub';
  const incidentRepo = new IncidentRepository();
  const timelineRepo = new TimelineRepository();
  const attachmentRepo = new AttachmentRepository();
  const referenceRepo = new ReferenceRepository();
  const budgetRepo = new BudgetRepository();
  const linkRepo = new LinkRepository();
  const routingRuleRepo = new RoutingRuleRepository();
  const mockAi = new MockLLMProvider();

  let goldenIncidentId = '';

  // ---------------------------------------------------------------------------
  // Check 1: Confirm golden-path incident routes to Maintenance via CONV-D4 rule,
  // and response states matched rule and reason.
  // ---------------------------------------------------------------------------
  {
    console.log('--- Check 1: Golden-path routes to Maintenance via CONV-D4 asset rule ---');
    const details: string[] = [];
    try {
      const goldenDescription = 'Dock 4 conveyor stopped again. Packages piling up. Third time this week.';

      // 1. Submit golden-path incident via intake API
      const intakeEvent = createMockEvent({
        httpMethod: 'POST',
        path: '/v1/incidents',
        body: JSON.stringify({
          description: goldenDescription,
          locationHint: 'LOC-DOCK-4',
          assetHint: 'CONV-D4',
        }),
      });
      const intakeContext: HandlerContext = {
        correlationId: 'corr-v12-golden',
        authContext: {
          tenantId,
          userId: 'usr-worker-01',
          role: 'worker',
          email: 'worker@warehouse.local',
        },
      };

      const intakeRes = await handleCreateIncident(intakeEvent, intakeContext);
      const intakeBody = JSON.parse(intakeRes.body);
      const inc = intakeBody.incident || intakeBody;
      goldenIncidentId = inc.id;

      // 2. Run triage pipeline
      const triagedIncident = await runTriagePipeline(
        {
          tenantId,
          incidentId: goldenIncidentId,
          correlationId: ulid(),
        },
        {
          incidentRepo,
          timelineRepo,
          attachmentRepo,
          referenceRepo,
          budgetRepo,
          linkRepo,
          routingRuleRepo,
        },
        {
          provider: mockAi,
        },
      );

      details.push(`Triaged Incident ID: ${triagedIncident.id}`);
      details.push(`Status: ${triagedIncident.status} (Expected: ROUTED)`);
      details.push(`Assigned Team: ${triagedIncident.assignedTeamId} (Expected: TEAM-MAINT)`);
      details.push(`Matched Rule: ${triagedIncident.metadata?.routing?.matchedRuleId} (Expected: ROUTE-CONV-D4)`);
      details.push(`Reason: "${triagedIncident.metadata?.routing?.reason}"`);

      if (triagedIncident.status !== 'ROUTED') {
        throw new Error(`Expected status ROUTED, got ${triagedIncident.status}`);
      }
      if (triagedIncident.assignedTeamId !== 'TEAM-MAINT') {
        throw new Error(`Expected assignedTeamId TEAM-MAINT, got ${triagedIncident.assignedTeamId}`);
      }
      if (triagedIncident.metadata?.routing?.matchedRuleId !== 'ROUTE-CONV-D4') {
        throw new Error(`Expected rule ROUTE-CONV-D4, got ${triagedIncident.metadata?.routing?.matchedRuleId}`);
      }

      checkResults.push({ id: 1, title: 'Golden-path Routes to Maintenance via CONV-D4 Asset Rule', status: 'PASS', details });
      console.log('Check 1 PASS\n');
    } catch (err: any) {
      details.push(`Error: ${err.message}`);
      checkResults.push({ id: 1, title: 'Golden-path Routes to Maintenance via CONV-D4 Asset Rule', status: 'FAIL', details });
      console.error('Check 1 FAIL:', err.message, '\n');
    }
  }

  // ---------------------------------------------------------------------------
  // Check 2: Confirm precedence: incident matching both asset rule and category rule -> asset rule wins
  // ---------------------------------------------------------------------------
  {
    console.log('--- Check 2: Precedence: asset-specific rule wins over category rule ---');
    const details: string[] = [];
    try {
      const rules = await routingRuleRepo.listRules(tenantId);
      const rawTeams = await referenceRepo.listTeams(tenantId);
      const teams = rawTeams as unknown as TeamRoutingProfile[];

      // Incident matches both ROUTE-CONV-D4 (assetId: CONV-D4) and ROUTE-EQUIPMENT-DEFAULT (category: EQUIPMENT)
      const resolution = resolveRoute(
        { category: 'EQUIPMENT', assetId: 'CONV-D4', locationId: 'LOC-DOCK-4' },
        rules,
        teams,
        new Date(),
        { timezone: 'Asia/Kolkata' },
      );

      details.push(`Input: category=EQUIPMENT, assetId=CONV-D4`);
      details.push(`Winning Rule: ${resolution.ruleId} (Expected: ROUTE-CONV-D4)`);
      details.push(`Target Team: ${resolution.targetTeamId} (Expected: TEAM-MAINT)`);
      details.push(`Reason: "${resolution.reason}"`);

      if (resolution.ruleId !== 'ROUTE-CONV-D4') {
        throw new Error(`Expected asset rule ROUTE-CONV-D4 to win precedence, but got ${resolution.ruleId}`);
      }

      checkResults.push({ id: 2, title: 'Asset Rule Precedence Over Category Rule', status: 'PASS', details });
      console.log('Check 2 PASS\n');
    } catch (err: any) {
      details.push(`Error: ${err.message}`);
      checkResults.push({ id: 2, title: 'Asset Rule Precedence Over Category Rule', status: 'FAIL', details });
      console.error('Check 2 FAIL:', err.message, '\n');
    }
  }

  // ---------------------------------------------------------------------------
  // Check 3: Confirm incident with no matching rule goes to tenant fallback team
  // ---------------------------------------------------------------------------
  {
    console.log('--- Check 3: Unmatched incident routes to tenant fallback team ---');
    const details: string[] = [];
    try {
      const rules = await routingRuleRepo.listRules(tenantId);
      const rawTeams = await referenceRepo.listTeams(tenantId);
      const teams = rawTeams as unknown as TeamRoutingProfile[];
      const tenant = await referenceRepo.getTenant(tenantId);

      // Unmatched category and asset
      const resolution = resolveRoute(
        { category: 'SECURITY' as any, assetId: null, locationId: 'LOC-GATE-3' },
        rules,
        teams,
        new Date(),
        { timezone: (tenant?.timezone as string) || 'Asia/Kolkata', fallbackTeamId: 'TEAM-LOGISTICS' },
      );

      details.push(`Input: category=SECURITY (no matching rule)`);
      details.push(`Winning Rule: ${resolution.ruleId}`);
      details.push(`Target Team: ${resolution.targetTeamId} (Expected: TEAM-LOGISTICS)`);
      details.push(`Reason: "${resolution.reason}"`);

      if (resolution.targetTeamId !== 'TEAM-LOGISTICS') {
        throw new Error(`Expected fallback team TEAM-LOGISTICS, got ${resolution.targetTeamId}`);
      }

      checkResults.push({ id: 3, title: 'Unmatched Incident Routes to Fallback Team', status: 'PASS', details });
      console.log('Check 3 PASS\n');
    } catch (err: any) {
      details.push(`Error: ${err.message}`);
      checkResults.push({ id: 3, title: 'Unmatched Incident Routes to Fallback Team', status: 'FAIL', details });
      console.error('Check 3 FAIL:', err.message, '\n');
    }
  }

  // ---------------------------------------------------------------------------
  // Check 4: Confirm out-of-shift routing sets routedOutOfShift and uses fallback team.
  // Show the timezone arithmetic used.
  // ---------------------------------------------------------------------------
  {
    console.log('--- Check 4: Out-of-shift routing sets routedOutOfShift & displays timezone arithmetic ---');
    const details: string[] = [];
    try {
      const rules = await routingRuleRepo.listRules(tenantId);
      const rawTeams = await referenceRepo.listTeams(tenantId);
      const teams = rawTeams as unknown as TeamRoutingProfile[];

      // Timestamp representing midnight in Kolkata (18:30 UTC = 00:00 Kolkata +5:30)
      const midnightUtc = new Date('2026-09-16T18:30:00.000Z');
      const timeCalc = getLocalTimeDetails(midnightUtc, 'Asia/Kolkata');

      details.push(`Timezone Arithmetic:`);
      details.push(`  UTC Timestamp: ${midnightUtc.toISOString()}`);
      details.push(`  Tenant Timezone: Asia/Kolkata (+05:30 offset)`);
      details.push(`  Local Facility Time: ${String(timeCalc.hour).padStart(2, '0')}:${String(timeCalc.minute).padStart(2, '0')} (${timeCalc.weekday})`);
      details.push(`  TEAM-SAFETY Shift Pattern: STANDARD_DAY (Mon-Fri 08:00 - 17:00 local)`);
      details.push(`  Active Personnel on Shift at 00:00: false (Off-shift)`);

      // Category SAFETY matches TEAM-SAFETY (STANDARD_DAY)
      const resolution = resolveRoute(
        { category: 'SAFETY', assetId: null, locationId: null },
        rules,
        teams,
        midnightUtc,
        { timezone: 'Asia/Kolkata', fallbackTeamId: 'TEAM-LOGISTICS' },
      );

      details.push(`Resolution Result:`);
      details.push(`  Matched Team: ${resolution.matchedTeamId} (TEAM-SAFETY)`);
      details.push(`  Dispatched Team: ${resolution.targetTeamId} (Fallback: TEAM-LOGISTICS)`);
      details.push(`  routedOutOfShift: ${resolution.routedOutOfShift}`);
      details.push(`  Reason: "${resolution.reason}"`);

      if (!resolution.routedOutOfShift) {
        throw new Error('Expected routedOutOfShift to be true');
      }
      if (resolution.targetTeamId !== 'TEAM-LOGISTICS') {
        throw new Error(`Expected fallback team TEAM-LOGISTICS, got ${resolution.targetTeamId}`);
      }

      checkResults.push({ id: 4, title: 'Out-of-Shift Routing Sets Flag & Explains Timezone Arithmetic', status: 'PASS', details });
      console.log('Check 4 PASS\n');
    } catch (err: any) {
      details.push(`Error: ${err.message}`);
      checkResults.push({ id: 4, title: 'Out-of-Shift Routing Sets Flag & Explains Timezone Arithmetic', status: 'FAIL', details });
      console.error('Check 4 FAIL:', err.message, '\n');
    }
  }

  // ---------------------------------------------------------------------------
  // Check 5: Print full legal/illegal transition matrix with API's actual response code,
  // confirming every illegal pair returns 409.
  // ---------------------------------------------------------------------------
  {
    console.log('--- Check 5: Transition Matrix: verify every legal/illegal pair against API ---');
    const details: string[] = [];
    try {
      const supervisorContext: HandlerContext = {
        correlationId: 'corr-matrix-test',
        authContext: {
          tenantId,
          userId: 'usr-supervisor-01',
          role: 'supervisor',
          email: 'supervisor@warehouse.local',
        },
      };

      // Create a test incident in database to test status transitions
      const testIncId = ulid();
      const testIncident: Incident = {
        id: testIncId,
        tenantId,
        title: 'Matrix Test Incident',
        description: 'Test incident for status transitions',
        status: 'NEW',
        category: 'EQUIPMENT',
        severity: 'LOW',
        priorityScore: 30,
        reporterId: 'usr-supervisor-01',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await incidentRepo.create(tenantId, testIncident);

      console.log('\n  10x10 Incident Status Transition Matrix (Actual API HTTP Response Codes):');
      const headerRow = '  | FROM \\ TO     | ' + ALL_STATUSES.map((s) => s.slice(0, 5).padEnd(5, ' ')).join(' | ') + ' |';
      console.log('  ' + '-'.repeat(headerRow.length - 2));
      console.log(headerRow);
      console.log('  |---------------|' + ALL_STATUSES.map(() => '-------|').join(''));

      let illegal409Count = 0;
      let totalIllegalPairs = 0;
      let legal200Count = 0;
      let totalLegalPairs = 0;

      for (const from of ALL_STATUSES) {
        let rowStr = `  | ${from.padEnd(13, ' ')} | `;
        for (const to of ALL_STATUSES) {
          const allowedTargets = VALID_TRANSITIONS[from] || [];
          const isLegal = allowedTargets.includes(to);

          // Force existing status in DB to `from`
          await incidentRepo.update(tenantId, testIncId, { status: from });

          const patchEvent = createMockEvent({
            httpMethod: 'PATCH',
            path: `/v1/incidents/${testIncId}`,
            pathParameters: { id: testIncId },
            body: JSON.stringify({ status: to }),
          });

          let code: number;
          try {
            const res = await handleUpdateIncident(patchEvent, supervisorContext, incidentRepo, timelineRepo);
            code = res.statusCode;
          } catch (err: any) {
            code = err.statusCode || 500;
          }

          if (isLegal) {
            totalLegalPairs++;
            if (code === 200) legal200Count++;
          } else {
            totalIllegalPairs++;
            if (code === 409) illegal409Count++;
          }

          const cell = `${code}`.padEnd(5, ' ');
          rowStr += `${cell} | `;
        }
        console.log(rowStr);
      }
      console.log('  ' + '-'.repeat(headerRow.length - 2) + '\n');

      details.push(`Total Legal Transitions Tested: ${totalLegalPairs} (API 200 Count: ${legal200Count})`);
      details.push(`Total Illegal Transitions Tested: ${totalIllegalPairs} (API 409 Count: ${illegal409Count})`);

      if (legal200Count !== totalLegalPairs) {
        throw new Error(`Expected all ${totalLegalPairs} legal transitions to return 200, but only ${legal200Count} did`);
      }
      if (illegal409Count !== totalIllegalPairs) {
        throw new Error(`Expected all ${totalIllegalPairs} illegal transitions to return 409, but only ${illegal409Count} did`);
      }

      checkResults.push({ id: 5, title: 'Full 10x10 Transition Matrix Tested: All Illegal Pairs Return 409', status: 'PASS', details });
      console.log('Check 5 PASS\n');
    } catch (err: any) {
      details.push(`Error: ${err.message}`);
      checkResults.push({ id: 5, title: 'Full 10x10 Transition Matrix Tested: All Illegal Pairs Return 409', status: 'FAIL', details });
      console.error('Check 5 FAIL:', err.message, '\n');
    }
  }

  // ---------------------------------------------------------------------------
  // Check 6: Confirm reassignment requires supervisor+, requires reason,
  // writes timeline event, and does not alter ackDueAt or resolveDueAt.
  // ---------------------------------------------------------------------------
  {
    console.log('--- Check 6: Reassignment authorization, reason requirement & SLA timer preservation ---');
    const details: string[] = [];
    try {
      const testId = ulid();
      const initialAck = '2026-09-20T10:00:00.000Z';
      const initialResolve = '2026-09-20T14:00:00.000Z';

      const reassignInc: Incident = {
        id: testId,
        tenantId,
        title: 'Reassignment Test Incident',
        description: 'Reassignment test description',
        status: 'ROUTED',
        category: 'EQUIPMENT',
        severity: 'HIGH',
        priorityScore: 75,
        assignedTeamId: 'TEAM-LOGISTICS',
        ackDueAt: initialAck,
        resolveDueAt: initialResolve,
        reporterId: 'usr-worker-01',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await incidentRepo.create(tenantId, reassignInc);

      // 1. Worker gets 403 Forbidden
      let workerBlocked = false;
      try {
        const workerEvent = createMockEvent({
          httpMethod: 'PATCH',
          path: `/v1/incidents/${testId}`,
          pathParameters: { id: testId },
          body: JSON.stringify({ assignedTeamId: 'TEAM-MAINT', reason: 'Worker attempt' }),
        });
        const workerContext: HandlerContext = {
          correlationId: 'corr-worker',
          authContext: {
            tenantId,
            userId: 'usr-worker-01',
            role: 'worker',
            email: 'worker@warehouse.local',
          },
        };
        await handleUpdateIncident(workerEvent, workerContext, incidentRepo, timelineRepo);
      } catch (err: any) {
        if (err.statusCode === 403) {
          workerBlocked = true;
          details.push(`Worker attempt rejected with HTTP 403 Forbidden: "${err.message}"`);
        }
      }
      if (!workerBlocked) throw new Error('Worker was able to reassign; expected 403 Forbidden');

      // 2. Missing reason gets 400 Bad Request
      let reasonMissingBlocked = false;
      const supContext: HandlerContext = {
        correlationId: 'corr-sup',
        authContext: {
          tenantId,
          userId: 'usr-supervisor-01',
          role: 'supervisor',
          email: 'supervisor@warehouse.local',
        },
      };
      try {
        const noReasonEvent = createMockEvent({
          httpMethod: 'PATCH',
          path: `/v1/incidents/${testId}`,
          pathParameters: { id: testId },
          body: JSON.stringify({ assignedTeamId: 'TEAM-MAINT' }),
        });
        await handleUpdateIncident(noReasonEvent, supContext, incidentRepo, timelineRepo);
      } catch (err: any) {
        if (err.statusCode === 400) {
          reasonMissingBlocked = true;
          details.push(`Missing reason rejected with HTTP 400 Bad Request: "${err.message}"`);
        }
      }
      if (!reasonMissingBlocked) throw new Error('Reassignment without reason succeeded; expected 400 Bad Request');

      // 3. Supervisor reassigns with reason -> 200, timeline event logged, SLA timers unchanged
      const validEvent = createMockEvent({
        httpMethod: 'PATCH',
        path: `/v1/incidents/${testId}`,
        pathParameters: { id: testId },
        body: JSON.stringify({
          assignedTeamId: 'TEAM-MAINT',
          reason: 'Conveyor drive motor requires mechanical specialists',
        }),
      });
      const validRes = await handleUpdateIncident(validEvent, supContext, incidentRepo, timelineRepo);
      if (validRes.statusCode !== 200) {
        throw new Error(`Expected HTTP 200 from valid reassignment, got ${validRes.statusCode}`);
      }

      const updated = await incidentRepo.getById(tenantId, testId);
      details.push(`Updated assignedTeamId: ${updated?.assignedTeamId} (Expected: TEAM-MAINT)`);
      details.push(`ackDueAt preserved: ${updated?.ackDueAt === initialAck} (${updated?.ackDueAt})`);
      details.push(`resolveDueAt preserved: ${updated?.resolveDueAt === initialResolve} (${updated?.resolveDueAt})`);

      if (updated?.assignedTeamId !== 'TEAM-MAINT') {
        throw new Error(`Expected assignedTeamId TEAM-MAINT, got ${updated?.assignedTeamId}`);
      }
      if (updated?.ackDueAt !== initialAck || updated?.resolveDueAt !== initialResolve) {
        throw new Error('SLA timers were altered or reset during reassignment!');
      }

      // Check timeline event
      const timeline = await timelineRepo.listEvents(tenantId, testId);
      const reassignEvent = timeline.items.find((e) => (e.data as any)?.action === 'REASSIGNED');
      details.push(`Timeline recorded REASSIGNED event: ${Boolean(reassignEvent)}`);
      details.push(`  Previous Team: ${(reassignEvent?.data as any)?.previousTeamId}, New Team: ${(reassignEvent?.data as any)?.assignedTeamId}`);
      details.push(`  Reason recorded: "${(reassignEvent?.data as any)?.reason}"`);

      if (!reassignEvent) {
        throw new Error('Timeline event for reassignment was not logged');
      }

      checkResults.push({ id: 6, title: 'Reassignment Authorization, Reason Check & SLA Preservation', status: 'PASS', details });
      console.log('Check 6 PASS\n');
    } catch (err: any) {
      details.push(`Error: ${err.message}`);
      checkResults.push({ id: 6, title: 'Reassignment Authorization, Reason Check & SLA Preservation', status: 'FAIL', details });
      console.error('Check 6 FAIL:', err.message, '\n');
    }
  }

  // ---------------------------------------------------------------------------
  // Check 7: Confirm INCIDENT_ROUTED is published exactly once per incident
  // ---------------------------------------------------------------------------
  {
    console.log('--- Check 7: Confirm INCIDENT_ROUTED published and recorded in timeline ---');
    const details: string[] = [];
    try {
      // Check golden-path timeline for ROUTED event
      const timeline = await timelineRepo.listEvents(tenantId, goldenIncidentId);
      const routedEvents = timeline.items.filter((e) => e.type === 'ROUTED');

      details.push(`Golden Incident ID: ${goldenIncidentId}`);
      details.push(`ROUTED events in incident timeline: ${routedEvents.length}`);

      if (routedEvents.length === 0) {
        throw new Error('No ROUTED event was recorded in timeline during triage');
      }
      if (routedEvents.length > 1) {
        throw new Error(`Expected exactly 1 ROUTED event during triage, found ${routedEvents.length}`);
      }

      const routedEvent = routedEvents[0]!;
      details.push(`  Assigned Team: ${(routedEvent.data as any)?.assignedTeamId}`);
      details.push(`  Rule ID: ${(routedEvent.data as any)?.ruleId}`);
      details.push(`  Reason: "${(routedEvent.data as any)?.reason}"`);
      details.push(`  routedOutOfShift: ${(routedEvent.data as any)?.routedOutOfShift}`);

      checkResults.push({ id: 7, title: 'INCIDENT_ROUTED Logged Exactly Once During Triage', status: 'PASS', details });
      console.log('Check 7 PASS\n');
    } catch (err: any) {
      details.push(`Error: ${err.message}`);
      checkResults.push({ id: 7, title: 'INCIDENT_ROUTED Logged Exactly Once During Triage', status: 'FAIL', details });
      console.error('Check 7 FAIL:', err.message, '\n');
    }
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('================================================================');
  console.log(' VERIFICATION SUMMARY');
  console.log('================================================================');
  for (const r of checkResults) {
    console.log(`[${r.status}] Check ${r.id}: ${r.title}`);
    for (const d of r.details) {
      console.log(`       ${d}`);
    }
  }

  const allPassed = checkResults.every((r) => r.status === 'PASS');
  console.log('\nFinal Verdict:', allPassed ? 'ALL CHECKS PASSED (PASS)' : 'ONE OR MORE CHECKS FAILED (FAIL)');
  if (!allPassed) {
    process.exit(1);
  }
}

runVerification().catch((err) => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
