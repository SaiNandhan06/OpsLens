# OpsLens — Agent Build Prompts
**Sequenced, section-by-section. Every build prompt (B) is followed by a verification prompt (V).**

---

## How to use this document

1. Give the agent `03_CODEBASE_MAP.md` **once per session**, before the first prompt.
2. Run prompts in order. Each assumes the previous one passed verification.
3. After each **B** prompt, run the matching **V** prompt in the same session. If V fails, re-run B with the failure pasted in — don't move on.
4. Every prompt ends with a status update to `CODEBASE_MAP.md` §14. That's what keeps a fresh agent oriented.
5. Prefix every prompt with this standing header:

> **Standing context:** You are working on OpsLens. Read `CODEBASE_MAP.md` first. Follow its architecture rules and cost guardrails. Do not modify `packages/contracts` unless this prompt explicitly says to. Do not add infrastructure from the "never add" list — flag it instead. Stay strictly inside the scope of this task. Finish by updating §14 and giving a short report: files touched, verify commands, assumptions, anything deliberately left out.

**Phase map:** 0 → prompts 1–3 · 1 → 4–6 · 2 → 7–11 · 3 → 12–13 · 4 → 14–16 · 5 → 17–18 · 6 → 19–20 · 7 → 21

---

# PHASE 0 — Foundations

## B1 — Monorepo scaffold

```
Create the OpsLens monorepo skeleton exactly as laid out in CODEBASE_MAP.md §3.

Requirements:
- pnpm workspaces: packages/*, services/*, apps/*
- TypeScript strict mode, shared tsconfig base extended by each package
- ESLint + Prettier, one shared config
- Vitest configured at the root, running across all workspaces
- Root package.json scripts: build, test, lint, typecheck, dev:api, dev:web,
  bootstrap:local, seed:local
- docker-compose.localstack.yml with DynamoDB, S3, SNS, SQS, EventBridge
- .gitignore covering node_modules, dist, .aws-sam, .env*, .localstack
- .env.example listing every variable in CODEBASE_MAP.md §11 with local defaults
- README.md with a "Getting started" section matching §12

Create every package and service directory with a package.json and a
placeholder index.ts that exports nothing, so the workspace graph resolves.
Do not implement any business logic yet.
```

## V1 — Verify scaffold

```
Verify the scaffold:
1. Run: pnpm install && pnpm typecheck && pnpm lint && pnpm test
2. Confirm every directory in CODEBASE_MAP.md §3 exists.
3. Confirm docker compose -f docker-compose.localstack.yml up -d starts cleanly,
   then bring it down.
4. Confirm .env.example contains all 15 variables from §11.
5. Confirm no package depends on aws-sdk except packages/data, packages/ai,
   packages/platform and services/*.

Report a PASS/FAIL table, one row per check, with the actual command output for
any failure. Do not fix anything — just report.
```

---

## B2 — Shared contracts

```
Implement packages/contracts. This is the shared vocabulary every other package
imports. Use a schema library that gives both runtime validation and inferred
static types, and export both for every shape.

Define:
1. Enums: IncidentStatus, IncidentCategory (the 7 warehouse types in the PRD),
   Severity, Role, TimelineEventType, LinkType, TriageMode, FieldSource.
2. Incident: full shape including priorityScore, scoreBreakdown, confidence,
   triageMode, assetId, locationId, assignedTeamId, ackDueAt, resolveDueAt,
   reporterId, createdAt, updatedAt.
3. ScoreBreakdown: five factors (businessImpact, safetyRisk, slaUrgency,
   recurrence, downtime), each with rawValue, normalisedValue, weight,
   contribution, and an explanation string. Plus the total.
4. TriageResult: what the AI layer returns — category, severity, locationId,
   assetId, summary, impactSignals, entities, recommendedFirstAction,
   confidence, clarifyingQuestion (nullable).
5. AuthContext: tenantId, userId, role, email.
6. API request/response schemas for every endpoint in the PRD §9 table.
7. Event payload schemas for every event in CODEBASE_MAP.md §7.
8. ErrorCode enum and the error envelope shape from PRD §9.

Every exported type must have a JSDoc line. No logic, no I/O — types and schemas
only. Add unit tests that each schema accepts a valid fixture and rejects a
malformed one.
```

## V2 — Verify contracts

```
Verify packages/contracts:
1. pnpm --filter contracts typecheck && pnpm --filter contracts test
2. List every exported symbol. Confirm coverage of all 8 groups in the previous task.
3. Cross-check the API schemas against the endpoint table in the PRD: report any
   endpoint with no request or response schema.
4. Confirm ScoreBreakdown exposes rawValue, normalisedValue, weight, contribution
   and explanation per factor — the UI depends on all five.
5. Confirm the package has zero runtime dependencies beyond the schema library.

Report PASS/FAIL per check plus a table of exported symbols grouped by file.
```

---

## B3 — Seed data & LLM fixtures

```
Create the seed/ directory and a seeding script.

Data to generate (as JSON files):
- tenants.json: "north-hub" (Asia/Kolkata) and "south-hub". Each with default
  scoring weights 0.30/0.25/0.20/0.15/0.10 and default thresholds.
- locations.json: Dock 1-4, Cold Store A, Pick Zone 1-2, Loading Bay.
- assets.json: at least 12, including CONV-D4 (conveyor at Dock 4, criticality
  high), scanners, forklifts, a cold-store unit.
- teams.json: Maintenance, Safety, Inventory, Logistics — each with a supervisor
  and a shift pattern.
- users.json: one user per role per tenant, predictable demo emails.
- sla-policies.json: per category+severity, ack and resolve minutes. Equipment
  failure + HIGH must be ack 20 / resolve 120.
- routing-rules.json: asset-specific rule for CONV-D4 → Maintenance, plus
  category defaults and a fallback team.
- incidents.json: 40 historical incidents across 30 days, realistic wording.
  MUST include a deliberate cluster: three CONV-D4 conveyor stoppages in the last
  9 days, with escalating tone. Include at least one currently-breaching SLA and
  a few resolved incidents so MTTR is computable.
- llm-fixtures.json: deterministic MockLLMProvider responses keyed by a hash of
  the input text, covering every seeded incident plus the golden-path demo input
  ("Dock 4 conveyor stopped again. Packages piling up. Third time this week.").

Then write scripts/seed.ts that loads all of this into LocalStack (or a deployed
stage via a --stage flag), and generates embeddings using the configured
provider — which must default to mock.

Note: the seed script cannot write to the table until packages/data exists.
Structure it so the data loading is a separate, importable function, and stub the
persistence call with a clear TODO marker for now.
```

