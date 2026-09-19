import type { TriageResult } from '@opslens/contracts';

/**
 * Token accounting details returned by every LLM invocation.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * Input parameters for triage extraction and classification.
 */
export interface TriageInput {
  text: string;
  imageReferences?: string[];
  priorTranscript?: string | Array<{ role: string; content: string }>;
  context?: {
    locationId?: string;
    assetId?: string;
    tenantId?: string;
    [key: string]: unknown;
  };
}

/**
 * Result returned by extractAndClassify.
 */
export interface TriageExecutionResult {
  result: TriageResult;
  tokenUsage: TokenUsage;
  modelId: string;
  attempts?: number;
}

/**
 * Result returned by embed.
 */
export interface EmbeddingResult {
  vector: number[];
  tokenUsage: TokenUsage;
  modelId: string;
}

/**
 * Result returned by answerQuery.
 */
export interface AnswerQueryResult {
  answer: string;
  tokenUsage: TokenUsage;
  modelId: string;
  sources?: string[];
  recommendedActions?: string[];
}

/**
 * Common interface implemented by MockLLMProvider and BedrockLLMProvider.
 */
export interface LLMProvider {
  readonly providerName: 'mock' | 'bedrock';
  extractAndClassify(input: TriageInput): Promise<TriageExecutionResult>;
  embed(text: string): Promise<EmbeddingResult>;
  answerQuery(question: string, context: string): Promise<AnswerQueryResult>;
}

/**
 * Typed error thrown when LLM output fails schema validation and cannot be repaired.
 */
export class LlmSchemaError extends Error {
  public readonly rawResponse: string;
  public readonly validationErrors: unknown[];
  public readonly attempts: number;

  constructor(
    message: string,
    rawResponse: string,
    validationErrors: unknown[] = [],
    attempts = 2,
  ) {
    super(message);
    this.name = 'LlmSchemaError';
    this.rawResponse = rawResponse;
    this.validationErrors = validationErrors;
    this.attempts = attempts;
  }
}
