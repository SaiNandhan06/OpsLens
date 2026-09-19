import { TriageResultSchema, type TriageResult } from '@opslens/contracts';
import { LlmSchemaError, type TokenUsage } from './types.js';

/**
 * Defensively strips markdown code fences (```json ... ```) and leading/trailing whitespace.
 */
export function stripMarkdownFences(raw: string): string {
  if (!raw) return '';
  let cleaned = raw.trim();

  // Strip leading code fence
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json|JSON)?\s*\n?/, '');
  }

  // Strip trailing code fence
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.replace(/\n?```\s*$/, '');
  }

  cleaned = cleaned.trim();

  // If still wrapped or contains text before/after JSON, extract outermost { ... }
  if (!cleaned.startsWith('{') && cleaned.includes('{')) {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
  }

  return cleaned;
}

export type ParseValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: unknown[]; rawCleaned: string };

/**
 * Parses and validates raw LLM output against TriageResultSchema.
 */
export function parseAndValidateTriageResponse(raw: string): ParseValidationResult<TriageResult> {
  const cleaned = stripMarkdownFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    return {
      success: false,
      errors: [{ message: `JSON parse failed: ${(err as Error).message}` }],
      rawCleaned: cleaned,
    };
  }

  const validation = TriageResultSchema.safeParse(parsed);
  if (!validation.success) {
    return {
      success: false,
      errors: validation.error.issues,
      rawCleaned: cleaned,
    };
  }

  return {
    success: true,
    data: validation.data,
  };
}

/**
 * Builds the repair prompt provided on a validation retry.
 */
export function buildTriageRepairPrompt(originalResponse: string, errors: unknown[]): string {
  return [
    'Your previous JSON response failed schema validation for the OpsLens TriageResult schema.',
    '',
    'VALIDATION ERRORS:',
    JSON.stringify(errors, null, 2),
    '',
    'PREVIOUS RAW OUTPUT:',
    originalResponse,
    '',
    'Please correct the output. You must output ONLY a single valid JSON object matching the required schema.',
    'Do NOT wrap the response in markdown fences (no ```json). Do NOT output any explanatory text.',
  ].join('\n');
}

/**
 * Executes an LLM call with a single repair retry on schema validation failure.
 * On second failure, throws typed LlmSchemaError.
 */
export async function executeTriageWithRepairRetry(
  invoker: (prompt: string, isRetry: boolean) => Promise<{ rawText: string; tokenUsage: TokenUsage }>,
  initialPrompt: string,
): Promise<{ result: TriageResult; tokenUsage: TokenUsage; attempts: number }> {
  // Attempt 1
  const attempt1 = await invoker(initialPrompt, false);
  const parse1 = parseAndValidateTriageResponse(attempt1.rawText);

  if (parse1.success) {
    return {
      result: parse1.data,
      tokenUsage: attempt1.tokenUsage,
      attempts: 1,
    };
  }

  // Attempt 2 (Repair Retry)
  const repairPrompt = buildTriageRepairPrompt(parse1.rawCleaned, parse1.errors);
  const attempt2 = await invoker(repairPrompt, true);

  const accumulatedTokens: TokenUsage = {
    inputTokens: attempt1.tokenUsage.inputTokens + attempt2.tokenUsage.inputTokens,
    outputTokens: attempt1.tokenUsage.outputTokens + attempt2.tokenUsage.outputTokens,
    totalTokens: attempt1.tokenUsage.totalTokens + attempt2.tokenUsage.totalTokens,
  };

  const parse2 = parseAndValidateTriageResponse(attempt2.rawText);
  if (parse2.success) {
    return {
      result: parse2.data,
      tokenUsage: accumulatedTokens,
      attempts: 2,
    };
  }

  // Second failure: Throw typed LlmSchemaError
  throw new LlmSchemaError(
    `LLM output failed TriageResult schema validation after repair attempt: ${JSON.stringify(parse2.errors)}`,
    attempt2.rawText,
    parse2.errors,
    2,
  );
}