## V3 — Verify seed data

```
Verify the seed data:
1. Validate every seed JSON file against the schemas in packages/contracts. Report
   any field that fails.
2. Confirm incidents.json contains >= 3 incidents on asset CONV-D4 within the last
   9 days. Print them with dates.
3. Confirm at least one incident has a resolveDueAt in the past and is unresolved.
4. Confirm resolved incidents exist with both ack and resolve timestamps, so MTTA
   and MTTR are computable. Print the computed values.
5. Confirm llm-fixtures.json has an entry matching the golden-path demo text.
6. Confirm the seed script defaults to LLM_PROVIDER=mock and makes zero network
   calls when run locally.

Report PASS/FAIL with the printed evidence for checks 2-5.
```

---

# PHASE 1 — Data & access spine

## B4 — DynamoDB repository layer

```
Implement packages/data — the only place in the codebase that touches DynamoDB.

1. Table definition matching CODEBASE_MAP.md §5 exactly, including GSI1-GSI4.
   Add it to template.yaml with BillingMode PAY_PER_REQUEST.
2. keys.ts: pure key-building functions for every entity. Zero-pad the priority
   score to 3 digits in the GSI1 sort key. Unit test the padding.
3. A DocumentClient wrapper that reads TABLE_NAME from env and points at
   LocalStack when STAGE=local.
4. Repositories: IncidentRepository, TimelineRepository, ReferenceRepository
   (tenants/users/teams/assets/locations), SlaPolicyRepository,
   RoutingRuleRepository, LinkRepository, MetricsRepository,
   RecommendationRepository, BudgetRepository.

Hard rules:
- Every public function takes tenantId as its FIRST argument. No exceptions.
- No Scan operations anywhere.
- Queue listing uses GSI1; asset history and dedupe candidates use GSI2; the SLA
  sweeper query uses GSI3; "my incidents" uses GSI4.
- GSI3 must be SPARSE: write slaActive and earliestDueAt only while an SLA is
  running, and REMOVE both attributes when the incident is resolved, merged or
  closed. Add a dedicated test proving a resolved incident disappears from GSI3.
- MetricsRepository uses atomic ADD updates only — never read-modify-write.
- Timeline writes are append-only with a conditional expression preventing
  overwrite of an existing event key.
- Cursor-based pagination using the encoded LastEvaluatedKey.

Write integration tests against LocalStack for every repository. Then complete
the seed script from the previous task so it actually persists.
```

## V4 — Verify data layer

```
Verify packages/data against LocalStack:
1. Start LocalStack, run bootstrap + seed, then pnpm --filter data test.
2. Prove GSI3 sparseness: query GSI3, resolve one incident, query again, confirm
   it is gone. Show both result counts.
3. Prove GSI1 ordering: list open incidents for north-hub and confirm strictly
   descending priority. Include an incident scored 9 and one scored 80 — confirm
   80 sorts above 9 (this catches missing zero-padding).
4. grep the whole repo for "ScanCommand" and "new Scan" — must return nothing
   outside tests.
5. grep services/ and packages/core for DynamoDB client imports — must return
   nothing.
6. Confirm every exported repository function has tenantId as its first parameter.
   List any that don't.
7. Run the same query for tenant north-hub and south-hub and confirm zero overlap
   in returned IDs.

Report PASS/FAIL with command output. Flag violations; do not fix them.
```

---

## B5 — Cognito + Cedar authorizer

```
Implement authentication and authorization.

1. In template.yaml: a Cognito user pool with groups worker, maintenance,
   supervisor, manager, admin; a custom attribute custom:tenantId; an app client
   for the SPA. Stay within the free tier — no advanced security features.
2. infra/cedar/: a Cedar schema and policy set implementing the permission matrix
   in the PRD §FR-11.3. Model entities as Principal (User with role + tenant),
   Action (one per API operation), Resource (Incident, Dashboard, Config,
   Recommendation, Copilot), all scoped by tenant. Include an explicit forbid
   policy for any cross-tenant access, written so it cannot be overridden by a
   permit.
3. services/authorizer: a Lambda REQUEST authorizer that validates the Cognito
   JWT (verify signature, issuer, audience, expiry), builds the Cedar request from
   the JWT claims and the requested route, evaluates the policy set, and returns
   an allow/deny with context {tenantId, userId, role, email}. Cache results 300s.
4. packages/platform: a helper that reads AuthContext from the API Gateway request
   context, and throws a typed error if it's missing. Handlers must use this and
   must never parse a JWT themselves.

Write unit tests for the Cedar policy set covering every cell of the permission
matrix — both the allowed and the denied direction — plus an explicit
cross-tenant denial test.
```

## V5 — Verify auth

```
Verify auth and authorization:
1. pnpm --filter authorizer test
2. Print a generated table of every (role, action) pair from the PRD permission
   matrix with the Cedar decision, and diff it against the PRD. Report any cell
   that disagrees.
3. Confirm a token for tenant north-hub is denied on a south-hub resource, and
   that the denial comes from the forbid policy, not from an absent permit.
4. Confirm an expired token, a token with a bad signature, and a missing token
   all return 401 (not 500).
5. grep services/ for jwt decode/verify calls outside services/authorizer — must
   return nothing.
6. Confirm the authorizer adds no VPC config and no extra managed policies beyond
   what it needs.

Report PASS/FAIL plus the decision-matrix diff table.
```

---

## B6 — Media uploads

```
Implement services/api-uploads.

POST /v1/uploads/presign
- Body: { kind: "photo" | "audio", contentType, sizeBytes }
- Validate: photo <= 5MB and image/jpeg|image/png|image/webp; audio <= 10MB and
  audio/webm|audio/mp4|audio/mpeg. Reject anything else with 400 and a clear code.
- Generate an S3 key: tenants/<tenantId>/incidents/staging/<ulid>.<ext>
- Return a presigned PUT URL expiring in 15 minutes plus the final key.

In template.yaml: the media bucket with SSE enabled, all public access blocked,
a CORS rule allowing PUT from the web origin, and a lifecycle rule deleting
objects under .../staging/ after 1 day so orphaned uploads don't accumulate cost.

Binaries must never pass through API Gateway. The incident create endpoint will
accept S3 keys only.
```

## V6 — Verify uploads

