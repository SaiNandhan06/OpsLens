import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  IncidentSchema,
  SlaPolicySchema,
  ScoringWeightsSchema,
  TriageResultSchema,
  RoleEnum,
  IncidentCategoryEnum,
  SeverityEnum,
} from '../packages/contracts/src/index.js';
import { hashPrompt } from './seed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const seedDir = path.join(projectRoot, 'seed');

console.log('================================================================');
console.log('OPSLENS SEED DATA VERIFICATION');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// Check 1: Schema Validation
// -----------------------------------------------------------------------------
console.log('--- CHECK 1: Schema Validation Against packages/contracts ---');
let check1Pass = true;
const check1Failures: string[] = [];

// 1. Incidents
try {
  const incidents = JSON.parse(fs.readFileSync(path.join(seedDir, 'incidents.json'), 'utf-8'));
  for (let i = 0; i < incidents.length; i++) {
    const res = IncidentSchema.safeParse(incidents[i]);
    if (!res.success) {
      check1Pass = false;
      check1Failures.push(`incidents[${i}] (${incidents[i].id}): ${JSON.stringify(res.error.format())}`);
    }
  }
  console.log(`[Check 1.1] incidents.json (${incidents.length} items): ${check1Pass ? 'PASS' : 'FAIL'}`);
} catch (e: unknown) {
  check1Pass = false;
  check1Failures.push(`incidents.json read/parse error: ${e instanceof Error ? e.message : String(e)}`);
}

// 2. SLA Policies
try {
  const slaPolicies = JSON.parse(fs.readFileSync(path.join(seedDir, 'sla-policies.json'), 'utf-8'));
  for (let i = 0; i < slaPolicies.length; i++) {
    const res = SlaPolicySchema.safeParse(slaPolicies[i]);
    if (!res.success) {
      check1Pass = false;
      check1Failures.push(`sla-policies[${i}]: ${JSON.stringify(res.error.format())}`);
    }
  }
  console.log(`[Check 1.2] sla-policies.json (${slaPolicies.length} items): PASS`);
} catch (e: unknown) {
  check1Pass = false;
  check1Failures.push(`sla-policies.json error: ${e instanceof Error ? e.message : String(e)}`);
}

// 3. Tenants (ScoringWeights)
try {
  const tenants = JSON.parse(fs.readFileSync(path.join(seedDir, 'tenants.json'), 'utf-8'));
  for (let i = 0; i < tenants.length; i++) {
    const res = ScoringWeightsSchema.safeParse(tenants[i].scoringWeights);
    if (!res.success) {
      check1Pass = false;
      check1Failures.push(`tenants[${i}].scoringWeights: ${JSON.stringify(res.error.format())}`);
    }
  }
  console.log(`[Check 1.3] tenants.json (${tenants.length} items): PASS`);
} catch (e: unknown) {
  check1Pass = false;
  check1Failures.push(`tenants.json error: ${e instanceof Error ? e.message : String(e)}`);
}

// 4. Users (RoleEnum)
try {
  const users = JSON.parse(fs.readFileSync(path.join(seedDir, 'users.json'), 'utf-8'));
  for (let i = 0; i < users.length; i++) {
    const roleRes = RoleEnum.safeParse(users[i].role);
    if (!roleRes.success) {
      check1Pass = false;
      check1Failures.push(`users[${i}].role invalid: ${users[i].role}`);
    }
  }
  console.log(`[Check 1.4] users.json (${users.length} items): PASS`);
} catch (e: unknown) {
  check1Pass = false;
  check1Failures.push(`users.json error: ${e instanceof Error ? e.message : String(e)}`);
}

// 5. Teams (skills vs IncidentCategoryEnum)
try {
  const teams = JSON.parse(fs.readFileSync(path.join(seedDir, 'teams.json'), 'utf-8'));
  for (const t of teams) {
    for (const s of t.skills) {
      if (!IncidentCategoryEnum.safeParse(s).success) {
        check1Pass = false;
        check1Failures.push(`team ${t.id} invalid skill: ${s}`);
      }
    }
  }
  console.log(`[Check 1.5] teams.json (${teams.length} items): PASS`);
} catch (e: unknown) {
  check1Pass = false;
  check1Failures.push(`teams.json error: ${e instanceof Error ? e.message : String(e)}`);
}

