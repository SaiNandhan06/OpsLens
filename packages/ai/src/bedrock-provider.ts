import fs from 'node:fs';
import path from 'node:path';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
  type ContentBlock,
  type Message,
  type ImageFormat,
} from '@aws-sdk/client-bedrock-runtime';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type {
  LLMProvider,
  TriageInput,
  TriageExecutionResult,
  EmbeddingResult,
  AnswerQueryResult,
  TokenUsage,
} from './types.js';
import { executeTriageWithRepairRetry } from './response-parser.js';

export const TRIAGE_MAX_TOKENS = 800;
export const COPILOT_MAX_TOKENS = 1200;

function loadPromptFile(filename: string): string {
  const candidatePaths = [
    path.resolve(process.cwd(), 'src/prompts', filename),
    path.resolve(process.cwd(), 'packages/ai/src/prompts', filename),
    path.resolve(process.cwd(), '../packages/ai/src/prompts', filename),
    path.resolve(__dirname, 'prompts', filename),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf-8');
    }
  }
  return '';
}

export let bedrockClientConstructedCount = 0;

export function resetBedrockConstructionCount(): void {
  bedrockClientConstructedCount = 0;
}

export class BedrockLLMProvider implements LLMProvider {
  public readonly providerName = 'bedrock' as const;
  private readonly client: BedrockRuntimeClient;
  private readonly s3Client: S3Client;
  public readonly modelId: string;
  public readonly embedModelId: string;
  public readonly embedDimensions: number;

  constructor(options?: {
    modelId?: string;
    embedModelId?: string;
    region?: string;
    embedDimensions?: number;
    bedrockClient?: BedrockRuntimeClient;
    s3Client?: S3Client;
  }) {
    const model = options?.modelId || process.env.BEDROCK_TEXT_MODEL_ID;
    if (!model) {
      throw new Error(
        'Missing BEDROCK_TEXT_MODEL_ID environment variable. Model IDs must come from environment configuration.',
      );
    }
    this.modelId = model;

    this.embedModelId =
      options?.embedModelId ||
      process.env.BEDROCK_EMBED_MODEL_ID ||
      'amazon.titan-embed-text-v2:0';

    this.embedDimensions =
      options?.embedDimensions ||
      parseInt(process.env.EMBED_DIMENSIONS || '256', 10);

    const region =
      options?.region ||
      process.env.BEDROCK_REGION ||
      process.env.AWS_REGION ||
      'us-east-1';

    if (options?.bedrockClient) {
      this.client = options.bedrockClient;
    } else {
      bedrockClientConstructedCount++;
      this.client = new BedrockRuntimeClient({ region });
    }

    this.s3Client = options?.s3Client || new S3Client({ region });
  }

  private async fetchImageBlock(imageRef: string): Promise<ContentBlock | null> {
    try {
      let bucket = process.env.MEDIA_BUCKET || 'opslens-media-local';
      let key = imageRef;

      if (imageRef.startsWith('s3://')) {
        const parts = imageRef.replace('s3://', '').split('/');
        bucket = parts[0]!;
        key = parts.slice(1).join('/');
      }

      const ext = path.extname(key).replace('.', '').toLowerCase();
      let format: ImageFormat = 'jpeg';
      if (ext === 'png') format = 'png';
      else if (ext === 'webp') format = 'webp';
      else if (ext === 'gif') format = 'gif';

      const s3Res = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );

      if (!s3Res.Body) return null;
      const bytes = await s3Res.Body.transformToByteArray();

      return {
        image: {
          format,
          source: {
            bytes,
          },
        },
      };
    } catch {
      return null;
    }
  }

  async extractAndClassify(input: TriageInput): Promise<TriageExecutionResult> {
    const systemPrompt = loadPromptFile('triage-extract.v1.md');

    const invoker = async (currentPrompt: string, isRetry: boolean) => {
      const contentBlocks: ContentBlock[] = [];

      // Multimodal support: Fetch image references if present on first attempt
      if (!isRetry && input.imageReferences && input.imageReferences.length > 0) {
        for (const ref of input.imageReferences) {
          const imgBlock = await this.fetchImageBlock(ref);
          if (imgBlock) contentBlocks.push(imgBlock);
        }
      }

      let userText = currentPrompt;
      if (!isRetry) {
        userText = `Incident Report Content:\n"${input.text}"`;
        if (input.priorTranscript) {
          userText += `\n\nPrior Conversation Transcript:\n${typeof input.priorTranscript === 'string' ? input.priorTranscript : JSON.stringify(input.priorTranscript)}`;
        }
        if (input.context) {
          userText += `\n\nContext:\n${JSON.stringify(input.context)}`;
        }
      }

      contentBlocks.push({ text: userText });

      const messages: Message[] = [{ role: 'user', content: contentBlocks }];

      const command = new ConverseCommand({
        modelId: this.modelId,
        system: systemPrompt ? [{ text: systemPrompt }] : undefined,
        messages,
        inferenceConfig: {
          maxTokens: TRIAGE_MAX_TOKENS,
          temperature: 0.1,
        },
      });

      const response = await this.client.send(command);

      const rawText = response.output?.message?.content?.[0]?.text || '';
      const usage = response.usage;
      const tokenUsage: TokenUsage = {
        inputTokens: usage?.inputTokens || 0,
        outputTokens: usage?.outputTokens || 0,
        totalTokens: usage?.totalTokens || (usage?.inputTokens || 0) + (usage?.outputTokens || 0),
      };

      return { rawText, tokenUsage };
    };

    const { result, tokenUsage, attempts } = await executeTriageWithRepairRetry(invoker, input.text);

    return {
      result,
      tokenUsage,
      modelId: this.modelId,
      attempts,
    };
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const payload = JSON.stringify({
      inputText: text,
      dimensions: this.embedDimensions,
      normalize: true,
    });

    const command = new InvokeModelCommand({
      modelId: this.embedModelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: new TextEncoder().encode(payload),
    });

    const response = await this.client.send(command);
    const rawBody = new TextDecoder().decode(response.body);
    const parsed = JSON.parse(rawBody);

    const vector: number[] = parsed.embedding || [];
    const inputTokens = parsed.inputTextTokenCount || Math.ceil(text.length / 4);

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
    const systemPrompt = loadPromptFile('copilot-answer.v1.md');

    const promptText = `Context:\n${context}\n\nOperator Query:\n${question}`;

    const command = new ConverseCommand({
      modelId: this.modelId,
      system: systemPrompt ? [{ text: systemPrompt }] : undefined,
      messages: [
        {
          role: 'user',
          content: [{ text: promptText }],
        },
      ],
      inferenceConfig: {
        maxTokens: COPILOT_MAX_TOKENS,
        temperature: 0.2,
      },
    });

    const response = await this.client.send(command);
    const rawText = response.output?.message?.content?.[0]?.text || '';

    let answer = rawText;
    let sources: string[] | undefined;
    let recommendedActions: string[] | undefined;

    try {
      const parsed = JSON.parse(rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
      if (parsed.answer) {
        answer = parsed.answer;
        sources = parsed.sources;
        recommendedActions = parsed.recommendedActions;
      }
    } catch {
      // If pure text was returned, keep rawText as answer
    }

    const usage = response.usage;
    const tokenUsage: TokenUsage = {
      inputTokens: usage?.inputTokens || 0,
      outputTokens: usage?.outputTokens || 0,
      totalTokens: usage?.totalTokens || (usage?.inputTokens || 0) + (usage?.outputTokens || 0),
    };

    return {
      answer,
      tokenUsage,
      modelId: this.modelId,
      sources,
      recommendedActions,
    };
  }
}