```
Verify uploads:
1. Request a presigned URL and PUT a small test image to it against LocalStack.
   Confirm the object exists at the expected key.
2. Confirm oversized and wrong-content-type requests return 400 with a specific
   error code, not a generic 500.
3. Confirm the returned key is tenant-prefixed and that a user from another
   tenant cannot obtain a URL for that prefix.
4. Confirm the bucket blocks public access and has SSE enabled in template.yaml.
5. Confirm the staging lifecycle rule exists with a 1-day expiry.
6. Confirm the presign URL expires in 15 minutes.

Report PASS/FAIL with evidence.
```

---

# PHASE 2 — Intake & AI triage

## B7 — LLM provider abstraction

```
Implement packages/ai.

1. An LLMProvider interface with: extractAndClassify(input), embed(text),
   answerQuery(question, context). Input for extractAndClassify accepts text plus
   optional image references and an optional prior transcript.
2. MockLLMProvider: loads seed/llm-fixtures.json, keys on a stable hash of the
   normalised input text, returns the fixture. For unknown inputs, return a
   deterministic derived response (keyword-based) rather than throwing. embed()
   returns a deterministic pseudo-random 256-dim unit vector seeded by the text
   hash, so cosine similarity is stable and meaningful across runs.
3. BedrockLLMProvider: uses the Bedrock Converse API. Model IDs come from env vars
   — never hardcode them. Cap maxTokens (800 for triage, 1200 for answerQuery).
   Support multimodal input by passing image bytes fetched from S3. Embeddings use
   EMBED_DIMENSIONS (default 256).
4. A factory selecting the provider from LLM_PROVIDER, defaulting to "mock".
5. Prompts as versioned files in src/prompts/: triage-extract.v1.md and
   copilot-answer.v1.md. Each prompt must demand strict JSON matching the
   TriageResult schema, with no prose and no markdown fences.
6. Response handling: strip fences defensively, parse, validate against the
   contracts schema. On validation failure, retry ONCE with a repair prompt that
   includes the validation errors. On second failure, throw a typed
   LlmSchemaError.
7. A rule-based fallback classifier (keyword + asset-name matching over the 7
   categories) exported separately, used by the triage pipeline when the LLM fails.
8. Token accounting: every call returns tokens used; the caller records it against
   the tenant's daily budget.

Cost rule: no code path may call Bedrock when LLM_PROVIDER=mock. Add a test that
fails if the Bedrock client is constructed under the mock provider.
```

## V7 — Verify AI layer

```
Verify packages/ai:
1. pnpm --filter ai test with LLM_PROVIDER unset — confirm it defaults to mock and
   makes zero network calls.
2. Call extractAndClassify with the golden-path text twice; confirm byte-identical
   output (determinism).
3. Call embed() on the same text twice; confirm identical vectors of length 256
   with magnitude ~1.0.
4. Confirm cosine similarity between the golden-path text and a seeded prior Dock 4
   conveyor incident is meaningfully higher than against an unrelated incident.
   Print all three similarity values.
5. Feed a deliberately malformed LLM response through the parser; confirm exactly
   one repair retry, then an LlmSchemaError.
6. Confirm prompts live in files, not inline strings: grep for prompt text in
   services/ — must return nothing.
7. Confirm maxTokens is set on every Bedrock call path.
8. Confirm the "no Bedrock client under mock" test exists and passes.

Report PASS/FAIL, with printed similarity values for check 4.
```

---

## B8 — Incident intake API

```
Implement the create and read endpoints in services/api-incidents.

POST /v1/incidents
- Body: { description, attachmentKeys[], locationHint?, assetHint?, isAnonymous? }
- Validate against the contracts schema.
- Move attachments from the staging prefix to
  tenants/<t>/incidents/<incidentId>/ and create attachment items.
- Write the incident with status NEW, a ULID id, reporterId from AuthContext,
  UTC timestamps.
- Write a timeline event INCIDENT_CREATED.
- Publish INCIDENT_CREATED to the EventBridge bus with a correlationId.
- Return 201 in under 500ms. Do NOT call the AI layer synchronously.

GET /v1/incidents — filters, GSI1 for status-scoped priority-sorted listing,
GSI4 for the worker's own incidents, cursor pagination, capped at 50 per page.

GET /v1/incidents/{id} — returns the incident, score breakdown, timeline
(ascending), attachments with short-lived presigned GET URLs, and related
incidents.

All handlers use the shared wrapper that maps typed errors to HTTP status codes,
attaches a correlationId, and emits structured logs.
```

## V8 — Verify intake

```
Verify the intake API against LocalStack:
1. POST a valid incident. Confirm 201, a ULID id, status NEW, and measure latency
   over 10 calls — report p95 (target < 500ms).
2. Confirm an INCIDENT_CREATED event landed on the bus (inspect LocalStack events
   or a test subscriber).
3. Confirm attachments moved out of the staging prefix into the incident prefix.
4. Confirm no AI call happens during POST: run with a provider that throws on any
   call, and confirm POST still returns 201.
5. GET the list with status=OPEN and confirm descending priority order.
6. GET a single incident and confirm the response includes timeline ascending,
   presigned attachment URLs, and a scoreBreakdown field (may be null pre-triage).
7. Confirm a worker can see their own incident but not another tenant's — expect
   403, and confirm the log records a security event.
8. Confirm every error response carries a correlationId.

Report PASS/FAIL with the latency table.
```

---

## B9 — Triage pipeline

```
Implement services/worker-triage, the EventBridge consumer for INCIDENT_CREATED.

Pipeline, in this exact order: extract → classify → score → dedupe → route.
This task covers extract and classify only; scoring, dedupe and routing are
separate tasks and should be called through clearly-named stub functions that the
next tasks will fill in.

Steps:
1. Set status TRIAGING and publish nothing yet.
2. If there is an audio attachment: transcribe it (Transcribe), and if the
   detected language is not English, translate for analysis while preserving and
   storing the original transcript and its language.
3. Build the AI input: description + transcript + image references + tenant asset
   and location names (so the model can resolve "Dock 4" to a real assetId).
4. Call extractAndClassify. Validate. On LlmSchemaError, use the rule-based
   fallback and set triageMode FALLBACK with confidence 0.3.
5. Persist every extracted field WITH its source ("ai" | "rule" | "human").
6. If confidence < 0.6 and the model returned a clarifyingQuestion: set status
   NEEDS_INFO, store the question, publish INCIDENT_NEEDS_INFO, and stop.
7. Otherwise continue to the (stubbed) scoring step.
8. Record tokens used against the tenant's daily budget. If the budget is
   exhausted, skip the LLM entirely and use the rule-based fallback — never fail
   the incident.
9. Write timeline events for transcription, AI classification (including model
   identifier and prompt version), and any fallback.
10. Wrap the whole handler so an unexpected error still moves the incident to a
    usable state with triageMode FALLBACK rather than leaving it stuck in TRIAGING.

Also implement POST /v1/incidents/{id}/answer: accepts the clarification, appends
it to the description, and re-runs triage exactly once.
```

