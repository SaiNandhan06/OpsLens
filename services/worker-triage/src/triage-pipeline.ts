import { ulid } from 'ulid';
import {
  Incident,
  IncidentCategory,
  Severity,
  TriageResult,
} from '@opslens/contracts';
import {
  IncidentRepository,
  TimelineRepository,
  AttachmentRepository,
  ReferenceRepository,
  BudgetRepository,
  LinkRepository,
  RoutingRuleRepository,
} from '@opslens/data';
import {
  getLLMProvider,
  ruleBasedClassifier,
  LlmSchemaError,
  LLMProvider,
  TriageInput,
} from '@opslens/ai';
import { logger } from '@opslens/platform';
import {
  rankCandidates,
  resolveRoute,
  resolveSlaPolicy,
  computeDueDates,
  type RoutingRule,
  type TeamRoutingProfile,
} from '@opslens/core';
import { executeScoringStub } from './stubs.js';
import { isAudioAttachment, transcribeAudio } from './transcribe.js';
import {
  publishIncidentNeedsInfoEvent,
  publishIncidentTriagedEvent,
  publishIncidentRoutedEvent,
} from './eventbridge.js';

export interface RunTriagePipelineParams {
  tenantId: string;
  incidentId: string;
  correlationId?: string;
}

export interface PipelineRepositories {
  incidentRepo?: IncidentRepository;
  timelineRepo?: TimelineRepository;
  attachmentRepo?: AttachmentRepository;
  referenceRepo?: ReferenceRepository;
  budgetRepo?: BudgetRepository;
  linkRepo?: LinkRepository;
  routingRuleRepo?: RoutingRuleRepository;
}

export interface PipelineOptions {
  provider?: LLMProvider;
  testHookThrowAfterStep4?: boolean;
}

/**
 * Runs the OpsLens incident triage pipeline:
 * Pipeline, in exact order: extract → classify → score → dedupe → route.
 */
