import type { IncidentCategory, Severity, TriageResult } from '@opslens/contracts';

interface RuleMatch {
  category: IncidentCategory;
  keywords: string[];
  recommendedAction: string;
}

const CATEGORY_RULES: RuleMatch[] = [
  {
    category: 'SAFETY',
    keywords: [
      'spill',
      'slip',
      'trip',
      'hazard',
      'chemical',
      'injury',
      'hurt',
      'blood',
      'fire',
      'smoke',
      'first aid',
      'guardrail',
      'oil puddle',
      'acid',
      'ppe',
      'unsafe',
    ],
    recommendedAction: 'Dispatch Safety/EHS team immediately to cordon off the hazard area and render assistance.',
  },
  {
    category: 'EQUIPMENT',
    keywords: [
      'conveyor',
      'motor',
      'belt',
      'roller',
      'forklift',
      'scanner',
      'sensor',
      'drive',
      'gearbox',
      'machinery',
      'tripped',
      'jam',
      'bearing',
      'chain',
      'pulley',
      'conv-d4',
      'pallet jack',
      'breaker',
    ],
    recommendedAction: 'Dispatch Maintenance engineering team to inspect drive motor and perform mechanical diagnostics.',
  },
  {
    category: 'FACILITY',
    keywords: [
      'dock door',
      'door',
      'lighting',
      'light',
      'roof',
      'leak',
      'plumbing',
      'hvac',
      'ramp',
      'dock leveler',
      'overhead',
      'sprinkler',
      'pipe',
      'power outage',
      'gate',
    ],
    recommendedAction: 'Dispatch Facilities team to inspect building infrastructure and execute physical repairs.',
  },
  {
    category: 'ENVIRONMENTAL',
    keywords: [
      'temperature',
      'humidity',
      'cold store',
      'freezer',
      'refrigerant',
      'ammonia',
      'fumes',
      'odor',
      'weather',
      'rain',
      'freeze',
      'defrost',
    ],
    recommendedAction: 'Dispatch Facilities & HVAC technician to inspect cooling coils and verify climate controls.',
  },
  {
    category: 'INVENTORY',
    keywords: [
      'damaged carton',
      'crushed pallet',
      'damaged box',
      'crushed',
      'stock',
      'sku',
      'barcode',
      'torn',
      'inventory',
      'package',
      'merchandise',
    ],
    recommendedAction: 'Dispatch Inventory QA team to assess cargo condition, segregate damaged SKUs, and re-label.',
  },
  {
    category: 'SECURITY',
    keywords: [
      'unauthorized',
      'badge',
      'access',
      'theft',
      'stolen',
      'intruder',
      'tailgating',
      'perimeter',
      'lock',
      'breach',
      'camera',
      'trespass',
    ],
    recommendedAction: 'Dispatch Facility Security team to review surveillance footage and verify perimeter integrity.',
  },
  {
    category: 'OPERATIONS',
    keywords: [
      'bottleneck',
      'delay',
      'backlog',
      'congestion',
      'turnaround',
      'shift',
      'staging',
      'queue',
      'throughput',
      'slow',
      'stuck',
      'blocked',
      'piling up',
    ],
    recommendedAction: 'Dispatch Logistics Operations supervisor to clear staging congestion and rebalance workload.',
  },
];

const SEVERITY_RULES: Array<{ severity: Severity; keywords: string[] }> = [
  {
    severity: 'CRITICAL',
    keywords: ['fire', 'injury', 'explosion', 'chemical leak', 'ammonia', 'acid spill', 'fatal', 'evacuate', 'emergency'],
  },
  {
    severity: 'HIGH',
    keywords: ['stopped', 'halted', 'blocked', 'down', 'third time', 'repeated', 'failure', 'shutdown', 'smoke', 'high temp'],
  },
  {
    severity: 'MEDIUM',
    keywords: ['delay', 'damaged', 'tripped', 'slow', 'warning', 'piling up', 'congestion', 'leak', 'jammed'],
  },
];