## V9 — Verify triage

```
Verify the triage pipeline:
1. Submit the golden-path incident. Confirm within 10s: category
   EQUIPMENT_FAILURE, severity HIGH, locationId resolving to Dock 4, assetId
   CONV-D4, a non-empty summary and recommendedFirstAction.
2. Confirm each extracted field carries a source of "ai".
3. Force an LlmSchemaError; confirm the incident still completes with triageMode
   FALLBACK, confidence 0.3, and a timeline event recording the fallback.
4. Submit a deliberately vague report ("something is wrong near the back").
   Confirm status NEEDS_INFO with exactly ONE clarifying question. Answer it via
   the answer endpoint and confirm triage re-runs once and only once.
5. Exhaust the token budget and submit again; confirm the rule-based path is used
   and the incident is NOT left in an error state.
6. Kill the pipeline mid-run (throw after step 4); confirm no incident remains
   stuck in TRIAGING.
7. Confirm timeline events record the prompt version and model identifier.
8. Submit a Hindi voice note fixture; confirm the original transcript and language
   are stored and the English translation was used for analysis.

Report PASS/FAIL with the actual triage output JSON for check 1.
```

---

## B10 — Priority scoring engine

```
Implement packages/core/src/scoring — pure functions, no I/O, time passed in.

calculatePriority(input, weights, now) returns a full ScoreBreakdown.

Five factors, each normalised to 0-100 with a documented, deterministic formula:
- businessImpact: from affected order count / blocked throughput signals extracted
  by the AI, plus asset criticality. Document the mapping.
- safetyRisk: from the safety signals and category. Any SAFETY_INCIDENT category
  floors this at 70.
- slaUrgency: from time remaining against the SLA window — 0 when the window has
  just started, 100 at or past the deadline. Must be recomputable at any later
  time, since the sweeper refreshes it.
- recurrence: count of same-category incidents on the same asset in the last 30
  days, mapped 0→0, 1→30, 2→60, 3+→100.
- downtime: estimated stoppage minutes, mapped through documented bands.

Each factor returns rawValue, normalisedValue, weight, contribution and a short
human-readable explanation string. The UI renders these verbatim — write them for
a warehouse manager, not an engineer.

Also:
- Weights come from tenant config, validated to sum to 1.0 (±0.001).
- recalculateOpenIncidents(tenantId) recomputes scores when weights change or the
  sweeper refreshes slaUrgency, and updates the GSI1 sort key.
- Manual override: supervisor sets a priority; store it separately, preserve the
  computed score, mark overriddenBy in the timeline, and have the queue use the
  override.

Wire this into the triage pipeline, replacing the scoring stub. Unit test each
factor independently with table-driven cases, including boundaries.
```

## V10 — Verify scoring

```
Verify the scoring engine:
1. pnpm --filter core test — report coverage for the scoring module.
2. Print the full breakdown for the golden-path incident as a table: factor, raw,
   normalised, weight, contribution. Confirm total >= 78 and that recurrence is
   visibly elevated.
3. Confirm weights that don't sum to 1.0 are rejected with a clear error.
4. Confirm slaUrgency for the same incident increases when computed 30 minutes
   later (pass a later "now"), and that the total score rises accordingly.
5. Confirm a SAFETY_INCIDENT never scores safetyRisk below 70.
6. Confirm every factor returns a non-empty, plain-English explanation. Print all
   five for the golden path and assess whether a warehouse manager would
   understand them.
7. Confirm a manual override changes queue position while the computed score
   remains readable in the response.
8. Change a tenant's weights and confirm open incidents are rescored and GSI1
   ordering updates.

Report PASS/FAIL with the breakdown table and the five explanation strings.
```

---

## B11 — Duplicate detection

```
Implement duplicate and related-incident detection.

In packages/core/src/similarity (pure):
- cosineSimilarity(a, b)
- rankCandidates(target, candidates, thresholds) → classified results with
  similarity and a one-line reason.

In the triage pipeline, after scoring and before routing:
1. Embed summary + description + asset name (256 dims).
2. Store the embedding on the incident.
3. Fetch candidates via GSI2: same tenant, same assetId OR same locationId,
   created within 14 days, newest first, capped at 50.
4. Classify: similarity >= DUPLICATE_THRESHOLD AND same asset AND target still
   open → DUPLICATE_CANDIDATE. similarity >= RELATED_THRESHOLD → RELATED.
5. Write link items. NEVER auto-merge and never auto-close.
6. If a duplicate candidate exists, add a flag the UI can surface prominently.

Endpoints:
- GET /v1/incidents/{id}/related — links with similarity and reason, sorted desc.
- POST /v1/incidents/{id}/merge — supervisor+ only. Merges child into parent:
  transfers attachments, appends the child's description to the parent's timeline,
  sets child status MERGED with a parent reference, REMOVES the child's GSI3 SLA
  attributes, and increments the duplicate metric counter. Refuse to merge an
  incident into itself or to merge an already-merged incident (409).

Backfill embeddings for all seeded incidents in the seed script.
```

## V11 — Verify dedupe

```
Verify duplicate detection:
1. Submit the golden-path incident. Confirm >= 2 related Dock 4 conveyor incidents
   returned, each with a similarity score and a readable reason. Print them.
2. Confirm an unrelated incident (e.g. a cold-store alert) is NOT linked. Print
   its similarity for comparison.
3. Confirm nothing was auto-merged and no status changed as a side effect.
4. Merge a duplicate as a supervisor: confirm child status MERGED, attachments
   transferred, parent timeline updated, child removed from GSI3, duplicate
   counter incremented.
5. Confirm a worker role gets 403 on merge.
6. Confirm merging an incident into itself returns 409, and re-merging an already
   merged incident returns 409.
7. Confirm the candidate query is capped at 50 and uses GSI2 — show the query
   parameters.
8. Confirm all seeded incidents have embeddings of length 256.

Report PASS/FAIL with the similarity values from checks 1 and 2.
```

---

# PHASE 3 — Routing, SLA, escalation

## B12 — Routing engine