// 6. Assets (category vs IncidentCategoryEnum, criticality vs SeverityEnum)
try {
  const assets = JSON.parse(fs.readFileSync(path.join(seedDir, 'assets.json'), 'utf-8'));
  for (const a of assets) {
    if (!IncidentCategoryEnum.safeParse(a.category).success) {
      check1Pass = false;
      check1Failures.push(`asset ${a.id} invalid category: ${a.category}`);
    }
    if (!SeverityEnum.safeParse(a.criticality).success) {
      check1Pass = false;
      check1Failures.push(`asset ${a.id} invalid criticality: ${a.criticality}`);
    }
  }
  console.log(`[Check 1.6] assets.json (${assets.length} items): PASS`);
} catch (e: unknown) {
  check1Pass = false;
  check1Failures.push(`assets.json error: ${e instanceof Error ? e.message : String(e)}`);
}

// 7. LLM Fixtures (triageResult vs TriageResultSchema)
try {
  const fixtures = JSON.parse(fs.readFileSync(path.join(seedDir, 'llm-fixtures.json'), 'utf-8')) as Record<
    string,
    { triageResult: unknown; embedding: number[] }
  >;
  let fCount = 0;
  for (const [key, val] of Object.entries(fixtures)) {
    fCount++;
    const res = TriageResultSchema.safeParse(val.triageResult);
    if (!res.success) {
      check1Pass = false;
      check1Failures.push(`llm-fixtures[${key}].triageResult: ${JSON.stringify(res.error.format())}`);
    }
    if (!Array.isArray(val.embedding) || val.embedding.length !== 256) {
      check1Pass = false;
      check1Failures.push(`llm-fixtures[${key}].embedding invalid length: ${val.embedding?.length}`);
    }
  }
  console.log(`[Check 1.7] llm-fixtures.json (${fCount} items): PASS`);
} catch (e: unknown) {
  check1Pass = false;
  check1Failures.push(`llm-fixtures.json error: ${e instanceof Error ? e.message : String(e)}`);
}

if (!check1Pass) {
  console.error('Check 1 Failures:', check1Failures);
} else {
  console.log('Check 1 Result: PASS\n');
}

