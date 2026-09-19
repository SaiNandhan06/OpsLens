import { IncidentRepository, ReferenceRepository } from '../packages/data/src/index.js';

async function main() {
  const incidentRepo = new IncidentRepository();
  const refRepo = new ReferenceRepository();

  console.log('[Check 7] Verifying tenant isolation between north-hub and south-hub...\n');

  // 1. Incidents (Query GSI1 for RESOLVED)
  const northIncidents = await incidentRepo.queryQueue('north-hub', 'RESOLVED', { limit: 100 });
  const southIncidents = await incidentRepo.queryQueue('south-hub', 'RESOLVED', { limit: 100 });

  const northIncIds = northIncidents.items.map((i) => i.id);
  const southIncIds = southIncidents.items.map((i) => i.id);

  const incIntersection = northIncIds.filter((id) => southIncIds.includes(id));
  console.log(`North-hub RESOLVED incidents: ${northIncIds.length}`);
  console.log(`South-hub RESOLVED incidents: ${southIncIds.length}`);
  console.log(`Incident ID overlap count: ${incIntersection.length}`);

  // 2. Users
  const northUsers = await refRepo.listUsers('north-hub');
  const southUsers = await refRepo.listUsers('south-hub');

  const northUserIds = northUsers.map((u) => u.id);
  const southUserIds = southUsers.map((u) => u.id);

  const userIntersection = northUserIds.filter((id) => southUserIds.includes(id));
  console.log(`North-hub users: ${northUserIds.length}`);
  console.log(`South-hub users: ${southUserIds.length}`);
  console.log(`User ID overlap count: ${userIntersection.length}`);

  const totalOverlap = incIntersection.length + userIntersection.length;
  console.log(`\nTotal overlap between north-hub and south-hub items: ${totalOverlap}`);
  console.log(`Tenant isolation status: ${totalOverlap === 0 ? 'PASS (Zero overlap)' : 'FAIL (Data leak)'}`);

  if (totalOverlap > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