```
Implement packages/core/src/routing (pure) and wire it as the final triage step.

resolveRoute(incident, rules, teams, now) resolves in strict order:
1. asset-specific rule
2. category + location rule
3. category default
4. tenant fallback team

Return the target team AND the matched rule id and a human-readable reason —
the UI displays why the incident went where it went.

Shift awareness: if the resolved team has nobody on the active shift for the
tenant's timezone at "now", route to the fallback team and set routedOutOfShift.

On route:
- set status ROUTED and assignedTeamId
- compute SLA due dates (next task provides the SLA module; call it through a
  clearly-named stub for now)
- write a timeline event with the matched rule and reason
- publish INCIDENT_ROUTED

Reassignment: PATCH /v1/incidents/{id} with assignedTeamId, supervisor+ only,
requires a reason, writes a timeline event, does NOT reset SLA timers.

Implement the lifecycle state machine in packages/core/src/lifecycle and enforce
it in PATCH: illegal transitions return 409 INCIDENT_INVALID_TRANSITION. Table-
test every legal and illegal transition pair.
```

## V12 — Verify routing

```
Verify routing and lifecycle:
1. Confirm the golden-path incident routes to Maintenance via the CONV-D4
   asset-specific rule, and that the response states the matched rule and reason.
2. Confirm precedence: create an incident matching both an asset rule and a
   category rule, and confirm the asset rule wins.
3. Confirm an incident with no matching rule goes to the tenant fallback team.
4. Confirm out-of-shift routing sets routedOutOfShift and uses the fallback team.
   Show the timezone arithmetic used.
5. Print the full legal/illegal transition matrix with the API's actual response
   code for each, and confirm every illegal pair returns 409.
6. Confirm reassignment requires supervisor+, requires a reason, writes a timeline
   event, and does not alter ackDueAt or resolveDueAt.
7. Confirm INCIDENT_ROUTED is published exactly once per incident.

Report PASS/FAIL with the transition matrix.
```

---

## B13 — SLA engine, sweeper, escalation

```
Implement SLA tracking and escalation.

packages/core/src/sla (pure):
- resolveSlaPolicy(tenant, category, severity) → { ackMinutes, resolveMinutes }
- computeDueDates(routedAt, policy) → { ackDueAt, resolveDueAt }
- evaluateBreach(incident, now) → which timer (ack or resolve) has breached
- nextEscalationLevel(incident) → assignee → team supervisor → operations manager,
  each level firing at most once

On routing, write ackDueAt, resolveDueAt, slaActive=true and
earliestDueAt = min(ackDueAt, resolveDueAt) so GSI3 is populated.

services/worker-sla-sweeper, triggered by an EventBridge rule at rate(1 minute):
1. For each tenant, query GSI3 for earliestDueAt <= now, limit 100.
2. For each due incident: determine the breached timer, compute the next
   escalation level, write a timeline event, publish SLA_BREACHED and
   INCIDENT_ESCALATED, set an escalationLevel field.
3. Refresh slaUrgency and recompute the priority score so ageing incidents climb
   the queue (this must be visible in the UI).
4. Idempotent: re-running the sweeper must not double-escalate. Use a conditional
   write on escalationLevel.
5. If already at the top of the ladder, mark slaBreached and stop escalating, but
   keep refreshing urgency.

services/worker-notifier: subscribes to INCIDENT_ROUTED, SLA_BREACHED,
INCIDENT_ESCALATED, INCIDENT_NEEDS_INFO. Sends SNS notifications to the right
recipients per event, with a concise message and a deep link to the incident.
Log every notification as a timeline event.

On ACKNOWLEDGED: stop the ack timer, record actor and timestamp, update
earliestDueAt to resolveDueAt.
On RESOLVED/CLOSED/MERGED: REMOVE slaActive and earliestDueAt so the incident
leaves GSI3. Update MTTA/MTTR metrics.

Cost rule: exactly ONE scheduled rule for the whole system. Do not create a
schedule per incident.
```

## V13 — Verify SLA

```
Verify SLA and escalation:
1. Confirm exactly one EventBridge schedule exists in template.yaml, at
   rate(1 minute). Show the resource.
2. Create a HIGH equipment-failure incident; confirm ackDueAt is routedAt + 20min
   and that it appears in GSI3.
3. Advance the clock past the ack deadline and run the sweeper. Confirm: one
   escalation, a timeline event, SNS notification sent, escalationLevel set,
   priority score increased because slaUrgency rose. Print before/after scores.
4. Run the sweeper again immediately. Confirm NO second escalation at the same
   level (idempotency).
5. Advance further and confirm escalation walks the ladder one rung at a time and
   stops at the top with slaBreached set.
6. Acknowledge an incident and confirm the ack timer stops and earliestDueAt moves
   to resolveDueAt.
7. Resolve an incident and confirm it leaves GSI3 — query before and after, show
   both counts.
8. Confirm MTTA and MTTR counters updated correctly for that incident.
9. Confirm the sweeper query is bounded (limit 100) and does not scan.

Report PASS/FAIL with before/after priority scores and GSI3 counts.
```

---

# PHASE 4 — Frontend

## B14 — Web app shell, auth, and incident submission (PWA)

```
Build apps/web: React + Vite + TypeScript + Tailwind. Mobile-first — design for
390px width and scale up. Read the frontend-design guidance if available.

1. Cognito hosted-UI login, token storage, silent refresh, role-aware routing.
   Roles come from the token; the UI hides what the role can't do (the API still
   enforces it).
2. apiClient: typed against packages/contracts, attaches the JWT, surfaces the
   error envelope, and shows the correlationId in error toasts for debuggability.
3. Submit screen — the most important screen in the product. Optimise for a
   gloved hand on a warehouse floor:
   - Large text area, big touch targets
   - Camera capture (up to 3 photos), client-side downscale to max 1024px before
     upload, presigned PUT direct to S3 with per-file progress
   - Voice recording with a visible waveform or timer
   - Optional location/asset hints as quick-select chips, not dropdowns
   - Submit returns immediately; show an "Analysing…" state
4. Triage progress: poll GET /v1/incidents/{id} every 3s, STOP polling once status
   leaves NEW/TRIAGING or after 60s. Then reveal the result with the category,
   severity, assigned team and the score breakdown.
5. NEEDS_INFO handling: show the single clarifying question inline with a one-tap
   answer field.
6. Offline-first PWA:
   - service worker + manifest, installable
   - if offline at submit, queue the incident and any media in IndexedDB, show a
     clear pending badge, and sync automatically on reconnect
   - show a queued-items count in the header
7. Accessible: keyboard navigable, sufficient contrast, labelled inputs.

Build against MSW mocks derived from the contracts schemas so this can proceed
independently of backend deployment.
```

## V14 — Verify submit UX

