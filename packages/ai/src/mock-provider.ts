import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { TriageResult } from '@opslens/contracts';
import type {
  LLMProvider,
  TriageInput,
  TriageExecutionResult,
  EmbeddingResult,
  AnswerQueryResult,
  TokenUsage,
} from './types.js';
import { ruleBasedClassifier } from './rule-based-classifier.js';

export function hashText(text: string): string {
  return crypto.createHash('sha256').update(text.trim().toLowerCase()).digest('hex');
}

/**
 * Generates a deterministic pseudo-random 256-dim unit vector seeded by the text hash.
 * Uses semantic concept projections and feature hashing so that cosine similarity
 * between related operational issues (e.g. conveyor breakdowns) is meaningfully higher
 * than against unrelated topics (e.g. chemical spills or cold storage).
 */
export function generateDeterministicEmbedding(text: string, dimensions = 256): number[] {
  const normText = text.trim().toLowerCase();
  const vector = new Array(dimensions).fill(0);

  // 1. Text SHA-256 base noise (provides unique deterministic seed for every string)
  const baseHash = crypto.createHash('sha256').update(normText).digest();
  for (let i = 0; i < dimensions; i++) {
    const byte = baseHash[i % baseHash.length]!;
    vector[i] = ((byte / 255) * 2 - 1) * 0.08;
  }

  // 2. Semantic concept projections across dimensional subspaces
  const concepts: Record<string, number[]> = {
    equipment: [0, 10, 20, 30, 40, 50],
    conveyor: [0, 1, 10, 11, 20, 21, 30, 31, 60, 61],
    belt: [1, 2, 11, 12, 21, 22, 62],
    motor: [2, 3, 12, 13, 22, 23, 63],
    facility: [4, 14, 24, 34, 44, 54],
    safety: [5, 15, 25, 35, 45, 55],
    spill: [5, 6, 15, 16, 25, 26],
    inventory: [7, 17, 27, 37, 47, 57],
    operations: [8, 18, 28, 38, 48, 58],
    security: [9, 19, 29, 39, 49, 59],
    environmental: [3, 13, 23, 33, 43, 53],
    'conv-d4': [0, 1, 2, 60, 61, 62, 63, 64, 65, 70, 71],
    'loc-dock-4': [0, 60, 61, 70, 71, 72, 73],
    'dock 4': [0, 60, 61, 70, 71, 72, 73],
    dock: [70, 71, 72],
    tripped: [100, 101, 102],
    stopped: [100, 101, 103],
    stoppage: [100, 101, 103],
    packages: [110, 111, 112],
    piling: [110, 112, 113],
  };

  for (const [concept, dims] of Object.entries(concepts)) {
    if (normText.includes(concept)) {
      for (const d of dims) {
        vector[d % dimensions] += 0.55;
      }
    }
  }

  // 3. Word token feature hashing
  const words = normText.split(/[^a-z0-9_-]+/).filter((w) => w.length > 1);
  for (const word of words) {
    const wordHash = crypto.createHash('md5').update(word).digest();
    const dim1 = wordHash[0]! % dimensions;
    const dim2 = wordHash[1]! % dimensions;
    const sign1 = wordHash[2]! % 2 === 0 ? 1 : -1;
    const sign2 = wordHash[3]! % 2 === 0 ? 1 : -1;
    vector[dim1] += sign1 * 0.15;
    vector[dim2] += sign2 * 0.15;
  }

  // 4. L2 Normalization to unit vector
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return vector.map((v) => parseFloat((v / (norm || 1)).toFixed(6)));
}

interface FixtureItem {
  input: string;
  triageResult: TriageResult;
  embedding?: number[];
}

export class MockLLMProvider implements LLMProvider {
  public readonly providerName = 'mock' as const;
  private readonly fixtures: Record<string, FixtureItem> = {};
  public readonly modelId = 'mock-claude-3-haiku';
  public readonly embedModelId = 'mock-titan-embed-v2';

  constructor(fixturesPath?: string) {
    this.fixtures = this.loadFixtures(fixturesPath);
  }

