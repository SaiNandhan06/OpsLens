import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as BedrockSdk from '@aws-sdk/client-bedrock-runtime';
import {
  MockLLMProvider,
  BedrockLLMProvider,
  createLLMProvider,
  ruleBasedClassifier,
  stripMarkdownFences,
  parseAndValidateTriageResponse,
  executeTriageWithRepairRetry,
  LlmSchemaError,
  generateDeterministicEmbedding,
  TRIAGE_MAX_TOKENS,
  COPILOT_MAX_TOKENS,
  bedrockClientConstructedCount,
  resetBedrockConstructionCount,
} from '../src/index.js';

describe('packages/ai', () => {
  describe('Rule-Based Classifier', () => {
    it('classifies equipment issues and detects asset CONV-D4 and location LOC-DOCK-4', () => {
      const text = 'Conveyor belt 4 motor tripped once during morning shift at Dock 4. Reset manually.';
      const res = ruleBasedClassifier(text);

      expect(res.category).toBe('EQUIPMENT');
      expect(res.severity).toBe('MEDIUM');
      expect(res.assetId).toBe('CONV-D4');
      expect(res.locationId).toBe('LOC-DOCK-4');
      expect(res.triageMode).toBe('FALLBACK');
      expect(res.confidence).toBe(0.3);
      expect(res.impactSignals.length).toBeGreaterThan(0);
      expect(res.recommendedFirstAction).toContain('Maintenance');
    });

    it('classifies safety hazards with CRITICAL severity for chemical spill', () => {
      const text = 'Severe chemical leak and acid spill in aisle 3. Worker slip injury reported.';
      const res = ruleBasedClassifier(text);

      expect(res.category).toBe('SAFETY');
      expect(res.severity).toBe('CRITICAL');
      expect(res.triageMode).toBe('FALLBACK');
      expect(res.confidence).toBe(0.3);
      expect(res.recommendedFirstAction).toContain('Safety/EHS');
    });

    it('classifies inventory damage and identifies cartons', () => {
      const text = 'Pallet fell over. Damaged cartons and crushed merchandise across pick zone 1.';
      const res = ruleBasedClassifier(text);

      expect(res.category).toBe('INVENTORY');
      expect(res.locationId).toBe('LOC-PICK-1');
      expect(res.triageMode).toBe('FALLBACK');
    });

    it('classifies facility issues (overhead lights and dock door)', () => {
      const text = 'Dock door 2 hydraulic leveler stuck. Overhead lighting out.';
      const res = ruleBasedClassifier(text);

      expect(res.category).toBe('FACILITY');
      expect(res.locationId).toBe('LOC-DOCK-2');
    });

    it('classifies environmental issues (cold store temperature)', () => {
      const text = 'Cold store temperature rising rapidly due to refrigerant coils defrosted.';
      const res = ruleBasedClassifier(text);

      expect(res.category).toBe('ENVIRONMENTAL');
      expect(res.locationId).toBe('LOC-COLD-STORE-A');
    });
  });

  describe('Response Parser and Repair Retry', () => {
    it('defensively strips markdown code fences and whitespace', () => {
      const rawWithFences = '```json\n{"category":"EQUIPMENT","severity":"HIGH"}\n```';
      expect(stripMarkdownFences(rawWithFences)).toBe('{"category":"EQUIPMENT","severity":"HIGH"}');

      const rawWithProse = 'Here is your JSON:\n```\n{"category":"SAFETY"}\n```\nHope that helps!';
      expect(stripMarkdownFences(rawWithProse)).toBe('{"category":"SAFETY"}');
    });

    it('validates conforming TriageResult JSON', () => {
      const validJson = JSON.stringify({
        category: 'EQUIPMENT',
        severity: 'HIGH',
        locationId: 'LOC-DOCK-4',
        assetId: 'CONV-D4',
        summary: 'Dock 4 conveyor jammed',
        impactSignals: ['jammed', 'conveyor'],
        entities: { asset: 'CONV-D4' },
        recommendedFirstAction: 'Check motor relay',
        confidence: 0.95,
        clarifyingQuestion: null,
        triageMode: 'AI',
      });

      const parsed = parseAndValidateTriageResponse(validJson);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.category).toBe('EQUIPMENT');
        expect(parsed.data.confidence).toBe(0.95);
      }
    });

    it('retries ONCE on validation failure and succeeds if repaired', async () => {
      let callCount = 0;
      const invoker = async (_prompt: string, isRetry: boolean) => {
        callCount++;
        if (!isRetry) {
          // First attempt returns invalid JSON (missing summary, invalid category)
          return {
            rawText: '{"category": "INVALID_CAT", "severity": "HIGH"}',
            tokenUsage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
          };
        }
        // Second attempt returns valid JSON
        return {
          rawText: JSON.stringify({
            category: 'EQUIPMENT',
            severity: 'HIGH',
            locationId: 'LOC-DOCK-4',
            assetId: 'CONV-D4',
            summary: 'Repaired conveyor breakdown',
            impactSignals: ['breakdown'],
            entities: {},
            recommendedFirstAction: 'Inspect belt',
            confidence: 0.92,
            clarifyingQuestion: null,
            triageMode: 'AI',
          }),
          tokenUsage: { inputTokens: 80, outputTokens: 40, totalTokens: 120 },
        };
      };

      const result = await executeTriageWithRepairRetry(invoker, 'initial-prompt');
      expect(callCount).toBe(2);
      expect(result.attempts).toBe(2);
      expect(result.result.category).toBe('EQUIPMENT');
      expect(result.tokenUsage.totalTokens).toBe(190);
    });

    it('throws typed LlmSchemaError on second failure', async () => {
      const invoker = async () => ({
        rawText: '{"bad": "still invalid"}',
        tokenUsage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      });

      await expect(executeTriageWithRepairRetry(invoker, 'initial-prompt')).rejects.toThrow(
        LlmSchemaError,
      );
    });
  });

  describe('MockLLMProvider', () => {
    const mock = new MockLLMProvider();

    it('matches golden path demo text from seed/llm-fixtures.json', async () => {
      const goldenPath = 'Dock 4 conveyor stopped again. Packages piling up. Third time this week.';
      const triage = await mock.extractAndClassify({ text: goldenPath });

      expect(triage.result.category).toBe('EQUIPMENT');
      expect(triage.result.severity).toBe('HIGH');
      expect(triage.result.assetId).toBe('CONV-D4');
      expect(triage.result.locationId).toBe('LOC-DOCK-4');
      expect(triage.tokenUsage.totalTokens).toBeGreaterThan(0);
      expect(triage.modelId).toBe('mock-claude-3-haiku');
    });

    it('returns a deterministic derived response for unknown inputs rather than throwing', async () => {
      const unknownText = 'Unknown forklift hydraulic leak observed near dock 1 with slow hydraulic fluid drip.';
      const triage = await mock.extractAndClassify({ text: unknownText });

      expect(triage.result).toBeDefined();
      expect(triage.result.category).toBe('EQUIPMENT');
      expect(triage.result.triageMode).toBe('AI');
      expect(triage.tokenUsage.totalTokens).toBeGreaterThan(0);
    });

    it('produces a normalized 256-dim unit vector seeded by text hash', async () => {
      const text = 'Dock 4 conveyor motor failure';
      const embedding = await mock.embed(text);

      expect(embedding.vector.length).toBe(256);

      // Verify unit vector (Euclidean norm ≈ 1.0)
      const norm = Math.sqrt(embedding.vector.reduce((sum, v) => sum + v * v, 0));
      expect(Math.abs(norm - 1.0)).toBeLessThan(0.01);

      // Verify stability across calls
      const embedding2 = await mock.embed(text);
      expect(embedding.vector).toEqual(embedding2.vector);
    });

    it('computes cosine similarity accurately with deterministic embeddings', () => {
      const textA = 'Conveyor motor failure at dock 4';
      const textB = 'Conveyor motor failure at dock 4';
      const textC = 'Chemical spill and safety hazard in aisle 9';

      const vecA = generateDeterministicEmbedding(textA);
      const vecB = generateDeterministicEmbedding(textB);
      const vecC = generateDeterministicEmbedding(textC);

      const cosineSim = (v1: number[], v2: number[]) =>
        v1.reduce((sum, val, i) => sum + val * v2[i]!, 0);

      // Exact match gives 1.0
      expect(cosineSim(vecA, vecB)).toBeCloseTo(1.0, 4);

      // Distinct topics give significantly lower similarity
      expect(cosineSim(vecA, vecC)).toBeLessThan(0.9);
    });

    it('answers copilot queries with deterministic responses and token accounting', async () => {
      const res = await mock.answerQuery('What is the status of CONV-D4?', 'Active motor trips on conveyor');
      expect(res.answer).toContain('CONV-D4');
      expect(res.tokenUsage.totalTokens).toBeGreaterThan(0);
      expect(res.recommendedActions?.length).toBeGreaterThan(0);
    });
  });

  describe('BedrockLLMProvider', () => {
    it('throws if BEDROCK_TEXT_MODEL_ID is missing from environment and options', () => {
      const prev = process.env.BEDROCK_TEXT_MODEL_ID;
      delete process.env.BEDROCK_TEXT_MODEL_ID;

      try {
        expect(() => new BedrockLLMProvider()).toThrow(/Missing BEDROCK_TEXT_MODEL_ID/);
      } finally {
        if (prev) process.env.BEDROCK_TEXT_MODEL_ID = prev;
      }
    });

    it('enforces token caps (800 for triage, 1200 for copilot query)', () => {
      expect(TRIAGE_MAX_TOKENS).toBe(800);
      expect(COPILOT_MAX_TOKENS).toBe(1200);
    });

    it('uses Bedrock Converse API with token accounting', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        output: {
          message: {
            content: [
              {
                text: JSON.stringify({
                  category: 'EQUIPMENT',
                  severity: 'MEDIUM',
                  locationId: 'LOC-DOCK-4',
                  assetId: 'CONV-D4',
                  summary: 'Conveyor belt slip',
                  impactSignals: ['slip'],
                  entities: {},
                  recommendedFirstAction: 'Tension belt',
                  confidence: 0.94,
                  clarifyingQuestion: null,
                  triageMode: 'AI',
                }),
              },
            ],
          },
        },
        usage: {
          inputTokens: 150,
          outputTokens: 75,
          totalTokens: 225,
        },
      });

      const mockBedrockClient = {
        send: mockSend,
      } as unknown as BedrockSdk.BedrockRuntimeClient;

      const provider = new BedrockLLMProvider({
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        bedrockClient: mockBedrockClient,
      });

      const result = await provider.extractAndClassify({
        text: 'Dock 4 conveyor belt slipping under load',
      });

      expect(mockSend).toHaveBeenCalled();
      expect(result.result.category).toBe('EQUIPMENT');
      expect(result.tokenUsage.totalTokens).toBe(225);
    });
  });

  describe('Factory & Cost Rule', () => {
    beforeEach(() => {
      delete process.env.LLM_PROVIDER;
    });

    it('defaults to MockLLMProvider when LLM_PROVIDER is unset or mock', () => {
      const provider1 = createLLMProvider();
      expect(provider1.providerName).toBe('mock');

      const provider2 = createLLMProvider('mock');
      expect(provider2.providerName).toBe('mock');
    });

    it('instantiates BedrockLLMProvider when explicitly set to bedrock', () => {
      process.env.BEDROCK_TEXT_MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0';
      const provider = createLLMProvider('bedrock');
      expect(provider.providerName).toBe('bedrock');
    });

    it('COST RULE: never constructs BedrockRuntimeClient when LLM_PROVIDER=mock', async () => {
      resetBedrockConstructionCount();

      // 1. Create provider under mock
      const provider = createLLMProvider('mock');
      expect(provider.providerName).toBe('mock');

      // 2. Perform all AI operations (triage, embed, copilot answer)
      await provider.extractAndClassify({ text: 'Conveyor belt tripped Dock 4' });
      await provider.embed('Conveyor belt tripped');
      await provider.answerQuery('What happened?', 'Context');

      // 3. Verify Bedrock client was NEVER constructed
      expect(bedrockClientConstructedCount).toBe(0);
    });
  });
});

