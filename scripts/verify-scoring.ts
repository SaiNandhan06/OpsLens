import { execSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';

const req = createRequire(path.resolve('services/api-incidents/package.json'));
const dataReq = createRequire(path.resolve('packages/data/package.json'));
const { ulid } = req('ulid');

import {
  calculatePriority,
  calculateBusinessImpact,
  calculateSafetyRisk,
  calculateSlaUrgency,
  calculateRecurrence,
  calculateDowntime,
  validateWeights,
  InvalidWeightsError,
  DEFAULT_SCORING_WEIGHTS,
  recalculateOpenIncidents,
  type PriorityCalculationInput,
} from '../packages/core/src/index.js';

import {
  IncidentRepository,
  TimelineRepository,
  ReferenceRepository,
} from '../packages/data/src/index.js';

import { handleUpdateIncident } from '../services/api-incidents/src/update-incident.js';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { HandlerContext } from '../packages/platform/src/index.js';
import type { Incident, ScoreBreakdown } from '@opslens/contracts';

interface VerificationCheckResult {
  id: number;
  title: string;
  status: 'PASS' | 'FAIL';
  details: string[];
}

const results: VerificationCheckResult[] = [];

function formatTable(headers: string[], rows: string[][]): string {
  const colWidths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] || '').length)));
  const pad = (str: string, w: number) => str + ' '.repeat(Math.max(0, w - str.length));

  const headerLine = '| ' + headers.map((h, i) => pad(h, colWidths[i]!)).join(' | ') + ' |';
  const sepLine = '|-' + colWidths.map((w) => '-'.repeat(w)).join('-|-') + '-|';
  const rowLines = rows.map((r) => '| ' + r.map((c, i) => pad(c, colWidths[i]!)).join(' | ') + ' |');

  return [headerLine, sepLine, ...rowLines].join('\n');
}