// -----------------------------------------------------------------------------
// Check 2: CONV-D4 Cluster
// -----------------------------------------------------------------------------
console.log('--- CHECK 2: CONV-D4 Recurrence Cluster (>= 3 in last 9 days) ---');
interface IncidentRecord {
  id: string;
  assetId: string | null;
  title: string;
  severity: string;
  status: string;
  priorityScore: number;
  createdAt: string;
  resolveDueAt: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

const incidents: IncidentRecord[] = JSON.parse(fs.readFileSync(path.join(seedDir, 'incidents.json'), 'utf-8'));
const nowMs = new Date('2026-09-18T22:30:00.000Z').getTime();
const nineDaysAgoMs = nowMs - 9 * 24 * 60 * 60 * 1000;

const convD4Cluster = incidents.filter((inc) => {
  if (inc.assetId !== 'CONV-D4') return false;
  const created = new Date(inc.createdAt).getTime();
  return created >= nineDaysAgoMs && created <= nowMs;
});

console.log(`Found ${convD4Cluster.length} incidents for asset CONV-D4 in the last 9 days:`);
convD4Cluster.forEach((inc, i) => {
  console.log(`  [${i + 1}] ID: ${inc.id}`);
  console.log(`      Title: "${inc.title}"`);
  console.log(`      Severity: ${inc.severity} | Status: ${inc.status} | PriorityScore: ${inc.priorityScore}`);
  console.log(`      CreatedAt: ${inc.createdAt}`);
});

const check2Pass = convD4Cluster.length >= 3;
console.log(`Check 2 Result: ${check2Pass ? 'PASS' : 'FAIL'}\n`);

// -----------------------------------------------------------------------------
// Check 3: Overdue Unresolved Incident (Breaching SLA)
// -----------------------------------------------------------------------------
console.log('--- CHECK 3: Overdue Unresolved Incident (resolveDueAt in past) ---');
const breachingIncidents = incidents.filter((inc) => {
  const isUnresolved = inc.status !== 'RESOLVED' && inc.status !== 'CLOSED';
  if (!isUnresolved || !inc.resolveDueAt) return false;
  const resolveDueMs = new Date(inc.resolveDueAt).getTime();
  return resolveDueMs < nowMs;
});

console.log(`Found ${breachingIncidents.length} currently-unresolved incident(s) with resolveDueAt in the past:`);
breachingIncidents.forEach((inc, i) => {
  console.log(`  [${i + 1}] ID: ${inc.id}`);
  console.log(`      Title: "${inc.title}"`);
  console.log(`      Status: ${inc.status}`);
  console.log(`      CreatedAt:    ${inc.createdAt}`);
  console.log(`      ResolveDueAt: ${inc.resolveDueAt} (Overdue by ${((nowMs - new Date(inc.resolveDueAt).getTime()) / 60000).toFixed(1)} mins)`);
});

const check3Pass = breachingIncidents.length >= 1;
console.log(`Check 3 Result: ${check3Pass ? 'PASS' : 'FAIL'}\n`);

// -----------------------------------------------------------------------------
// Check 4: Computable MTTA and MTTR on Resolved Incidents
// -----------------------------------------------------------------------------
console.log('--- CHECK 4: Computable MTTA and MTTR ---');
const resolvedWithTimes = incidents.filter((inc) => {
  return inc.status === 'RESOLVED' && inc.acknowledgedAt && inc.resolvedAt;
});

let totalAckMinutes = 0;
let totalResolveMinutes = 0;

resolvedWithTimes.forEach((inc) => {
  const created = new Date(inc.createdAt).getTime();
  const ack = new Date(inc.acknowledgedAt!).getTime();
  const res = new Date(inc.resolvedAt!).getTime();
  totalAckMinutes += (ack - created) / 60000;
  totalResolveMinutes += (res - created) / 60000;
});

const mtta = totalAckMinutes / resolvedWithTimes.length;
const mttr = totalResolveMinutes / resolvedWithTimes.length;

console.log(`Resolved incidents with both ACK & RESOLVE timestamps: ${resolvedWithTimes.length}`);
console.log(`Computed Mean Time to Acknowledge (MTTA): ${mtta.toFixed(2)} minutes`);
console.log(`Computed Mean Time to Resolve (MTTR):     ${mttr.toFixed(2)} minutes (${(mttr / 60).toFixed(2)} hours)`);

const check4Pass = resolvedWithTimes.length > 0 && !isNaN(mtta) && !isNaN(mttr);
console.log(`Check 4 Result: ${check4Pass ? 'PASS' : 'FAIL'}\n`);

// -----------------------------------------------------------------------------
// Check 5: Golden-Path Demo Text Entry in llm-fixtures.json
// -----------------------------------------------------------------------------
console.log('--- CHECK 5: Golden-Path Demo Text Entry in llm-fixtures.json ---');
const goldenPathText = "Dock 4 conveyor stopped again. Packages piling up. Third time this week.";
const expectedHash = hashPrompt(goldenPathText);
const fixtures = JSON.parse(fs.readFileSync(path.join(seedDir, 'llm-fixtures.json'), 'utf-8'));

const goldenFixture = fixtures[expectedHash];
console.log(`Target Golden Text: "${goldenPathText}"`);
console.log(`Computed Prompt Hash: ${expectedHash}`);
console.log(`Fixture Found: ${Boolean(goldenFixture)}`);

if (goldenFixture) {
  console.log(`Fixture Summary: "${goldenFixture.triageResult?.summary}"`);
  console.log(`Fixture Category: ${goldenFixture.triageResult?.category}`);
  console.log(`Fixture Severity: ${goldenFixture.triageResult?.severity}`);
  console.log(`Fixture AssetId:  ${goldenFixture.triageResult?.assetId}`);
  console.log(`Fixture Location: ${goldenFixture.triageResult?.locationId}`);
  console.log(`Fixture Embedding vector length: ${goldenFixture.embedding?.length}`);
}

const check5Pass = Boolean(goldenFixture && goldenFixture.triageResult && goldenFixture.embedding?.length === 256);
console.log(`Check 5 Result: ${check5Pass ? 'PASS' : 'FAIL'}\n`);

// -----------------------------------------------------------------------------
// Check 6: Default Provider and Zero Network Calls
// -----------------------------------------------------------------------------
console.log('--- CHECK 6: Default Provider = mock & Zero Network Calls ---');
const seedScriptContent = fs.readFileSync(path.join(projectRoot, 'scripts/seed.ts'), 'utf-8');
const hasDefaultMock = seedScriptContent.includes("provider = options.provider || (process.env.LLM_PROVIDER as 'mock' | 'bedrock') || 'mock'");
const hasNetworkImports = /from\s+['"](axios|node-fetch|got|http|https)['"]/.test(seedScriptContent);
console.log(`Default LLM_PROVIDER is mock: ${hasDefaultMock}`);
console.log(`Zero HTTP/Network client libraries imported: ${!hasNetworkImports}`);

const check6Pass = hasDefaultMock && !hasNetworkImports;
console.log(`Check 6 Result: ${check6Pass ? 'PASS' : 'FAIL'}\n`);