const LOCATION_PATTERNS: Array<{ id: string; patterns: RegExp[] }> = [
  { id: 'LOC-DOCK-4', patterns: [/dock\s*(?:door\s*)?4/i, /loc-dock-4/i] },
  { id: 'LOC-DOCK-3', patterns: [/dock\s*(?:door\s*)?3/i, /loc-dock-3/i] },
  { id: 'LOC-DOCK-2', patterns: [/dock\s*(?:door\s*)?2/i, /loc-dock-2/i] },
  { id: 'LOC-DOCK-1', patterns: [/dock\s*(?:door\s*)?1/i, /loc-dock-1/i] },
  { id: 'LOC-COLD-STORE-A', patterns: [/cold\s*store/i, /freezer/i, /loc-cold-store-a/i] },
  { id: 'LOC-PICK-1', patterns: [/pick\s*zone\s*1/i, /pick\s*1/i, /loc-pick-1/i] },
  { id: 'LOC-PICK-2', patterns: [/pick\s*zone\s*2/i, /pick\s*2/i, /loc-pick-2/i] },
  { id: 'LOC-LOADING-BAY', patterns: [/loading\s*bay/i, /loc-loading-bay/i, /staging\s*bay/i] },
];

const ASSET_PATTERNS: Array<{ id: string; patterns: RegExp[] }> = [
  { id: 'CONV-D4', patterns: [/conv-d4/i, /conveyor\s*(?:4|belt\s*4|at\s*dock\s*4)/i] },
  { id: 'FORK-01', patterns: [/fork-01/i, /forklift\s*1/i] },
  { id: 'FORK-02', patterns: [/fork-02/i, /forklift\s*2/i] },
  { id: 'FORK-03', patterns: [/fork-03/i, /forklift\s*3/i] },
  { id: 'SCAN-01', patterns: [/scan-01/i, /scanner\s*1/i] },
  { id: 'SCAN-02', patterns: [/scan-02/i, /scanner\s*2/i] },
  { id: 'CSU-01', patterns: [/csu-01/i, /cold\s*store\s*unit/i] },
];

/**
 * Deterministic rule-based fallback classifier.
 * Matches keywords and asset patterns over the 7 incident categories.
 * Returns a valid TriageResult with triageMode="FALLBACK" and confidence=0.3.
 */
export function ruleBasedClassifier(
  text: string,
  context?: { locationId?: string; assetId?: string },
): TriageResult {
  const normalized = text.toLowerCase();
  const matchedSignals: string[] = [];
  const entities: Record<string, string> = {};

  // 1. Detect Category
  let detectedCategory: IncidentCategory = 'OPERATIONS';
  let recommendedAction = 'Dispatch Logistics Operations supervisor to assess situation.';
  let bestScore = 0;

  for (const rule of CATEGORY_RULES) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (normalized.includes(kw)) {
        score++;
        matchedSignals.push(kw);
      }
    }
    if (score > bestScore) {
      bestScore = score;
      detectedCategory = rule.category;
      recommendedAction = rule.recommendedAction;
    }
  }

  // 2. Detect Severity
  let detectedSeverity: Severity = 'LOW';
  for (const sevRule of SEVERITY_RULES) {
    if (sevRule.keywords.some((kw) => normalized.includes(kw))) {
      detectedSeverity = sevRule.severity;
      break;
    }
  }

  // 3. Detect Location
  let detectedLocation: string | null = context?.locationId || null;
  for (const loc of LOCATION_PATTERNS) {
    if (loc.patterns.some((re) => re.test(text))) {
      detectedLocation = loc.id;
      entities.location = loc.id;
      break;
    }
  }

  // 4. Detect Asset
  let detectedAsset: string | null = context?.assetId || null;
  for (const asset of ASSET_PATTERNS) {
    if (asset.patterns.some((re) => re.test(text))) {
      detectedAsset = asset.id;
      entities.asset = asset.id;
      break;
    }
  }

  // 5. Generate concise summary
  const cleanSummary = text.trim().split(/[.\n]/)[0]?.substring(0, 100).trim() || 'Warehouse operational incident';

  return {
    category: detectedCategory,
    severity: detectedSeverity,
    locationId: detectedLocation,
    assetId: detectedAsset,
    summary: cleanSummary,
    impactSignals: matchedSignals.length > 0 ? Array.from(new Set(matchedSignals)).slice(0, 5) : ['operational_anomaly'],
    entities,
    recommendedFirstAction: recommendedAction,
    confidence: 0.3,
    clarifyingQuestion: null,
    triageMode: 'FALLBACK',
  };
}
