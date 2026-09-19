import { IncidentRepository } from '../packages/data/src/index.js';
import type { Incident } from '@opslens/contracts';

async function main() {
  const repo = new IncidentRepository();
  const tenantId = 'north-hub';
  const status = 'ROUTED';

  console.log('[Check 3] Proving GSI1 ordering & zero-padding...');

  // Create an incident scored 9 and an incident scored 80 with status ROUTED
  const score80Incident: Incident = {
    id: '01HRXTEST_SCORE_80',
    tenantId,
    title: 'Dock 4 Conveyor High Priority Stoppage',
    description: 'High impact stoppage',
    status,
    category: 'EQUIPMENT',
    severity: 'HIGH',
    priorityScore: 80,
    scoreBreakdown: {
      businessImpact: { rawValue: 80, normalisedValue: 80, weight: 0.3, contribution: 24, explanation: '' },
      safetyRisk: { rawValue: 80, normalisedValue: 80, weight: 0.25, contribution: 20, explanation: '' },
      slaUrgency: { rawValue: 80, normalisedValue: 80, weight: 0.2, contribution: 16, explanation: '' },
      recurrence: { rawValue: 80, normalisedValue: 80, weight: 0.15, contribution: 12, explanation: '' },
      downtime: { rawValue: 80, normalisedValue: 80, weight: 0.1, contribution: 8, explanation: '' },
      totalScore: 80,
    },
    confidence: 0.95,
    triageMode: 'AI',
    assetId: 'CONV-D4',
    locationId: 'LOC-DOCK-4',
    assignedTeamId: 'TEAM-MAINT',
    ackDueAt: '2026-09-18T16:00:00.000Z',
    resolveDueAt: '2026-09-18T18:00:00.000Z',
    reporterId: 'usr-north-worker',
    tags: [],
    metadata: {},
    createdAt: '2026-09-18T12:00:00.000Z',
    updatedAt: '2026-09-18T12:00:00.000Z',
  };

  const score9Incident: Incident = {
    ...score80Incident,
    id: '01HRXTEST_SCORE_09',
    title: 'Low Priority Minor Spill in Aisle',
    description: 'Minor spill',
    priorityScore: 9,
    createdAt: '2026-09-18T12:01:00.000Z',
    updatedAt: '2026-09-18T12:01:00.000Z',
  };

  await repo.create(tenantId, score80Incident);
  await repo.create(tenantId, score9Incident);

  // Query GSI1 for open incidents (status ROUTED)
  const queue = await repo.queryQueue(tenantId, status, { limit: 100 });
  console.log(`Retrieved ${queue.items.length} open incidents from GSI1 for tenant=${tenantId}, status=${status}:`);

  queue.items.forEach((inc, idx) => {
    console.log(`  [${idx + 1}] ID: ${inc.id} | Score: ${inc.priorityScore} | Created: ${inc.createdAt}`);
  });

  // Check descending priority order
  let isStrictlyDescending = true;
  for (let i = 0; i < queue.items.length - 1; i++) {
    const curr = queue.items[i]!.priorityScore;
    const next = queue.items[i + 1]!.priorityScore;
    if (curr < next) {
      isStrictlyDescending = false;
      console.error(`Ordering violation at index ${i}: Score ${curr} appeared before Score ${next}!`);
    }
  }

  const idx80 = queue.items.findIndex((i) => i.id === score80Incident.id);
  const idx9 = queue.items.findIndex((i) => i.id === score9Incident.id);

  console.log(`Score 80 item index: ${idx80}`);
  console.log(`Score 9 item index: ${idx9}`);
  console.log(`Does score 80 sort above score 9? ${idx80 < idx9 ? 'YES (PASS)' : 'NO (FAIL)'}`);
  console.log(`Are priorities monotonically descending? ${isStrictlyDescending ? 'YES (PASS)' : 'NO (FAIL)'}`);

  if (!isStrictlyDescending || idx80 >= idx9) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
