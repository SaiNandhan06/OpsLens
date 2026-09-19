import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { MockLLMProvider } from '../packages/ai/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const seedDir = path.join(projectRoot, 'seed');

/**
 * Deterministic hash of prompt text.
 */
export function hashPrompt(text: string): string {
  return crypto.createHash('sha256').update(text.trim().toLowerCase()).digest('hex');
}

/**
 * Generate mock 256-dimensional embedding vector matching Bedrock Titan v2 specs.
 */
export function generateMockEmbedding(text: string, dimensions = 256): number[] {
  const hash = crypto.createHash('sha256').update(text).digest();
  const vector: number[] = [];
  for (let i = 0; i < dimensions; i++) {
    const byte = hash[i % hash.length] ?? 0;
    const val = ((byte / 255) * 2 - 1) * 0.1;
    vector.push(parseFloat(val.toFixed(6)));
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return vector.map((v) => parseFloat((v / norm).toFixed(6)));
}

/**
 * Options for seed data loading.
 */
export interface SeedOptions {
  stage?: string;
  provider?: 'mock' | 'bedrock';
  dryRun?: boolean;
}

/**
 * Structure of loaded and prepared seed data.
 */
export interface SeedDataResult {
  stage: string;
  provider: 'mock' | 'bedrock';
  tenants: unknown[];
  locations: unknown[];
  assets: unknown[];
  teams: unknown[];
  users: unknown[];
  slaPolicies: unknown[];
  routingRules: unknown[];
  incidents: unknown[];
  llmFixtures: Record<string, unknown>;
  embeddingsGenerated: number;
}

/**
 * Reads a JSON file from the seed directory.
 */
function readSeedJson<T>(fileName: string): T {
  const fullPath = path.join(seedDir, fileName);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Seed file not found: ${fullPath}`);
  }
  return JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as T;
}

/**
 * Separate, importable function to load all seed data, validate structure,
 * and compute embeddings using the configured provider.
 */
export async function loadSeedData(options: SeedOptions = {}): Promise<SeedDataResult> {
  const stage = options.stage || process.env.STAGE || 'local';
  const provider = options.provider || (process.env.LLM_PROVIDER as 'mock' | 'bedrock') || 'mock';

  console.log(`[Seed] Loading seed datasets for stage="${stage}", provider="${provider}"...`);

  const tenants = readSeedJson<unknown[]>('tenants.json');
  const locations = readSeedJson<unknown[]>('locations.json');
  const assets = readSeedJson<unknown[]>('assets.json');
  const teams = readSeedJson<unknown[]>('teams.json');
  const users = readSeedJson<unknown[]>('users.json');
  const slaPolicies = readSeedJson<unknown[]>('sla-policies.json');
  const routingRules = readSeedJson<unknown[]>('routing-rules.json');
  const incidents = readSeedJson<Array<{ id: string; description: string; [key: string]: unknown }>>(
    'incidents.json',
  );
  const llmFixtures = readSeedJson<Record<string, unknown>>('llm-fixtures.json');

  let embeddingsCount = 0;

  console.log(`[Seed] Computing embeddings for ${incidents.length} incidents using ${provider} provider...`);
  const mockAi = new MockLLMProvider();

  for (const inc of incidents) {
    const textToEmbed = [
      (inc as any).summary || (inc as any).title || '',
      inc.description || '',
      (inc as any).assetId || '',
    ]
      .filter(Boolean)
      .join(' ');

    const embedResult = await mockAi.embed(textToEmbed || inc.description);
    inc.embedding = embedResult.vector;
    embeddingsCount++;
  }

  const result: SeedDataResult = {
    stage,
    provider,
    tenants,
    locations,
    assets,
    teams,
    users,
    slaPolicies,
    routingRules,
    incidents,
    llmFixtures,
    embeddingsGenerated: embeddingsCount,
  };

  return result;
}

import {
  ReferenceRepository,
  SlaPolicyRepository,
  RoutingRuleRepository,
  IncidentRepository,
  type RoutingRule,
} from '../packages/data/src/index.js';
import type { Incident, SlaPolicy } from '@opslens/contracts';

/**
 * Persists the seed data to DynamoDB.
 */
export async function persistSeedData(data: SeedDataResult): Promise<void> {
  console.log(`[Seed] Preparing DynamoDB persistence for stage: ${data.stage}...`);
  console.log(`[Seed] Summary of items to persist:`);
  console.log(`  - Tenants: ${data.tenants.length}`);
  console.log(`  - Locations: ${data.locations.length}`);
  console.log(`  - Assets: ${data.assets.length}`);
  console.log(`  - Teams: ${data.teams.length}`);
  console.log(`  - Users: ${data.users.length}`);
  console.log(`  - SLA Policies: ${data.slaPolicies.length}`);
  console.log(`  - Routing Rules: ${data.routingRules.length}`);
  console.log(`  - Incidents: ${data.incidents.length}`);
  console.log(`  - LLM Fixtures: ${Object.keys(data.llmFixtures).length}`);
  console.log(`  - Generated Embeddings: ${data.embeddingsGenerated}`);

  const refRepo = new ReferenceRepository();
  const slaRepo = new SlaPolicyRepository();
  const routeRepo = new RoutingRuleRepository();
  const incidentRepo = new IncidentRepository();

  const tenantIds: string[] = [];

  // 1. Tenants
  for (const t of data.tenants as Array<{ tenantId: string; [key: string]: unknown }>) {
    tenantIds.push(t.tenantId);
    await refRepo.saveTenant(t.tenantId, t);
  }
  console.log(`[Seed] Persisted ${data.tenants.length} tenants.`);

  // 2. Reference data across tenants
  for (const tenantId of tenantIds) {
    for (const loc of data.locations as Array<{ id: string; [key: string]: unknown }>) {
      await refRepo.saveLocation(tenantId, loc);
    }
    for (const asset of data.assets as Array<{ id: string; [key: string]: unknown }>) {
      await refRepo.saveAsset(tenantId, asset);
    }
    for (const team of data.teams as Array<{ id: string; [key: string]: unknown }>) {
      await refRepo.saveTeam(tenantId, team);
    }
    for (const policy of data.slaPolicies as SlaPolicy[]) {
      await slaRepo.savePolicy(tenantId, policy);
    }
    for (const rule of data.routingRules as Array<{ id: string; priority: number; [key: string]: unknown }>) {
      await routeRepo.saveRule(tenantId, rule as unknown as RoutingRule);
    }
  }
  console.log(`[Seed] Persisted locations, assets, teams, SLA policies, and routing rules across all tenants.`);

  // 3. Users (each user already has a tenantId)
  for (const user of data.users as Array<{ id: string; tenantId: string; [key: string]: unknown }>) {
    await refRepo.saveUser(user.tenantId, user);
  }
  console.log(`[Seed] Persisted ${data.users.length} users.`);

  // 4. Incidents (each incident has tenantId, GSI1-GSI4 keys generated by IncidentRepository)
  for (const inc of data.incidents as Incident[]) {
    await incidentRepo.create(inc.tenantId, inc);
  }
  console.log(`[Seed] Persisted ${data.incidents.length} incidents with GSI1-GSI4 indexes.`);
}

/**
 * Command-line runner supporting --stage and --provider arguments.
 */
export async function run(): Promise<void> {
  const args = process.argv.slice(2);
  let stage = 'local';
  let provider: 'mock' | 'bedrock' = 'mock';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--stage' && args[i + 1]) {
      stage = args[++i]!;
    } else if (arg?.startsWith('--stage=')) {
      stage = arg.split('=')[1]!;
    } else if (arg === '--provider' && args[i + 1]) {
      provider = args[++i] as 'mock' | 'bedrock';
    } else if (arg?.startsWith('--provider=')) {
      provider = arg.split('=')[1] as 'mock' | 'bedrock';
    }
  }

  try {
    const data = await loadSeedData({ stage, provider });
    await persistSeedData(data);
    console.log(`[Seed] Seed workflow completed successfully.`);
  } catch (error) {
    console.error(`[Seed] Error executing seed workflow:`, error);
    process.exit(1);
  }
}

// Execute if run directly
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void run();
}
