import { IncidentRepository } from '../packages/data/src/index.js';

async function main() {
  const repo = new IncidentRepository();
  const tenantId = 'north-hub';

  console.log('[Check 2] Proving GSI3 sparseness...');
  const before = await repo.queryActiveSla(tenantId);
  console.log(`Initial GSI3 active SLA incident count: ${before.items.length}`);

  if (before.items.length === 0) {
    throw new Error('No active SLA incidents found in GSI3 for north-hub to test with.');
  }

  const target = before.items[0]!;
  console.log(`Target incident to resolve: id=${target.id}, status=${target.status}, ackDueAt=${target.ackDueAt}, resolveDueAt=${target.resolveDueAt}`);

  // Resolve target incident
  await repo.updateStatus(tenantId, target.id, 'RESOLVED', {
    resolvedAt: new Date().toISOString(),
  });
  console.log(`Resolved incident ${target.id}.`);

  // Query GSI3 again
  const after = await repo.queryActiveSla(tenantId);
  console.log(`After resolution GSI3 active SLA incident count: ${after.items.length}`);

  const existsAfter = after.items.some((i) => i.id === target.id);
  console.log(`Is target incident ${target.id} present in GSI3? ${existsAfter ? 'YES (FAIL)' : 'NO (GONE - PASS)'}`);
  console.log(`Count difference: ${before.items.length} -> ${after.items.length} (-${before.items.length - after.items.length})`);

  if (existsAfter || after.items.length !== before.items.length - 1) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