```
Verify the web shell and submit flow:
1. Build and run. Confirm it works at 390px width with no horizontal scroll —
   test the submit, queue and detail screens.
2. Submit a text-only incident; confirm the "Analysing…" state and that polling
   stops once triage completes. Confirm polling also stops after 60s on a stuck
   incident.
3. Submit with a photo; confirm client-side downscale (check uploaded dimensions)
   and direct-to-S3 upload with progress.
4. Go offline in devtools, submit, confirm the item queues with a visible badge;
   go back online and confirm automatic sync without a page reload.
5. Confirm the app installs as a PWA and loads offline.
6. Confirm a worker account cannot see dashboard or admin navigation.
7. Confirm an API error surfaces a readable message including the correlationId.
8. Run an accessibility pass on the submit screen and report any contrast or
   labelling failures.
9. Confirm no network call polls faster than every 3s.

Report PASS/FAIL with screenshots or measured values where relevant.
```

---

## B15 — Incident queue and detail

```
Build the queue and detail views.

Queue (supervisor+):
- Sorted by priority score descending, with the score shown as a prominent badge
  colour-coded by band
- Each row: summary, category icon, severity, asset/location, assigned team, SLA
  countdown (live, updating every second, turning amber then red), escalation
  badge, duplicate flag
- Filters: status, severity, category, asset, location, team, minimum priority
- Cursor pagination with infinite scroll or a clear "load more"
- Empty and loading states that don't shift layout

Detail:
- Header: summary, status, severity, priority score
- **Score breakdown panel** — a horizontal bar per factor showing contribution,
  with raw value, weight and the plain-English explanation. This is the product's
  centrepiece; give it real design attention and make it the first thing below the
  header.
- AI provenance panel: what the model extracted, its confidence, the prompt
  version, and whether fallback was used. Expandable.
- Related incidents with similarity scores and reasons; a Merge action for
  supervisor+ with a confirmation dialog
- Routing explanation: which rule matched and why
- SLA panel: ack and resolve countdowns, escalation level, escalation history
- Timeline: chronological, typed icons, actor and timestamp
- Attachments: photo lightbox, audio player with transcript and original language
- Actions gated by role: acknowledge, start, resolve, reassign, override priority,
  merge, comment

Every mutation updates optimistically and reconciles against the server response.
```

## V15 — Verify queue and detail

```
Verify queue and detail:
1. Confirm the queue is ordered by priority descending and that an incident
   escalated by the sweeper visibly moves up. Show before/after.
2. Confirm SLA countdowns update live and change colour approaching the deadline.
3. Confirm every filter works and combines correctly; confirm pagination doesn't
   drop or duplicate rows.
4. On the detail view, confirm the score breakdown shows all five factors with
   contribution, weight, raw value and explanation. Screenshot it.
5. Confirm the AI provenance panel shows confidence, prompt version and fallback
   status.
6. Confirm related incidents show similarity and reason, and that Merge is hidden
   for a worker and present for a supervisor.
7. Confirm the routing explanation names the matched rule.
8. Confirm the timeline is chronological and includes creation, AI classification,
   routing, escalation and notification events.
9. Confirm an illegal action (e.g. resolve from NEW) is either not offered or
   surfaces the 409 clearly.
10. Confirm optimistic updates roll back correctly when the API rejects.

Report PASS/FAIL with the breakdown screenshot.
```

---

## B16 — Dashboard and metrics rollup

```
Implement metrics aggregation and the manager dashboard.

Backend (packages/data + services/api-dashboard):
- On every relevant state transition, atomically ADD to the daily metrics item:
  created, byCategory, bySeverity, acknowledged, resolved, ackSecondsTotal,
  resolveSecondsTotal, slaBreaches, escalations, duplicatesMerged,
  downtimeMinutesAvoided.
- GET /v1/dashboard/summary?days=7|14|30 reads at most 30 metric items and
  computes MTTA, MTTR, SLA breach rate, duplicate rate. NO SCANS.
- GET /v1/dashboard/hotspots returns the top 5 assets and top 5 locations by
  incident count and by total downtime, over the window.

Frontend (supervisor+):
- KPI row: open by severity, MTTA, MTTR, SLA breach rate, duplicate rate,
  estimated downtime avoided — each with the window's trend direction
- 14-day trend chart of incidents by category
- Hotspot table (asset, count, trend, last incident) linking through to the
  filtered queue
- Prevention recommendations panel (populated in Phase 5; render an empty state now)
- Date-range, location and category filters
- Every KPI has a tooltip explaining how it's computed — judges will ask

Keep charts lightweight; do not add a heavy charting dependency for four charts.
```

## V16 — Verify dashboard

```
Verify the dashboard:
1. Confirm summary and hotspots endpoints issue no Scan — print the DynamoDB
   operations used and the item count read per request.
2. Confirm MTTA and MTTR match a hand-computed value from the seeded resolved
   incidents. Show both calculations.
3. Confirm SLA breach rate and duplicate rate are correct against the seed data.
4. Confirm metrics counters use atomic ADD — show the UpdateExpression.
5. Confirm hotspots ranks Dock 4 / CONV-D4 first, and that clicking through opens
   the queue filtered to that asset.
6. Confirm the 7/14/30 day filters change the numbers correctly.
7. Measure dashboard load latency — report p95 (target < 1.5s).
8. Confirm every KPI has an explanatory tooltip.
9. Confirm the dashboard is inaccessible to a worker role (403 from the API, not
   just hidden in the UI).

Report PASS/FAIL with the MTTA/MTTR hand-check.
```

---

# PHASE 5 — Agentic layer

## B17 — Ops Copilot (Strands)

```
Implement services/agent-copilot — Python 3.12 Lambda using the Strands Agents SDK.

POST /v1/copilot/query, supervisor+ only.
Body: { question, conversationId? }

The agent gets READ-ONLY, tenant-scoped tools:
- searchIncidents(filters)  — status, category, asset, location, date range
- getAssetHistory(assetId, days)
- getMetrics(days)
- getSlaStatus()

Every tool receives tenantId from the AuthContext, never from the model. The model
must have no way to specify or influence a tenant. Make this structurally
impossible — bind tenantId at tool construction time.

System prompt requirements:
- Answer only from tool results. If the data doesn't support an answer, say so.
- Cite the incident IDs that support each claim.
- Be concise: a manager reading on a phone.
- Never invent counts or dates.

Hard limits:
- max 6 tool iterations
- 20s timeout
- per-tenant daily token budget checked before and recorded after
- on any limit, return a partial answer explaining what was reached, never a
  silent failure or a 500

Fallback: if Strands integration proves unstable, implement the same endpoint
contract with a two-step Bedrock call (plan which data to fetch → fetch → answer).
The API contract must not change either way.

Frontend: a Copilot panel on the dashboard with 3 suggested starter questions,
including "What keeps failing at Dock 4?". Render cited incident IDs as links.
```