  private loadFixtures(customPath?: string): Record<string, FixtureItem> {
    const candidatePaths = [
      customPath,
      path.resolve(process.cwd(), 'seed/llm-fixtures.json'),
      path.resolve(process.cwd(), '../seed/llm-fixtures.json'),
      path.resolve(process.cwd(), '../../seed/llm-fixtures.json'),
    ].filter(Boolean) as string[];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        try {
          const raw = fs.readFileSync(p, 'utf-8');
          return JSON.parse(raw);
        } catch {
          // Ignore and try next
        }
      }
    }
    return {};
  }

  async extractAndClassify(input: TriageInput): Promise<TriageExecutionResult> {
    const text = input.text || '';
    const hash = hashText(text);

    let triageResult: TriageResult;

    if (this.fixtures[hash]?.triageResult) {
      triageResult = {
        ...this.fixtures[hash]!.triageResult,
        triageMode: 'AI',
      };
    } else {
      const lower = text.toLowerCase();
      const isVague =
        lower.includes('something is wrong') ||
        lower.includes('near the back') ||
        lower.includes('vague report');
      const isClarified = lower.includes('clarification:') || lower.includes('clarification answer');

      if (isVague && !isClarified) {
        triageResult = {
          category: 'OPERATIONS',
          severity: 'LOW',
          locationId: null,
          assetId: null,
          summary: 'Vague operational anomaly reported near the back',
          impactSignals: ['unspecified_issue'],
          entities: {},
          recommendedFirstAction: 'Request clarification on equipment or specific bay area from worker.',
          confidence: 0.45,
          clarifyingQuestion: 'Can you specify which area or equipment is having an issue near the back?',
          triageMode: 'AI',
        };
      } else {
        // Return a deterministic derived response (keyword-based) rather than throwing
        const ruleResult = ruleBasedClassifier(text, input.context);
        triageResult = {
          ...ruleResult,
          triageMode: 'AI',
          confidence: 0.88,
          clarifyingQuestion: null,
        };
      }
    }

    const inputTokens = Math.max(10, Math.ceil(text.length / 4));
    const outputTokens = Math.max(20, Math.ceil(JSON.stringify(triageResult).length / 4));
    const tokenUsage: TokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    };

    return {
      result: triageResult,
      tokenUsage,
      modelId: this.modelId,
      attempts: 1,
    };
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const vector = generateDeterministicEmbedding(text, 256);

    const inputTokens = Math.max(1, Math.ceil(text.length / 4));
    return {
      vector,
      tokenUsage: {
        inputTokens,
        outputTokens: 0,
        totalTokens: inputTokens,
      },
      modelId: this.embedModelId,
    };
  }

  async answerQuery(question: string, context: string): Promise<AnswerQueryResult> {
    const cleanQ = question.trim();
    const cleanCtx = context.trim();

    const inputTokens = Math.max(5, Math.ceil((cleanQ.length + cleanCtx.length) / 4));

    let answer = `Based on current operational telemetry: ${cleanCtx ? cleanCtx.slice(0, 180) + '...' : 'no active anomalies noted'}. Recommended next action is to continue scheduled monitoring.`;
    const recommendedActions: string[] = ['Review shift logs', 'Confirm sensor telemetry'];

    if (cleanQ.toLowerCase().includes('conv-d4') || cleanQ.toLowerCase().includes('conveyor')) {
      answer = 'CONV-D4 has experienced recurring motor trips over the past 7 days. Immediate inspection of drive bearings and motor current limits is recommended before running peak volume.';
      recommendedActions.push('Dispatch Maintenance team to CONV-D4');
    } else if (cleanQ.toLowerCase().includes('cold store') || cleanQ.toLowerCase().includes('temp')) {
      answer = 'Cold Store A temperature sensors report normal range (+2C to +4C). Automated defrost cycle scheduled for 03:00.';
      recommendedActions.push('Verify evaporator fans');
    }

    const outputTokens = Math.max(15, Math.ceil(answer.length / 4));

    return {
      answer,
      tokenUsage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      modelId: this.modelId,
      sources: ['SEED-OPERATIONAL-CONTEXT', 'TELEMETRY-STREAM'],
      recommendedActions,
    };
  }
}
