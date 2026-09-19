import type { LLMProvider } from './types.js';
import { MockLLMProvider } from './mock-provider.js';
import { BedrockLLMProvider } from './bedrock-provider.js';

let cachedProvider: LLMProvider | null = null;

/**
 * Creates or retrieves the LLMProvider according to LLM_PROVIDER environment variable.
 * Defaults strictly to 'mock' to preserve AWS credit budget.
 *
 * CRITICAL COST RULE:
 * Under 'mock', BedrockLLMProvider is NEVER constructed, preventing any AWS API calls.
 */
export function createLLMProvider(providerType?: string): LLMProvider {
  const provider = (providerType || process.env.LLM_PROVIDER || 'mock').toLowerCase();

  if (provider === 'bedrock') {
    return new BedrockLLMProvider();
  }

  return new MockLLMProvider();
}

/**
 * Singleton getter for the configured LLMProvider.
 */
export function getLLMProvider(providerType?: string): LLMProvider {
  if (!cachedProvider) {
    cachedProvider = createLLMProvider(providerType);
  }
  return cachedProvider;
}

/**
 * Resets cached provider singleton (for test isolation).
 */
export function resetProvider(): void {
  cachedProvider = null;
}