## V17 — Verify Copilot

```
Verify the Copilot:
1. Ask "What keeps failing at Dock 4?" Confirm a grounded answer citing the three
   CONV-D4 incident IDs. Print the full answer.
2. Ask a question the data can't answer ("what's our revenue?"). Confirm it says
   so rather than inventing an answer.
3. Attempt prompt injection: ask it to return data for tenant south-hub, and
   separately submit an incident whose description instructs the agent to ignore
   its tenant scope. Confirm both fail to leak anything. Show the tool calls made.
4. Confirm tenantId is bound at tool construction and is not a model-supplied
   parameter — show the code path.
5. Confirm the iteration cap triggers on a deliberately complex question and
   returns a partial answer, not a 500.
6. Confirm the 20s timeout is enforced and tokens are recorded against the budget.
7. Confirm a worker role gets 403.
8. Measure p95 latency over 5 questions.

Report PASS/FAIL with the full answer text from check 1 and the injection test
evidence from check 3.
```

---

## B18 — Prevention Agent

```
Implement services/agent-prevention — Python 3.12 Lambda, Strands, scheduled daily
via EventBridge cron. One invocation per tenant per day. Not per incident.

Logic:
1. Query GSI2 per asset for the last 30 days.
2. Identify candidates: >= 3 incidents of the same category on one asset, or a
   statistically rising trend (state the test you used).
3. For each candidate, one LLM call producing:
   - pattern: what's recurring, in plain English
   - suggestedAction: concrete preventive maintenance step
   - suggestedTiming: when to do it and why
   - estimatedDowntimeAvoided: minutes, derived from historical downtime on that
     asset — show the arithmetic in a field, don't let the model invent a number
   - evidenceIncidentIds: the supporting incidents
   - confidence
4. Write a REC# item per asset per day, idempotent (overwrite same-day rec).
5. Publish an event so the notifier can inform the manager.

Endpoints:
- GET /v1/recommendations — active recommendations, newest first
- PATCH /v1/recommendations/{id} — accept or dismiss. Accept creates a scheduled
  preventive-maintenance incident assigned to the target team, pre-filled from the
  recommendation and linked back to the evidence incidents.

Frontend: recommendations panel on the dashboard showing pattern, action, timing,
downtime avoided, evidence chips linking to incidents, and Accept/Dismiss buttons.

Cost rule: at most one LLM call per candidate asset per day, capped at 10
candidates per tenant per run.

Add an admin-only manual trigger so the demo doesn't depend on waiting for cron.
```

## V18 — Verify Prevention Agent

```
Verify the Prevention Agent:
1. Trigger manually for north-hub. Confirm a recommendation for CONV-D4 citing the
   three seeded conveyor incidents. Print it in full.
2. Confirm estimatedDowntimeAvoided is derived from stored historical downtime and
   that the arithmetic is recorded in a field — not produced freehand by the model.
3. Confirm it does NOT recommend for assets with fewer than 3 incidents and no
   rising trend. List assets considered and rejected with the reason.
4. Run twice on the same day; confirm exactly one recommendation per asset
   (idempotent overwrite, not duplicates).
5. Confirm the per-run cap of 10 candidates and one LLM call per candidate. Print
   the call count.
6. Accept a recommendation; confirm a preventive-maintenance incident is created,
   assigned to the right team, pre-filled, and linked to the evidence incidents.
7. Dismiss one; confirm it leaves the active list and is not regenerated the same
   day.
8. Confirm the manual trigger is admin-only.

Report PASS/FAIL with the full recommendation text and the LLM call count.
```

---

# PHASE 6 — Deploy & harden

## B19 — Infrastructure and deployment

```
Finalise template.yaml and the deployment scripts.

template.yaml must define: HTTP API + Lambda authorizer, all Lambdas, DynamoDB
table with GSI1-4 (PAY_PER_REQUEST), media S3 bucket, static-site bucket +
CloudFront (OAC, SPA fallback to index.html on 403/404), EventBridge bus + the
single rate(1 minute) rule + the daily prevention cron, SNS topic, Cognito pool
and client, and the parameter set for staging/prod.

Mandatory cost and safety settings:
- NO VPC configuration on any Lambda. NO NAT Gateway.
- LogGroup resources with RetentionInDays: 7 for EVERY function — do not rely on
  implicit log groups with infinite retention.
- Least-privilege IAM per function: scope DynamoDB actions to the table and its
  indexes, S3 to the specific prefix, Bedrock to InvokeModel only.
- Lambda memory tuned per function (256MB for API handlers, 512MB for triage);
  timeouts explicit and tight.
- ARM64 architecture for lower cost.
- An AWS Budgets resource alerting at $10 and $25.
- No provisioned concurrency anywhere.

Scripts in infra/scripts/:
- deploy.sh <stage> — build, deploy, sync the web bundle to S3, invalidate
  CloudFront, print the URL
- teardown.sh <stage> — full delete including emptying buckets
- prewarm.sh <stage> — hit every API Lambda and the web origin to eliminate cold
  starts before a demo
- seed.sh <stage> — seed a deployed stage

Document the full cold-start deploy in README.md, with expected duration.
```

## V19 — Verify deployment

```
Verify deployment:
1. Run deploy.sh staging from a clean state. Time it and report the duration.
2. Confirm the printed URL loads over HTTPS and the SPA handles a deep link
   refresh without a 404.
3. Audit template.yaml and report: any VPC config (expect none), any NAT gateway
   (expect none), every function's memory/timeout/architecture, and every function
   WITHOUT an explicit LogGroup with RetentionInDays 7.
4. Confirm least-privilege IAM: list any policy containing a wildcard resource or
   a wildcard action. Report each one.
5. Confirm exactly two EventBridge schedules exist (SLA sweeper, prevention cron).
6. Confirm the Budgets resource exists with $10 and $25 thresholds.
7. Run prewarm.sh and then measure first-request latency for the queue and
   dashboard endpoints — report p95.
8. Run the golden path end to end on the deployed stage.
9. Run teardown.sh on a throwaway stage and confirm no orphaned buckets, log
   groups or tables remain.

Report PASS/FAIL, the IAM wildcard list, and the log-retention audit table.
```

---