export async function runTriagePipeline(
  params: RunTriagePipelineParams,
  repos: PipelineRepositories = {},
  options: PipelineOptions = {},
): Promise<Incident> {
  const tenantId = params.tenantId;
  const incidentId = params.incidentId;
  const correlationId = params.correlationId || ulid();

  const incidentRepo = repos.incidentRepo || new IncidentRepository();
  const timelineRepo = repos.timelineRepo || new TimelineRepository();
  const attachmentRepo = repos.attachmentRepo || new AttachmentRepository();
  const referenceRepo = repos.referenceRepo || new ReferenceRepository();
  const budgetRepo = repos.budgetRepo || new BudgetRepository();
  const linkRepo = repos.linkRepo || new LinkRepository();

  let incident = await incidentRepo.getById(tenantId, incidentId);
  if (!incident) {
    throw new Error(`Incident not found: ${incidentId} for tenant: ${tenantId}`);
  }

  try {
    // -------------------------------------------------------------------------
    // Step 1: Set status TRIAGING and publish nothing yet
    // -------------------------------------------------------------------------
    logger.info('Starting triage pipeline: step 1 set TRIAGING', {
      tenantId,
      incidentId,
      correlationId,
    });
    incident = await incidentRepo.update(tenantId, incidentId, {
      status: 'TRIAGING',
    });

    // -------------------------------------------------------------------------
    // Step 2: Audio attachment transcription and translation
    // -------------------------------------------------------------------------
    const attachments = await attachmentRepo.listAttachments(tenantId, incidentId);
    const audioAttachment = attachments.find((att) => isAudioAttachment(att));

    let audioTranscriptText = '';
    const audioMetadata: Record<string, unknown> = {};

    if (audioAttachment) {
      logger.info('Detected audio attachment, running transcription', {
        tenantId,
        incidentId,
        attachmentId: audioAttachment.id,
      });

      const transcription = await transcribeAudio(
        tenantId,
        incidentId,
        audioAttachment,
        timelineRepo,
      );

      audioTranscriptText = transcription.translatedTranscript;
      audioMetadata.audioTranscript = {
        attachmentId: audioAttachment.id,
        originalTranscript: transcription.originalTranscript,
        detectedLanguage: transcription.detectedLanguage,
        translatedTranscript: transcription.translatedTranscript,
      };
      audioMetadata.originalTranscript = transcription.originalTranscript;
      audioMetadata.detectedLanguage = transcription.detectedLanguage;
      audioMetadata.translatedTranscript = transcription.translatedTranscript;
    }

    // -------------------------------------------------------------------------
    // Step 3: Build AI input
    // Description + transcript + image references + tenant asset and location names
    // -------------------------------------------------------------------------
    let combinedText = (incident.description || '').trim();
    if (audioTranscriptText) {
      if (!combinedText || combinedText.toLowerCase().includes('voice note')) {
        combinedText = audioTranscriptText;
      } else {
        combinedText = `${combinedText}\nAudio Transcript: ${audioTranscriptText}`.trim();
      }
    }

    const imageAttachments = attachments.filter(
      (att) =>
        att.contentType.toLowerCase().startsWith('image/') ||
        /\.(jpe?g|png|webp)$/i.test(att.fileName || ''),
    );
    const imageReferences = imageAttachments.map((att) => att.s3Key);

    const [assets, locations] = await Promise.all([
      referenceRepo.listAssets(tenantId).catch(() => []),
      referenceRepo.listLocations(tenantId).catch(() => []),
    ]);

    const triageInput: TriageInput = {
      text: combinedText,
      imageReferences: imageReferences.length > 0 ? imageReferences : undefined,
      context: {
        tenantId,
        assetId: incident.assetId || undefined,
        locationId: incident.locationId || undefined,
        knownAssets: assets.map((a) => ({ id: a.id as string, name: (a.name as string) || (a.id as string) })),
        knownLocations: locations.map((l) => ({ id: l.id as string, name: (l.name as string) || (l.id as string) })),
      },
    };

    // -------------------------------------------------------------------------
    // Step 4: Token budget check & AI classification / fallback
    // -------------------------------------------------------------------------
    const today = new Date().toISOString().split('T')[0]!;
    const dailyBudget = Number(process.env.DAILY_TOKEN_BUDGET || 200000);
    const currentBudget = await budgetRepo.getBudget(tenantId, today);
    const isBudgetExhausted = Boolean(
      currentBudget && currentBudget.totalTokens >= dailyBudget,
    );

    let triageResult: TriageResult;
    let isFallback = false;
    let fallbackReason = '';
    const now = new Date().toISOString();

    if (isBudgetExhausted) {
      logger.warn('Daily token budget exhausted; skipping LLM and using rule fallback', {
        tenantId,
        today,
        totalTokens: currentBudget?.totalTokens,
        dailyBudget,
      });

      const fallback = ruleBasedClassifier(combinedText, triageInput.context);
      triageResult = {
        ...fallback,
        triageMode: 'FALLBACK',
        confidence: 0.3,
      };
      isFallback = true;
      fallbackReason = 'BUDGET_EXHAUSTED';

      await timelineRepo.appendEvent(tenantId, {
        id: ulid(),
        incidentId,
        tenantId,
        type: 'TRIAGED',
        actorId: 'system-triage-fallback',
        actorRole: 'SYSTEM',
        timestamp: now,
        data: {
          triageMode: 'FALLBACK',
          reason: 'DAILY_TOKEN_BUDGET_EXHAUSTED',
          confidence: 0.3,
          promptVersion: 'triage-extract.v1',
          modelId: 'rule-fallback',
        },
      });
    } else {
      const provider = options.provider || getLLMProvider();

      try {
        const executionResult = await provider.extractAndClassify(triageInput);
        triageResult = executionResult.result;

        // Record token usage against tenant daily budget
        if (executionResult.tokenUsage) {
          await budgetRepo.recordTokenUsage(tenantId, today, {
            inputTokens: executionResult.tokenUsage.inputTokens,
            outputTokens: executionResult.tokenUsage.outputTokens,
          });
        }

        // Timeline event recording AI classification
        await timelineRepo.appendEvent(tenantId, {
          id: ulid(),
          incidentId,
          tenantId,
          type: 'TRIAGED',
          actorId: 'system-triage-ai',
          actorRole: 'SYSTEM',
          timestamp: now,
          data: {
            triageMode: triageResult.triageMode,
            modelId: executionResult.modelId || 'claude-3-haiku',
            promptVersion: 'triage-extract.v1',
            confidence: triageResult.confidence,
            category: triageResult.category,
            severity: triageResult.severity,
          },
        });
      } catch (err) {
        if (err instanceof LlmSchemaError) {
          logger.warn('LlmSchemaError encountered; using rule-based fallback', {
            error: err.message,
            attempts: err.attempts,
          });

          const fallback = ruleBasedClassifier(combinedText, triageInput.context);
          triageResult = {
            ...fallback,
            triageMode: 'FALLBACK',
            confidence: 0.3,
          };
          isFallback = true;
          fallbackReason = 'LLM_SCHEMA_ERROR';

          await timelineRepo.appendEvent(tenantId, {
            id: ulid(),
            incidentId,
            tenantId,
            type: 'TRIAGED',
            actorId: 'system-triage-fallback',
            actorRole: 'SYSTEM',
            timestamp: now,
            data: {
              triageMode: 'FALLBACK',
              reason: 'LLM_SCHEMA_ERROR',
              confidence: 0.3,
              promptVersion: 'triage-extract.v1',
              modelId: 'rule-fallback',
            },
          });
        } else {
          throw err;
        }
      }
    }

    // Test hook: allow testing deliberate error after step 4
    if (options.testHookThrowAfterStep4) {
      throw new Error('Test hook: deliberate pipeline failure after step 4');
    }

    // -------------------------------------------------------------------------
    // Step 5: Field Sources
    // Persist every extracted field WITH its source ("ai" | "rule" | "human")
    // -------------------------------------------------------------------------
    const defaultSource = isFallback ? 'rule' : 'ai';
    const fieldSources: Record<string, string> = {
      category: defaultSource,
      severity: defaultSource,
      locationId:
        incident.locationId && !triageResult.locationId
          ? 'human'
          : triageResult.locationId
            ? defaultSource
            : defaultSource,
      assetId:
        incident.assetId && !triageResult.assetId
          ? 'human'
          : triageResult.assetId
            ? defaultSource
            : defaultSource,
      summary: defaultSource,
      recommendedFirstAction: defaultSource,
      impactSignals: defaultSource,
      entities: defaultSource,
    };

    // -------------------------------------------------------------------------
    // Step 6: Clarification check
    // If confidence < 0.6 and clarifyingQuestion: set NEEDS_INFO, publish, and stop
    // -------------------------------------------------------------------------
    if (triageResult.confidence < 0.6 && triageResult.clarifyingQuestion) {
      logger.info('Low confidence triage result with clarifying question; setting NEEDS_INFO', {
        tenantId,
        incidentId,
        confidence: triageResult.confidence,
        question: triageResult.clarifyingQuestion,
      });

      const updatedIncident = await incidentRepo.update(tenantId, incidentId, {
        status: 'NEEDS_INFO',
        confidence: triageResult.confidence,
        triageMode: triageResult.triageMode,
        category: triageResult.category,
        severity: triageResult.severity,
        locationId: triageResult.locationId || incident.locationId || null,
        assetId: triageResult.assetId || incident.assetId || null,
        metadata: {
          ...incident.metadata,
          ...audioMetadata,
          clarifyingQuestion: triageResult.clarifyingQuestion,
          fieldSources,
          summary: triageResult.summary,
          recommendedFirstAction: triageResult.recommendedFirstAction,
        },
      });

      // Write timeline event for status change
      await timelineRepo.appendEvent(tenantId, {
        id: ulid(),
        incidentId,
        tenantId,
        type: 'STATUS_CHANGED',
        actorId: 'system-triage',
        actorRole: 'SYSTEM',
        timestamp: new Date().toISOString(),
        data: {
          status: 'NEEDS_INFO',
          clarifyingQuestion: triageResult.clarifyingQuestion,
          confidence: triageResult.confidence,
        },
      });

      // Publish INCIDENT_NEEDS_INFO to EventBridge
      await publishIncidentNeedsInfoEvent({
        tenantId,
        incidentId,
        correlationId,
        occurredAt: new Date().toISOString(),
        type: 'INCIDENT_NEEDS_INFO',
        question: triageResult.clarifyingQuestion,
        confidence: triageResult.confidence,
      });

      return updatedIncident;
    }

    // -------------------------------------------------------------------------
    // Step 7: Scoring
    // -------------------------------------------------------------------------
    const resolvedAssetId = triageResult.assetId || incident.assetId;
    let assetCriticality: 'TIER_1' | 'TIER_2' | 'TIER_3' | undefined;
    let prior30DayCount = 0;

    if (resolvedAssetId) {
      const matchedAsset = assets.find((a) => a.id === resolvedAssetId);
      if (matchedAsset && 'criticality' in matchedAsset && typeof matchedAsset.criticality === 'string') {
        assetCriticality = matchedAsset.criticality as 'TIER_1' | 'TIER_2' | 'TIER_3';
      }

      try {
        const history = await incidentRepo.queryByAsset(tenantId, resolvedAssetId, { limit: 50 });
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        prior30DayCount = (history.items || []).filter(
          (item) =>
            item.id !== incidentId &&
            item.category === triageResult.category &&
            item.createdAt >= thirtyDaysAgo,
        ).length;
      } catch (err) {
        logger.warn('Failed to query asset incident history for recurrence scoring', {
          tenantId,
          assetId: resolvedAssetId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const scoringResult = await executeScoringStub({
      tenantId,
      incident,
      triageResult,
      correlationId,
      assetCriticality,
      prior30DayCount,
    });

    // -------------------------------------------------------------------------
    // Step 8: Dedupe & Related Detection
    // -------------------------------------------------------------------------
    // 1. Embed summary + description + asset name (256 dims)
    const embedProvider = (options.provider && typeof options.provider.embed === 'function')
      ? options.provider
      : getLLMProvider();

    const matchedAssetObj = resolvedAssetId ? assets.find((a) => a.id === resolvedAssetId) : undefined;
    const assetNameOrId = (matchedAssetObj && 'name' in matchedAssetObj && typeof matchedAssetObj.name === 'string')
      ? matchedAssetObj.name
      : (resolvedAssetId || '');

    const textToEmbed = [
      triageResult.summary,
      incident.description,
      assetNameOrId,
    ]
      .filter(Boolean)
      .join(' ');

    let embedding: number[] = [];
    try {
      const embedRes = await embedProvider.embed(textToEmbed);
      embedding = embedRes?.vector || (embedRes as any)?.embedding || [];
    } catch (err) {
      logger.warn('Failed to generate embedding during triage', {
        tenantId,
        incidentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 2. Fetch candidates via GSI2: same tenant, same assetId OR locationId, created within 14 days, max 50
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    let candidates: Incident[] = [];
    try {
      candidates = await incidentRepo.queryCandidates(tenantId, {
        assetId: resolvedAssetId,
        locationId: triageResult.locationId || incident.locationId,
        createdAfter: fourteenDaysAgo,
        limit: 50,
      });
    } catch (err) {
      logger.warn('Failed to query candidate incidents for deduplication', {
        tenantId,
        incidentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 3. Classify candidates:
    // similarity >= DUPLICATE_THRESHOLD AND same asset AND target still open -> DUPLICATE_CANDIDATE
    // similarity >= RELATED_THRESHOLD -> RELATED
    const duplicateThreshold = Number(process.env.DUPLICATE_THRESHOLD || 0.85);
    const relatedThreshold = Number(process.env.RELATED_THRESHOLD || 0.70);

    const ranked = rankCandidates(
      {
        id: incidentId,
        embedding,
        assetId: resolvedAssetId,
        locationId: triageResult.locationId || incident.locationId,
        createdAt: incident.createdAt,
        status: incident.status,
      },
      candidates.map((c) => ({
        id: c.id,
        embedding: c.embedding || (c.metadata?.embedding as number[] | undefined),
        assetId: c.assetId,
        locationId: c.locationId,
        status: c.status,
        createdAt: c.createdAt,
        title: c.title,
        description: c.description,
      })),
      { duplicateThreshold, relatedThreshold },
    );

    // 4. Write link items. NEVER auto-merge and never auto-close!
    const duplicateCandidates = ranked.filter((r) => r.classification === 'DUPLICATE_CANDIDATE');
    const relatedIncidents = ranked.filter((r) => r.classification === 'RELATED');

    for (const match of [...duplicateCandidates, ...relatedIncidents]) {
      try {
        await linkRepo.createLink(tenantId, {
          parentIncidentId: match.incidentId,
          childIncidentId: incidentId,
          linkType: match.classification as 'DUPLICATE_CANDIDATE' | 'RELATED',
          similarityScore: match.similarity,
          reason: match.reason,
          linkedBy: 'system-triage-dedupe',
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        logger.warn('Failed to write incident link item', {
          tenantId,
          parentIncidentId: match.incidentId,
          childIncidentId: incidentId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const hasDuplicateCandidate = duplicateCandidates.length > 0;
    const canonicalIncidentId = hasDuplicateCandidate ? duplicateCandidates[0]!.incidentId : null;

    // -------------------------------------------------------------------------
    // Step 9: Routing (strict precedence: asset -> cat+loc -> cat -> fallback)
    // -------------------------------------------------------------------------
    const routingRuleRepo = repos.routingRuleRepo || new RoutingRuleRepository();
    let rules: RoutingRule[] = [];
    let teams: TeamRoutingProfile[] = [];
    let tenantTimezone = 'Asia/Kolkata';
    let fallbackTeamId = 'TEAM-LOGISTICS';
    let tenant: Record<string, unknown> | null = null;

    try {
      rules = await routingRuleRepo.listRules(tenantId);
      const rawTeams = await referenceRepo.listTeams(tenantId);
      teams = rawTeams as unknown as TeamRoutingProfile[];
      tenant = await referenceRepo.getTenant(tenantId);
      if (tenant?.timezone) tenantTimezone = tenant.timezone as string;
      if (tenant?.fallbackTeamId) fallbackTeamId = tenant.fallbackTeamId as string;
    } catch (err) {
      logger.warn('Failed to load routing rules or teams, using defaults', {
        tenantId,
        incidentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const routeNowIso = new Date().toISOString();
    const routingResult = resolveRoute(
      {
        category: triageResult.category,
        assetId: resolvedAssetId,
        locationId: triageResult.locationId || incident.locationId,
      },
      rules,
      teams,
      routeNowIso,
      {
        timezone: tenantTimezone,
        fallbackTeamId,
      },
    );

    // Compute SLA due dates via pure core SLA engine
    const slaPolicy = resolveSlaPolicy(
      tenant,
      triageResult.category as IncidentCategory,
      (triageResult.severity as Severity) || 'MEDIUM',
    );
    const slaDates = computeDueDates(routeNowIso, slaPolicy);

    // Append ROUTED timeline event
    await timelineRepo.appendEvent(tenantId, {
      id: ulid(),
      incidentId,
      tenantId,
      type: 'ROUTED',
      actorId: 'system',
      actorRole: 'SYSTEM',
      timestamp: routeNowIso,
      data: {
        assignedTeamId: routingResult.targetTeamId,
        ruleId: routingResult.ruleId,
        reason: routingResult.reason,
        routedOutOfShift: routingResult.routedOutOfShift,
        matchedTeamId: routingResult.matchedTeamId,
      },
    });

    // Publish INCIDENT_ROUTED to EventBridge
    await publishIncidentRoutedEvent({
      type: 'INCIDENT_ROUTED',
      tenantId,
      incidentId,
      correlationId,
      occurredAt: routeNowIso,
      assignedTeamId: routingResult.targetTeamId,
      ruleId: routingResult.ruleId,
      reason: routingResult.reason,
    });

    // -------------------------------------------------------------------------
    // Step 10: Persist updated incident with ROUTED status and publish INCIDENT_TRIAGED
    // -------------------------------------------------------------------------
    const updatedIncident = await incidentRepo.update(tenantId, incidentId, {
      status: 'ROUTED',
      category: triageResult.category as IncidentCategory,
      severity: triageResult.severity as Severity,
      locationId: triageResult.locationId || incident.locationId || null,
      assetId: triageResult.assetId || incident.assetId || null,
      priorityScore: scoringResult.priorityScore,
      scoreBreakdown: scoringResult.scoreBreakdown,
      confidence: triageResult.confidence,
      triageMode: triageResult.triageMode,
      assignedTeamId: routingResult.targetTeamId,
      ackDueAt: slaDates.ackDueAt,
      resolveDueAt: slaDates.resolveDueAt,
      slaActive: true,
      earliestDueAt: slaDates.earliestDueAt,
      embedding: embedding.length > 0 ? embedding : undefined,
      metadata: {
        ...incident.metadata,
        ...audioMetadata,
        fieldSources,
        summary: triageResult.summary,
        recommendedFirstAction: triageResult.recommendedFirstAction,
        impactSignals: triageResult.impactSignals,
        entities: triageResult.entities,
        hasDuplicateCandidate,
        duplicateCandidateCount: duplicateCandidates.length,
        canonicalIncidentId,
        topDuplicateReason: duplicateCandidates[0]?.reason,
        relatedCount: relatedIncidents.length,
        routing: {
          matchedRuleId: routingResult.ruleId,
          reason: routingResult.reason,
          routedOutOfShift: routingResult.routedOutOfShift,
          matchedTeamId: routingResult.matchedTeamId,
          routedAt: routeNowIso,
        },
        ...(embedding.length > 0 ? { embedding } : {}),
        ...(fallbackReason ? { fallbackReason } : {}),
      },
    });

    // Publish INCIDENT_TRIAGED event to EventBridge
    await publishIncidentTriagedEvent({
      tenantId,
      incidentId,
      correlationId,
      occurredAt: new Date().toISOString(),
      type: 'INCIDENT_TRIAGED',
      triageResult,
      priorityScore: scoringResult.priorityScore,
      scoreBreakdown: scoringResult.scoreBreakdown,
      isDuplicate: hasDuplicateCandidate,
      canonicalIncidentId,
    });

    logger.info('Incident triage pipeline completed successfully', {
      tenantId,
      incidentId,
      status: updatedIncident.status,
      category: updatedIncident.category,
      severity: updatedIncident.severity,
      priorityScore: updatedIncident.priorityScore,
    });

    return updatedIncident;
  } catch (error) {
    // -------------------------------------------------------------------------
    // Error Boundary: Never leave an incident stuck in TRIAGING
    // -------------------------------------------------------------------------
    logger.error('Unexpected error in triage pipeline; executing fail-safe recovery to FALLBACK', {
      tenantId,
      incidentId,
      error: error instanceof Error ? error.message : String(error),
    });

    try {
      const recovered = await incidentRepo.update(tenantId, incidentId, {
        status: 'NEW',
        triageMode: 'FALLBACK',
        confidence: 0.3,
        metadata: {
          ...(incident.metadata || {}),
          fallbackReason: error instanceof Error ? error.message : String(error),
          fieldSources: {
            category: 'rule',
            severity: 'rule',
            locationId: 'rule',
            assetId: 'rule',
            summary: 'rule',
            recommendedFirstAction: 'rule',
            impactSignals: 'rule',
            entities: 'rule',
          },
        },
      });

      await timelineRepo.appendEvent(tenantId, {
        id: ulid(),
        incidentId,
        tenantId,
        type: 'TRIAGED',
        actorId: 'system-triage-fallback',
        actorRole: 'SYSTEM',
        timestamp: new Date().toISOString(),
        data: {
          triageMode: 'FALLBACK',
          reason: error instanceof Error ? error.message : 'UNEXPECTED_ERROR',
          confidence: 0.3,
          promptVersion: 'triage-extract.v1',
          modelId: 'error-recovery-fallback',
        },
      });

      return recovered;
    } catch (recoveryError) {
      logger.error('Fatal error attempting recovery of incident in TRIAGING state', {
        tenantId,
        incidentId,
        recoveryError,
      });
      throw error;
    }
  }
}