async function runVerification() {
  console.log('================================================================');
  console.log(' OPSLENS packages/core/src/scoring VERIFICATION SUITE (V10)');
  console.log('================================================================\n');

  // ---------------------------------------------------------------------------
  // Check 1: pnpm --filter core test with coverage
  // ---------------------------------------------------------------------------
  {
    console.log('--- Running Check 1: pnpm --filter core test --coverage ---');
    const details: string[] = [];
    try {
      const output = execSync('pnpm --filter core test --coverage', { encoding: 'utf-8' });
      const passLine = output.split('\n').find((l) => l.includes('passed'))?.trim() || '';
      details.push(`Command: pnpm --filter core test --coverage`);
      details.push(`Status: ${passLine}`);

      // Extract coverage lines
      const coverageLines = output.split('\n').filter((l) => l.includes('core/src') || l.includes('All files'));
      for (const cl of coverageLines) {
        details.push(`Coverage: ${cl.trim()}`);
      }

      const pass = output.includes('passed') && !output.includes('failed');
      results.push({
        id: 1,
        title: 'pnpm --filter core test passes with full coverage report',
        status: pass ? 'PASS' : 'FAIL',
        details,
      });
      console.log(`Check 1 Result: ${pass ? 'PASS' : 'FAIL'} (${passLine})\n`);
    } catch (err) {
      results.push({
        id: 1,
        title: 'pnpm --filter core test passes with full coverage report',
        status: 'FAIL',
        details: [`Error running test suite: ${err instanceof Error ? err.message : String(err)}`],
      });
      console.log('Check 1 Result: FAIL\n');
    }
  }

  // ---------------------------------------------------------------------------
  // Check 2: Golden-Path Incident Priority Calculation
  // ---------------------------------------------------------------------------
  let goldenBreakdown: ScoreBreakdown;
  {
    console.log('--- Running Check 2: Golden-Path Incident Scoring ---');
    const details: string[] = [];
    const createdAt = new Date('2026-09-19T06:00:00.000Z');
    const resolveDueAt = new Date('2026-09-19T07:00:00.000Z'); // 60 min SLA
    const now = new Date('2026-09-19T06:30:00.000Z'); // 30 min elapsed (50%)

    const goldenInput: PriorityCalculationInput = {
      category: 'EQUIPMENT_FAILURE',
      severity: 'HIGH',
      assetId: 'CONV-D4',
      locationId: 'LOC-DOCK-4',
      createdAt,
      resolveDueAt,
      affectedOrders: 150,
      impactSignals: ['conveyor stopped', 'packages piling up', 'hot motor'],
      description: 'Conveyor belt CONV-D4 at Dock 4 stopped again for the third time this month. Packages piling up rapidly.',
      assetCriticality: 'TIER_1',
      estimatedStoppageMinutes: 45,
      sameCategoryIncidentCount30Days: 3, // 3rd time in 30 days
    };

    goldenBreakdown = calculatePriority(goldenInput, DEFAULT_SCORING_WEIGHTS, now);

    const headers = ['Factor', 'Raw Value', 'Normalised (0-100)', 'Weight', 'Contribution'];
    const rows = [
      ['businessImpact', String(goldenBreakdown.businessImpact.rawValue), String(goldenBreakdown.businessImpact.normalisedValue), String(goldenBreakdown.businessImpact.weight), goldenBreakdown.businessImpact.contribution.toFixed(1)],
      ['safetyRisk', String(goldenBreakdown.safetyRisk.rawValue), String(goldenBreakdown.safetyRisk.normalisedValue), String(goldenBreakdown.safetyRisk.weight), goldenBreakdown.safetyRisk.contribution.toFixed(1)],
      ['slaUrgency', String(goldenBreakdown.slaUrgency.rawValue), String(goldenBreakdown.slaUrgency.normalisedValue), String(goldenBreakdown.slaUrgency.weight), goldenBreakdown.slaUrgency.contribution.toFixed(1)],
      ['recurrence', String(goldenBreakdown.recurrence.rawValue), String(goldenBreakdown.recurrence.normalisedValue), String(goldenBreakdown.recurrence.weight), goldenBreakdown.recurrence.contribution.toFixed(1)],
      ['downtime', String(goldenBreakdown.downtime.rawValue), String(goldenBreakdown.downtime.normalisedValue), String(goldenBreakdown.downtime.weight), goldenBreakdown.downtime.contribution.toFixed(1)],
      ['TOTAL SCORE', '-', '-', '1.00', String(goldenBreakdown.total)],
    ];

    const tableStr = formatTable(headers, rows);
    console.log(tableStr);
    console.log(`Total Composite Score: ${goldenBreakdown.total}`);

    details.push('Score Breakdown Table:');
    tableStr.split('\n').forEach((l) => details.push(l));
    details.push(`Total Score: ${goldenBreakdown.total} (Target: >= 78)`);
    details.push(`Recurrence Normalised: ${goldenBreakdown.recurrence.normalisedValue} (Target: 100 for 3+ occurrences)`);

    const pass = goldenBreakdown.total >= 78 && goldenBreakdown.recurrence.normalisedValue === 100;
    results.push({
      id: 2,
      title: 'Golden-path incident priority score >= 78 with elevated recurrence',
      status: pass ? 'PASS' : 'FAIL',
      details,
    });
    console.log(`Check 2 Result: ${pass ? 'PASS' : 'FAIL'}\n`);
  }

  // ---------------------------------------------------------------------------
  // Check 3: Reject Invalid Weights
  // ---------------------------------------------------------------------------
  {
    console.log('--- Running Check 3: Rejection of Invalid Weights ---');
    const details: string[] = [];
    let rejectedSumMismatch = false;
    let rejectedNegativeWeight = false;

    try {
      validateWeights({
        businessImpact: 0.4,
        safetyRisk: 0.3,
        slaUrgency: 0.2,
        recurrence: 0.2,
        downtime: 0.1, // sum = 1.20
      });
    } catch (err) {
      if (err instanceof InvalidWeightsError && err.message.includes('must sum to 1.0')) {
        rejectedSumMismatch = true;
        details.push(`Rejected sum 1.20: "${err.message}"`);
      }
    }

    try {
      validateWeights({
        businessImpact: 0.5,
        safetyRisk: 0.3,
        slaUrgency: 0.3,
        recurrence: -0.1,
        downtime: 0.0,
      });
    } catch (err) {
      if (err instanceof InvalidWeightsError && err.message.includes('between 0 and 1')) {
        rejectedNegativeWeight = true;
        details.push(`Rejected negative weight: "${err.message}"`);
      }
    }

    const pass = rejectedSumMismatch && rejectedNegativeWeight;
    results.push({
      id: 3,
      title: 'Invalid weights (sum != 1.0 or out-of-range) rejected with InvalidWeightsError',
      status: pass ? 'PASS' : 'FAIL',
      details,
    });
    console.log(`Check 3 Result: ${pass ? 'PASS' : 'FAIL'}\n`);
  }

  // ---------------------------------------------------------------------------
  // Check 4: SLA Urgency Advances with Time
  // ---------------------------------------------------------------------------
  {
    console.log('--- Running Check 4: SLA Urgency Progression Over Time ---');
    const details: string[] = [];
    const createdAt = new Date('2026-09-19T08:00:00.000Z');
    const resolveDueAt = new Date('2026-09-19T09:00:00.000Z'); // 60 min window

    const input = { createdAt, resolveDueAt };

    const t0 = calculateSlaUrgency(input, 0.2, new Date('2026-09-19T08:00:00.000Z'));
    const t30 = calculateSlaUrgency(input, 0.2, new Date('2026-09-19T08:30:00.000Z'));
    const t60 = calculateSlaUrgency(input, 0.2, new Date('2026-09-19T09:00:00.000Z'));
    const t90 = calculateSlaUrgency(input, 0.2, new Date('2026-09-19T09:30:00.000Z'));

    // Also calculate full incident priority at t0 vs t30 to confirm total composite score rises
    const incidentInput: PriorityCalculationInput = {
      category: 'EQUIPMENT_FAILURE',
      severity: 'HIGH',
      assetId: 'CONV-D4',
      createdAt,
      resolveDueAt,
      affectedOrders: 150,
      impactSignals: ['conveyor stopped', 'packages piling up'],
      description: 'Conveyor belt stopped',
      assetCriticality: 'TIER_1',
      estimatedStoppageMinutes: 45,
      sameCategoryIncidentCount30Days: 3,
    };

    const scoreAtT0 = calculatePriority(incidentInput, DEFAULT_SCORING_WEIGHTS, new Date('2026-09-19T08:00:00.000Z'));
    const scoreAtT30 = calculatePriority(incidentInput, DEFAULT_SCORING_WEIGHTS, new Date('2026-09-19T08:30:00.000Z'));

    details.push(`At creation (now = createdAt): slaUrgency = ${t0.normalisedValue} (contrib ${t0.contribution}), incident total = ${scoreAtT0.total}`);
    details.push(`At +30m (50% window): slaUrgency = ${t30.normalisedValue} (contrib ${t30.contribution}), incident total = ${scoreAtT30.total}`);
    details.push(`At +60m (deadline): slaUrgency = ${t60.normalisedValue} (contrib ${t60.contribution})`);
    details.push(`At +90m (breach): slaUrgency = ${t90.normalisedValue} (contrib ${t90.contribution})`);
    details.push(`Total composite score rose by +${scoreAtT30.total - scoreAtT0.total} points due to SLA urgency progression`);

    const pass =
      t0.normalisedValue === 0 &&
      t30.normalisedValue === 50 &&
      t60.normalisedValue === 100 &&
      t90.normalisedValue === 100 &&
      t30.normalisedValue > t0.normalisedValue &&
      scoreAtT30.total > scoreAtT0.total;

    results.push({
      id: 4,
      title: 'SLA urgency advances when computed 30 minutes later and incident total score rises accordingly',
      status: pass ? 'PASS' : 'FAIL',
      details,
    });
    console.log(`Check 4 Result: ${pass ? 'PASS' : 'FAIL'} (t0=${scoreAtT0.total} -> t30=${scoreAtT30.total}, +${scoreAtT30.total - scoreAtT0.total} pts)\n`);
  }

  // ---------------------------------------------------------------------------
  // Check 5: Category SAFETY Floors at 70
  // ---------------------------------------------------------------------------
  {
    console.log('--- Running Check 5: SAFETY Category 70-Point Floor ---');
    const details: string[] = [];

    // Minor non-safety incident
    const opsIncident = calculateSafetyRisk({
      category: 'OPERATIONS',
      description: 'Handheld scanner battery depleted on picking cart',
    });

    // Same minor description, but categorized as SAFETY
    const safetyIncident1 = calculateSafetyRisk({
      category: 'SAFETY',
      description: 'Minor loose paper near aisle 4',
    });

    const safetyIncident2 = calculateSafetyRisk({
      category: 'SAFETY_INCIDENT',
      description: 'Small scuff mark on guardrail',
    });

    details.push(`OPERATIONS category score: raw=${opsIncident.rawValue}, normalised=${opsIncident.normalisedValue}`);
    details.push(`SAFETY category score: raw=${safetyIncident1.rawValue}, normalised=${safetyIncident1.normalisedValue} (floored at 70)`);
    details.push(`SAFETY explanation: "${safetyIncident1.explanation}"`);
    details.push(`SAFETY_INCIDENT category score: raw=${safetyIncident2.rawValue}, normalised=${safetyIncident2.normalisedValue} (floored at 70)`);

    const pass = opsIncident.normalisedValue < 70 && safetyIncident1.normalisedValue >= 70 && safetyIncident2.normalisedValue >= 70;
    results.push({
      id: 5,
      title: 'Category SAFETY floors safetyRisk factor at 70 regardless of how minor the report appears',
      status: pass ? 'PASS' : 'FAIL',
      details,
    });
    console.log(`Check 5 Result: ${pass ? 'PASS' : 'FAIL'} (OPERATIONS=${opsIncident.normalisedValue}, SAFETY=${safetyIncident1.normalisedValue})\n`);
  }

  // ---------------------------------------------------------------------------
  // Check 6: Warehouse Manager Explanations
  // ---------------------------------------------------------------------------
  {
    console.log('--- Running Check 6: Human-Readable Explanations for Warehouse Managers ---');
    const details: string[] = [];

    console.log('Factor Explanations:');
    console.log(`  1. businessImpact: "${goldenBreakdown.businessImpact.explanation}"`);
    console.log(`  2. safetyRisk:     "${goldenBreakdown.safetyRisk.explanation}"`);
    console.log(`  3. slaUrgency:     "${goldenBreakdown.slaUrgency.explanation}"`);
    console.log(`  4. recurrence:     "${goldenBreakdown.recurrence.explanation}"`);
    console.log(`  5. downtime:       "${goldenBreakdown.downtime.explanation}"`);

    details.push(`businessImpact: "${goldenBreakdown.businessImpact.explanation}"`);
    details.push(`safetyRisk: "${goldenBreakdown.safetyRisk.explanation}"`);
    details.push(`slaUrgency: "${goldenBreakdown.slaUrgency.explanation}"`);
    details.push(`recurrence: "${goldenBreakdown.recurrence.explanation}"`);
    details.push(`downtime: "${goldenBreakdown.downtime.explanation}"`);

    // Verify non-empty, clear operational terms (packages, downtime, SLA, stoppage, hazard) and no ML jargon
    const allExplanations = [
      goldenBreakdown.businessImpact.explanation,
      goldenBreakdown.safetyRisk.explanation,
      goldenBreakdown.slaUrgency.explanation,
      goldenBreakdown.recurrence.explanation,
      goldenBreakdown.downtime.explanation,
    ].join(' ');

    const hasNoJargon = !allExplanations.includes('tensor') && !allExplanations.includes('loss') && !allExplanations.includes('softmax') && !allExplanations.includes('vector');
    const hasWarehouseConcepts = allExplanations.includes('sorting') || allExplanations.includes('packages') || allExplanations.includes('hazard') || allExplanations.includes('stoppage');

    const pass = hasNoJargon && hasWarehouseConcepts;
    results.push({
      id: 6,
      title: 'Human-readable explanation strings written in operational language for warehouse managers',
      status: pass ? 'PASS' : 'FAIL',
      details,
    });
    console.log(`Check 6 Result: ${pass ? 'PASS' : 'FAIL'}\n`);
  }

  // ---------------------------------------------------------------------------
  // Check 7: Supervisor Manual Override preserves computed score & updates queue
  // ---------------------------------------------------------------------------
  {
    console.log('--- Running Check 7: Supervisor Manual Priority Override ---');
    const details: string[] = [];
    const tenantId = 'north-hub';
    const incidentRepo = new IncidentRepository();
    const timelineRepo = new TimelineRepository();

    const incidentId = ulid();
    const createdAt = new Date().toISOString();

    const initialIncident: Incident = {
      id: incidentId,
      tenantId,
      title: 'Belt friction alarm',
      description: 'Minor friction detected on feeder',
      status: 'NEW',
      category: 'EQUIPMENT_FAILURE',
      severity: 'LOW',
      priorityScore: 32,
      scoreBreakdown: {
        businessImpact: { rawValue: 10, normalisedValue: 25, weight: 0.3, contribution: 7.5, explanation: 'Minor impact' },
        safetyRisk: { rawValue: 10, normalisedValue: 10, weight: 0.25, contribution: 2.5, explanation: 'Clean' },
        slaUrgency: { rawValue: 0, normalisedValue: 10, weight: 0.2, contribution: 2.0, explanation: 'Fresh' },
        recurrence: { rawValue: 0, normalisedValue: 0, weight: 0.15, contribution: 0, explanation: 'First time' },
        downtime: { rawValue: 5, normalisedValue: 15, weight: 0.1, contribution: 1.5, explanation: 'Under 5 min' },
        total: 32,
      },
      confidence: 0.95,
      triageMode: 'AI',
      assetId: 'FEED-01',
      locationId: 'LOC-DOCK-1',
      assignedTeamId: null,
      ackDueAt: null,
      resolveDueAt: null,
      reporterId: 'usr-worker-test',
      tags: [],
      metadata: {},
      createdAt,
      updatedAt: createdAt,
    };

    try {
      // 1. Create incident in DynamoDB
      await incidentRepo.create(tenantId, initialIncident);
      details.push(`Created incident ${incidentId} with initial priorityScore: 32`);

      // 2. Perform supervisor manual override via handleUpdateIncident
      const mockEvent: APIGatewayProxyEvent = {
        httpMethod: 'PATCH',
        path: `/v1/incidents/${incidentId}`,
        pathParameters: { id: incidentId },
        body: JSON.stringify({
          manualPriority: 92,
          overrideReason: 'VIP pallet obstructed; supervisor prioritized for immediate clearance',
        }),
        headers: {},
        multiValueHeaders: {},
        isBase64Encoded: false,
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: '',
      };

      const mockContext: HandlerContext = {
        correlationId: ulid(),
        authContext: {
          tenantId,
          userId: 'usr-supervisor-01',
          role: 'supervisor',
          email: 'supervisor@north-hub.local',
        },
      };

      const response = await handleUpdateIncident(mockEvent, mockContext, incidentRepo, timelineRepo);
      details.push(`PATCH response status: ${response.statusCode}`);

      // 3. Inspect updated record from DynamoDB
      const updatedIncident = await incidentRepo.getById(tenantId, incidentId);
      details.push(`Updated priorityScore: ${updatedIncident?.priorityScore} (Expected: 92)`);
      details.push(`Preserved scoreBreakdown total: ${updatedIncident?.scoreBreakdown.total} (Expected: 32)`);
      details.push(`Recorded manualPriority in metadata: ${updatedIncident?.metadata?.manualPriority}`);
      details.push(`Recorded overriddenBy: ${updatedIncident?.metadata?.overriddenBy}`);

      // 4. Query queue GSI1 to confirm position updated
      const queue = await incidentRepo.queryQueue(tenantId, 'NEW', { limit: 10 });
      const foundInQueue = queue.items.find((i) => i.id === incidentId);
      details.push(`Found in GSI1 queue with effective priority: ${foundInQueue?.priorityScore}`);

      // 5. Query timeline to confirm audit trail event
      const timelineEvents = await timelineRepo.listEvents(tenantId, incidentId);
      const overrideEvent = timelineEvents.items.find((e) => e.data?.action === 'PRIORITY_OVERRIDE');
      details.push(`Timeline event logged: ${overrideEvent ? 'YES (' + overrideEvent.data?.reason + ')' : 'NO'}`);

      const pass =
        updatedIncident?.priorityScore === 92 &&
        updatedIncident?.scoreBreakdown.total === 32 &&
        updatedIncident?.metadata?.overriddenBy === 'usr-supervisor-01' &&
        Boolean(overrideEvent);

      results.push({
        id: 7,
        title: 'Manual supervisor override updates queue priority while preserving computed score breakdown',
        status: pass ? 'PASS' : 'FAIL',
        details,
      });
      console.log(`Check 7 Result: ${pass ? 'PASS' : 'FAIL'}\n`);
    } catch (err) {
      results.push({
        id: 7,
        title: 'Manual supervisor override updates queue priority while preserving computed score breakdown',
        status: 'FAIL',
        details: [`Error in Check 7: ${err instanceof Error ? err.message : String(err)}`],
      });
      console.log('Check 7 Result: FAIL\n');
    }
  }

  // ---------------------------------------------------------------------------
  // Check 8: Tenant Weights Recomputation & GSI1 Queue Re-ordering
  // ---------------------------------------------------------------------------
  {
    console.log('--- Running Check 8: Tenant Weights Recalculation on Open Incidents ---');
    const details: string[] = [];
    const tenantId = 'north-hub';
    const incidentRepo = new IncidentRepository();
    const timelineRepo = new TimelineRepository();

    try {
      // Create 2 distinct open incidents with different profiles
      // Incident A: High Safety risk (95), Low Downtime (15)
      // Incident B: Low Safety risk (10), High Downtime (100)
      const incAId = ulid();
      const incBId = ulid();
      const now = new Date().toISOString();

      const incA: Incident = {
        id: incAId,
        tenantId,
        title: 'Chemical fumes near bay 2',
        description: 'Strong chemical vapor detected near bay 2 ammonia line',
        status: 'NEW',
        category: 'SAFETY_INCIDENT',
        severity: 'HIGH',
        priorityScore: 50,
        scoreBreakdown: calculatePriority({
          category: 'SAFETY_INCIDENT',
          severity: 'HIGH',
          createdAt: now,
          description: 'Strong chemical vapor detected near bay 2 ammonia line',
          estimatedStoppageMinutes: 5,
        }),
        confidence: 0.9,
        triageMode: 'AI',
        assetId: null,
        locationId: 'LOC-DOCK-2',
        assignedTeamId: null,
        ackDueAt: null,
        resolveDueAt: null,
        reporterId: 'usr-worker-test',
        tags: [],
        metadata: {},
        createdAt: now,
        updatedAt: now,
      };

      const incB: Incident = {
        id: incBId,
        tenantId,
        title: 'Long conveyor jam',
        description: 'Conveyor jammed with no safety risk, 90 mins downtime',
        status: 'NEW',
        category: 'EQUIPMENT_FAILURE',
        severity: 'MEDIUM',
        priorityScore: 50,
        scoreBreakdown: calculatePriority({
          category: 'EQUIPMENT_FAILURE',
          severity: 'MEDIUM',
          createdAt: now,
          description: 'Conveyor jammed with no safety risk',
          estimatedStoppageMinutes: 90,
        }),
        confidence: 0.9,
        triageMode: 'AI',
        assetId: null,
        locationId: 'LOC-DOCK-3',
        assignedTeamId: null,
        ackDueAt: null,
        resolveDueAt: null,
        reporterId: 'usr-worker-test',
        tags: [],
        metadata: {},
        createdAt: now,
        updatedAt: now,
      };

      await incidentRepo.create(tenantId, incA);
      await incidentRepo.create(tenantId, incB);

      details.push(`Initial Incident A (Safety-heavy) score: ${incA.scoreBreakdown.total}`);
      details.push(`Initial Incident B (Downtime-heavy) score: ${incB.scoreBreakdown.total}`);

      // Now apply safety-weighted tenant policy:
      // safetyRisk weight raised to 0.50, downtime lowered to 0.05
      const safetyWeightedPolicy = {
        businessImpact: 0.20,
        safetyRisk: 0.50,
        slaUrgency: 0.15,
        recurrence: 0.10,
        downtime: 0.05,
      };

      const rescoredResult = await recalculateOpenIncidents(
        tenantId,
        {
          weights: safetyWeightedPolicy,
          incidentRepo,
        },
      );
      details.push(`recalculateOpenIncidents updated ${rescoredResult.totalUpdated} open incidents`);

      // Fetch rescored incidents from DynamoDB
      const rescoredA = await incidentRepo.getById(tenantId, incAId);
      const rescoredB = await incidentRepo.getById(tenantId, incBId);

      details.push(`Rescored Incident A score: ${rescoredA?.priorityScore} (breakdown total: ${rescoredA?.scoreBreakdown.total})`);
      details.push(`Rescored Incident B score: ${rescoredB?.priorityScore} (breakdown total: ${rescoredB?.scoreBreakdown.total})`);

      // Query GSI1 queue in descending priority order
      const queue = await incidentRepo.queryQueue(tenantId, 'NEW', { limit: 100 });
      const idxA = queue.items.findIndex((i) => i.id === incAId);
      const idxB = queue.items.findIndex((i) => i.id === incBId);

      details.push(`GSI1 Queue position A (Safety): index ${idxA}`);
      details.push(`GSI1 Queue position B (Downtime): index ${idxB}`);

      // Under safety-weighted policy, Incident A (safety score ~95) should have higher priority than B
      const pass =
        rescoredResult.totalUpdated >= 2 &&
        (rescoredA?.priorityScore || 0) > (rescoredB?.priorityScore || 0) &&
        idxA !== -1 &&
        idxB !== -1 &&
        idxA < idxB;

      results.push({
        id: 8,
        title: 'Tenant custom weights trigger dynamic recalculation and GSI1 queue reordering',
        status: pass ? 'PASS' : 'FAIL',
        details,
      });
      console.log(`Check 8 Result: ${pass ? 'PASS' : 'FAIL'} (A score ${rescoredA?.priorityScore} vs B score ${rescoredB?.priorityScore}, queue index ${idxA} < ${idxB})\n`);
    } catch (err) {
      results.push({
        id: 8,
        title: 'Tenant custom weights trigger dynamic recalculation and GSI1 queue reordering',
        status: 'FAIL',
        details: [`Error in Check 8: ${err instanceof Error ? err.message : String(err)}`],
      });
      console.log('Check 8 Result: FAIL\n');
    }
  }

  // ---------------------------------------------------------------------------
  // Final Verification Summary
  // ---------------------------------------------------------------------------
  console.log('================================================================');
  console.log(' VERIFICATION SUMMARY');
  console.log('================================================================');
  let allPass = true;
  for (const r of results) {
    console.log(`Check ${r.id}: [${r.status}] ${r.title}`);
    for (const d of r.details) {
      console.log(`    ${d}`);
    }
    if (r.status !== 'PASS') allPass = false;
  }
  console.log('================================================================');
  console.log(`OVERALL STATUS: ${allPass ? 'ALL CHECKS PASSED (8/8)' : 'SOME CHECKS FAILED'}`);
  console.log('================================================================');

  if (!allPass) {
    process.exit(1);
  }
}

runVerification().catch((err) => {
  console.error('Unhandled error running verification suite:', err);
  process.exit(1);
});