## B20 — Observability, guardrails, resilience

```
Harden the system.

Logging and tracing:
- Structured JSON logs everywhere, always carrying correlationId, tenantId, route,
  and duration. Never log PII, raw media bytes, or full prompts — log prompt
  version instead.
- Propagate correlationId from the API through EventBridge into the triage
  pipeline and back into timeline events.
- X-Ray on the triage path only (cost control).

Alarms (keep them few and cheap):
- Lambda error rate on triage and the sweeper
- API Gateway 5xx rate
- DynamoDB throttles
- A custom metric for incidents stuck in TRIAGING for over 5 minutes

Guardrails:
- Per-tenant daily token budget enforced in the AI layer; on exhaustion, degrade
  to the rule-based classifier and log a warning. Never fail the user's request.
- Simple per-user rate limiting on POST /incidents and /copilot/query, returning
  429 with a clear code.
- Input size limits enforced before any AI call.

Resilience:
- Dead-letter queue on the triage Lambda; a documented replay procedure.
- Retry with exponential backoff and jitter on Bedrock throttling, max 2 retries.
- A health endpoint reporting DynamoDB reachability, bus reachability, and which
  LLM provider is active.
- A documented and tested "LLM completely unavailable" path: incidents still get
  created, routed via the rule-based classifier, and SLA-tracked. Prove it.

Add a SECURITY.md noting: tenant isolation approach, prompt-injection mitigations,
media access controls, and what a production version would add (this is a good
judging talking point).
```

## V20 — Verify hardening

```
Verify observability and resilience:
1. Submit an incident and trace one correlationId through: API log → EventBridge →
   triage log → timeline event. Show all four.
2. grep logs for PII, raw prompt text and media content — report anything found.
3. Disable Bedrock access entirely and run the golden path. Confirm the incident is
   still created, classified by rules, routed and SLA-tracked. Print the result.
4. Exhaust a tenant's token budget; confirm graceful degradation with a logged
   warning and no user-facing error.
5. Exceed the rate limit; confirm 429 with a specific error code.
6. Force a triage failure; confirm the message lands in the DLQ and that the
   documented replay procedure actually works.
7. Confirm all four alarms exist and describe what each would catch.
8. Call the health endpoint; confirm it reports dependency status and the active
   LLM provider.
9. Confirm X-Ray is enabled ONLY on the triage path.
10. Confirm SECURITY.md exists and covers all four required topics.

Report PASS/FAIL with the correlationId trace from check 1 and the LLM-outage
result from check 3.
```

---

# PHASE 7 — Demo

## B21 — Demo mode, script, and documentation

```
Make the demo bulletproof.

Demo Mode:
- POST /v1/admin/demo/reset — admin only, refuses unless DEMO_MODE=true. Wipes the
  tenant's incidents, links, metrics and recommendations, reloads the seed
  scenario with dates shifted relative to now (so "3 failures in 9 days" is always
  true), regenerates embeddings, and returns a summary of what was created.
- An admin UI button for it with a confirmation dialog.
- A scenario switch that pre-sets one incident to be 2 minutes from SLA breach, so
  escalation can be demonstrated live without waiting.
- With LLM_PROVIDER=mock, the golden path must produce byte-identical output on
  every reset.

Documentation:
- README.md: what it is, the problem, architecture diagram, AWS services and why
  each was chosen, local setup, deploy, demo instructions, cost notes, roadmap.
- An architecture diagram as a committed image plus its source.
- DEMO.md: a 5-minute script with per-step timings, the exact text to type, what
  to say, what to point at, and a fallback action for every step.
- A metrics slide summarising triage time, duplicate rate, MTTA/MTTR, SLA breaches
  prevented and downtime avoided, with baselines clearly labelled as illustrative.
- Update CODEBASE_MAP.md §14 to show all phases complete.

Also add a Playwright E2E test covering the golden path from PRD §10, steps 1-12,
including the cross-tenant 403.
```

## V21 — Final readiness check

```
Final pre-submission verification. Be thorough and blunt — this is the last gate.

1. Run demo reset. Then run the full golden path (PRD §10, steps 1-12) on the
   DEPLOYED stage. Report each step PASS/FAIL with timings.
2. Run demo reset again and repeat. Confirm identical results both times.
3. Run the Playwright E2E. Confirm green, including the cross-tenant 403.
4. Open the deployed URL on a 390px viewport and walk the worker → supervisor →
   manager journey. Report anything unusable on a phone.
5. Confirm the SLA-imminent scenario escalates live within 3 minutes of reset.
6. Confirm the prevention recommendation is present immediately after reset (not
   waiting for cron).
7. Confirm the Copilot answers the Dock 4 question correctly after reset.
8. Check AWS Cost Explorer for the project's total spend to date. Report the
   figure and the top three cost drivers.
9. Confirm README, DEMO.md, architecture diagram and SECURITY.md all exist and are
   accurate against the actual deployed system. Report any stale claim.
10. Confirm CODEBASE_MAP.md §14 reflects reality — flag any status marked complete
    that isn't.
11. Run prewarm.sh, then measure cold-path latency for submit, queue and dashboard.
12. List every known issue, feature-flagged-off capability, and anything in the
    README that overstates what the system does.

Produce a single readiness report: PASS/FAIL per item, the cost figure, measured
latencies, and a prioritised list of anything that must be fixed before
submission. Do not fix anything — report only.
```

---

## Recovery prompts (use as needed)

**When an agent has gone off-scope**
```
Stop. Compare the diff you produced against the task scope you were given. List
every change that was outside that scope. Revert those changes, keep the in-scope
work, and re-run the verification prompt for this task. Then explain what caused
the scope drift so I can tighten the next prompt.
```

**When you're handing over to a fresh agent mid-project**
```
Read CODEBASE_MAP.md. Then, WITHOUT changing any code, produce an orientation
report: what is implemented, what is stubbed, what is broken, what §14 claims that
the code doesn't support, and the three highest-risk gaps. Cite specific files.
End with the single next task you'd recommend and why.
```

**When debugging something you can't reproduce**
```
Do not change any code yet. Form three competing hypotheses for this failure,
ranked by likelihood, each with the specific evidence that would confirm or rule
it out. Tell me exactly what to run or log to distinguish between them. Wait for
the result before proposing a fix.
```

**When you're running out of time**
```
Given the current state, produce a cut list: what to feature-flag OFF to guarantee
the golden path (PRD §10) works end to end, ordered by what's safest to cut first.
For each item, state what breaks and what the demo loses. Do not make any changes
— I'll decide.
```
