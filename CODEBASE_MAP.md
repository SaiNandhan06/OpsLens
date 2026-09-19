# OpsLens — Codebase Map & Agent Handbook
**Give this file to any coding agent before it touches the repo.**
Keep it at `/CODEBASE_MAP.md` in the repository root. It is the single source of truth about *where things live and how we do things here*.

> **Read this first, then read only the files listed under the module you're changing.**
> Do not scan the whole repository. This document exists so you don't have to.
> If something here contradicts the code, the code is the bug **or** this file is stale — say which, don't silently pick one.

---

## 1. What this product is

OpsLens converts unstructured warehouse incident reports (text, photo, voice) into scored, routed, SLA-tracked work items, detects duplicates and recurring failures, and recommends preventive action. Multi-tenant SaaS on AWS serverless.

The core differentiator is **business-impact-based priority scoring** with a visible breakdown. Any change that hides or weakens that breakdown is wrong, regardless of how clean it looks.

**Judged on:** idea and impact, AWS implementation quality, demo quality. Optimise for demo reliability over feature count.

---

## 2. Stack

| Layer | Choice |
|---|---|
| Language | TypeScript (Node 20) everywhere except the two Strands agent Lambdas (Python 3.12) |
| Package manager | pnpm workspaces |
| Backend | AWS Lambda + API Gateway HTTP API |
| IaC | AWS SAM (`template.yaml`) |
| Database | DynamoDB, single table, on-demand billing |
| Object storage | S3 (media), presigned uploads |
| Auth | Cognito user pool + Cedar policy evaluation in a Lambda authorizer |
| AI | Amazon Bedrock (classification + embeddings) behind a provider interface |
| Agents | Strands Agents SDK (Copilot, Prevention Agent) |
| Events | EventBridge custom bus `opslens-events` |
| Notifications | SNS |
| Frontend | React 18 + Vite + TypeScript + Tailwind, PWA, deployed to S3 + CloudFront |
| Validation | One schema library, used in both runtime validation and type inference |
| Testing | Vitest (unit/integration), Playwright (one golden-path E2E) |
| Local stack | LocalStack + SAM CLI + MockLLMProvider |

---

## 3. Repository layout

```
opslens/
├── CODEBASE_MAP.md              ← this file. Update it when you change structure.
├── README.md                    ← setup, run, deploy, demo instructions
├── template.yaml                ← SAM: all Lambdas, API, tables, buses, rules
├── samconfig.toml
├── pnpm-workspace.yaml
├── docker-compose.localstack.yml
│
├── packages/
│   ├── contracts/               ← ⚠️ SHARED. Types, enums, API schemas, error codes.
│   │   └── src/{incident,auth,api,events,errors,scoring}.ts
│   ├── core/                    ← pure domain logic. NO aws-sdk imports. Fully unit-testable.
│   │   └── src/
│   │       ├── scoring/         ← priority score calculation + breakdown
│   │       ├── routing/         ← rule resolution
│   │       ├── sla/             ← due-date computation, breach + escalation rules
│   │       ├── lifecycle/       ← state machine, legal transitions
│   │       └── similarity/      ← cosine, thresholds, candidate ranking
│   ├── data/                    ← DynamoDB repository layer. The ONLY place with table access.
│   │   └── src/{client,keys,repositories/*,metrics}.ts
│   ├── ai/                      ← LLM + embedding providers behind one interface
│   │   └── src/{provider,bedrock,mock,prompts/*,schemas}.ts
│   └── platform/                ← logger, correlation IDs, error mapping, config, event publisher
│
├── services/                    ← one folder per Lambda. Handlers stay thin.
│   ├── authorizer/              ← Cedar evaluation → AuthContext
│   ├── api-incidents/           ← create, list, get, patch, comment, merge, answer
│   ├── api-uploads/             ← presigned URLs
│   ├── api-dashboard/           ← summary, hotspots, recommendations
│   ├── api-config/              ← scoring weights, SLA policies, reference data
│   ├── api-admin/               ← demo reset / seed
│   ├── worker-triage/           ← EventBridge consumer: extract→classify→score→dedupe→route
│   ├── worker-sla-sweeper/      ← rate(1 minute) scheduled breach detection
│   ├── worker-notifier/         ← SNS fan-out on escalation/routing events
│   ├── agent-copilot/           ← Python · Strands · read-only NL query
│   └── agent-prevention/        ← Python · Strands · daily pattern → recommendations
│
├── apps/
│   └── web/
│       └── src/
│           ├── features/{submit,queue,incident,dashboard,copilot,admin}/
│           ├── components/      ← shared UI primitives
│           ├── lib/{apiClient,auth,offlineQueue,polling}.ts
│           └── pwa/             ← service worker, manifest
│
├── infra/
│   ├── cedar/                   ← .cedar policy files + schema
│   └── scripts/{deploy,teardown,prewarm,seed}.sh
│
└── seed/
    ├── tenants.json  assets.json  teams.json  sla-policies.json
    ├── incidents.json           ← includes the Dock-4 recurrence cluster
    └── llm-fixtures.json        ← deterministic MockLLMProvider responses
```

---

## 4. Architecture rules (non-negotiable)

1. **Handlers are thin.** A Lambda handler parses input, calls `packages/core` and `packages/data`, and formats the response. No business logic in `services/**`.
2. **`packages/core` is pure.** No AWS SDK, no network, no clock reads. Time is passed in as a parameter. This is what makes scoring and SLA logic testable in milliseconds.
3. **Only `packages/data` touches DynamoDB.** Nothing else imports the DynamoDB client. Ever.
4. **Every repository function takes `tenantId` as its first argument.** This is how tenant isolation is enforced structurally rather than by discipline.
5. **Every AI call goes through `packages/ai`'s provider interface.** No direct Bedrock calls anywhere else. This is what makes `LLM_PROVIDER=mock` work.
6. **`packages/contracts` is shared and change-controlled.** Changing it affects every track. Do not modify it unless the prompt explicitly instructs you to — flag the need instead.
7. **Lambdas are not in a VPC.** Do not add VPC configuration. It adds cold-start latency and risks a NAT Gateway, which we will not pay for.
8. **No full-table scans.** If you find yourself writing a `Scan`, the access pattern is wrong. Add or use a GSI.
9. **Timeline events are append-only.** Never update or delete one.
10. **All timestamps are UTC ISO-8601 strings.** Local time formatting happens in the browser only.

---

## 5. Data model quick reference

Single table `opslens`. Full spec in `02_PRD.md` §8 — this is the working summary.

```
PK                         SK                                     Entity
TENANT#<t>                 META                                   tenant config + scoring weights
TENANT#<t>                 USER#<id> | TEAM#<id> | ASSET#<id>     reference data
TENANT#<t>                 SLA#<category>#<severity>              SLA policy
TENANT#<t>                 ROUTE#<priority>#<ruleId>              routing rule
TENANT#<t>                 INCIDENT#<ulid>                        incident
TENANT#<t>                 INCIDENT#<ulid>#EVT#<ts>#<seq>         timeline (append-only)
TENANT#<t>                 INCIDENT#<ulid>#ATT#<id>               attachment
TENANT#<t>                 INCIDENT#<parent>#LINK#<child>         duplicate/related link
TENANT#<t>                 METRICS#<yyyy-mm-dd>                   daily counters (atomic ADD)
TENANT#<t>                 REC#<yyyy-mm-dd>#<assetId>             prevention recommendation
TENANT#<t>                 BUDGET#<yyyy-mm-dd>                    token budget counters
```

| Index | PK | SK | Used by |
|---|---|---|---|
| GSI1 | `TENANT#<t>#STATUS#<status>` | `PRIO#<score:3>#<createdAt>` | priority-sorted queue |
| GSI2 | `TENANT#<t>#ASSET#<assetId>` | `TS#<createdAt>` | asset history, dedupe candidates, recurrence |
| GSI3 | `TENANT#<t>#SLA#ACTIVE` | `DUE#<earliestDueAt>` | sweeper — **sparse**, attrs removed on resolve |
| GSI4 | `TENANT#<t>#USER#<reporterId>` | `TS#<createdAt>` | "my submissions" |

**Traps that have bitten people here:**
- Forget to delete the GSI3 attributes on resolve → sweeper re-escalates closed incidents forever.
- Zero-pad the priority score to 3 digits in GSI1's sort key, or 9 sorts above 80.
- Embeddings are 256-dim, not 1024. Larger costs more and buys nothing at this scale.

---

## 6. Incident lifecycle

```
NEW ──► TRIAGING ──► ROUTED ──► ACKNOWLEDGED ──► IN_PROGRESS ──► RESOLVED ──► CLOSED
         │              │                                            │
         └──► NEEDS_INFO ┘                                           └──► REOPENED ──► IN_PROGRESS
         └──► MERGED (child of a duplicate)
```

Transitions are validated in `packages/core/src/lifecycle`. Illegal transitions return `409` with code `INCIDENT_INVALID_TRANSITION`. The state machine is the only authority — do not add ad-hoc status writes in handlers.

---

## 7. Event flow

Bus: `opslens-events`. Every event carries `{tenantId, incidentId, correlationId, occurredAt}`.

| Event | Emitted by | Consumed by |
|---|---|---|
| `INCIDENT_CREATED` | api-incidents | worker-triage |
| `INCIDENT_TRIAGED` | worker-triage | metrics rollup |
| `INCIDENT_ROUTED` | worker-triage | worker-notifier |
| `INCIDENT_NEEDS_INFO` | worker-triage | worker-notifier |
| `SLA_BREACHED` | worker-sla-sweeper | worker-notifier |
| `INCIDENT_ESCALATED` | worker-sla-sweeper | worker-notifier |
| `INCIDENT_RESOLVED` | api-incidents | metrics rollup |

The triage pipeline order is fixed: **extract → classify → score → dedupe → route**. Deduplication must run before routing so a confirmed duplicate never pages a second team.

---

## 8. AI layer contract

`packages/ai` exposes one interface. Implementations: `BedrockLLMProvider`, `MockLLMProvider`.

| Method | Purpose |
|---|---|
| `extractAndClassify(input)` | text + optional images → structured triage result |
| `embed(text)` | → 256-dim vector |
| `answerQuery(question, context)` | Copilot fallback path (non-agentic) |

**Rules:**
- Output is validated against a strict schema. On failure: one repair retry, then the rule-based fallback with `triageMode: FALLBACK` and `confidence: 0.3`.
- `LLM_PROVIDER` defaults to `mock` in local and test. Real Bedrock requires an explicit opt-in. This protects the AWS credit budget — respect it.
- Every call caps `maxTokens`, records tokens used against the tenant's daily budget, and logs the correlation ID.
- Prompts live in `packages/ai/src/prompts/`, versioned as files. Do not inline prompt strings in handlers.
- Model IDs come from environment configuration and must be verified against the Bedrock console for the deployed region. Do not hardcode a model ID from memory — availability differs by region.

---

## 9. Auth and authorization

1. Cognito issues a JWT. Groups map to roles: `worker`, `maintenance`, `supervisor`, `manager`, `admin`.
2. `tenantId` is a custom claim on the user.
3. The Lambda authorizer validates the JWT, builds a Cedar request, evaluates the policy set in `infra/cedar/`, and returns context `{tenantId, userId, role}`.
4. Handlers read `AuthContext` from the request context. **Handlers never parse the JWT themselves.**
5. Authorizer results are cached for 300s.

The permission matrix is in `02_PRD.md` §FR-11.3. Cedar policies are the implementation of that matrix — they must stay in sync.

---

## 10. Conventions

**Naming** — files `kebab-case.ts`; types `PascalCase`; functions/variables `camelCase`; constants `UPPER_SNAKE`; DynamoDB attributes `camelCase`; env vars `UPPER_SNAKE`.

**Errors** — throw typed `AppError` subclasses from core/data; map to HTTP in one shared handler wrapper. Never return a raw stack trace. Every error response carries a `correlationId`.

**Logging** — structured JSON only. Always include `correlationId`, `tenantId`, `route`. Never log PII, raw media, or full model prompts (log a prompt *version* instead).

**Testing**
- `packages/core` — unit tests, high coverage, no mocks needed (pure functions)
- `packages/data` — integration tests against LocalStack
- `services/**` — handler tests with mocked repositories
- One Playwright E2E covering the golden path in `02_PRD.md` §10
- **Required test, do not remove:** cross-tenant access returns 403

**Git** — Conventional Commits. One branch per phase: `phase-3-sla-escalation`. Never commit `.env`, credentials, or seed data containing real names.

---

## 11. Environment variables

| Var | Local default | Purpose |
|---|---|---|
| `STAGE` | `local` | local \| staging \| prod |
| `TABLE_NAME` | `opslens-local` | DynamoDB table |
| `MEDIA_BUCKET` | `opslens-media-local` | S3 bucket |
| `EVENT_BUS_NAME` | `opslens-events-local` | EventBridge bus |
| `LLM_PROVIDER` | `mock` | `mock` \| `bedrock` — **defaults to mock on purpose** |
| `BEDROCK_REGION` | — | region with model access enabled |
| `BEDROCK_TEXT_MODEL_ID` | — | verified in console, not assumed |
| `BEDROCK_EMBED_MODEL_ID` | — | embeddings model |
| `EMBED_DIMENSIONS` | `256` | keep at 256 |
| `DUPLICATE_THRESHOLD` | `0.93` | cosine threshold for duplicate |
| `RELATED_THRESHOLD` | `0.86` | cosine threshold for related |
| `DEMO_MODE` | `true` | enables the reset endpoint |
| `DAILY_TOKEN_BUDGET` | `200000` | per tenant per day |
| `LOG_LEVEL` | `debug` | |

---

## 12. How to run

```
pnpm install
docker compose -f docker-compose.localstack.yml up -d
pnpm run bootstrap:local      # create table, bucket, bus
pnpm run seed:local           # load seed/ data + embeddings
pnpm run dev:api              # SAM local
pnpm run dev:web              # Vite
pnpm test
```

Deploy: `./infra/scripts/deploy.sh staging` · Teardown: `./infra/scripts/teardown.sh staging` · Pre-demo: `./infra/scripts/prewarm.sh prod`

---

## 13. Cost guardrails — read before adding infrastructure

**Never add:** NAT Gateway, VPC for Lambdas, OpenSearch (Service or Serverless), ECS/EKS/Fargate services, EC2, RDS/Aurora provisioned, provisioned concurrency, DynamoDB provisioned capacity, QuickSight paid users, SageMaker endpoints.

**Always:** DynamoDB on-demand · CloudWatch log retention 7 days on every new log group · `maxTokens` capped on every AI call · `LLM_PROVIDER=mock` for development.

If a task seems to require something on the "never" list, **stop and flag it** rather than provisioning it. There is almost always a serverless alternative, and the project lead wants to make that call.

---

## 14. Current status

Update this table at the end of every phase. This is how the next agent knows where to pick up.

| Phase | Area | Status | Notes |
|---|---|---|---|
| 0 | Repo, contracts, seed | ✅ complete | Repo scaffold, packages/contracts (Zod types & schemas), seed datasets, and seed script complete |
| 1 | Data layer + repositories | ✅ complete | packages/data single-table DynamoDB access layer, pure keys with 3-digit zero-padded GSI1, DocClient LocalStack wrapper, 9 repositories, sparse GSI3, atomic ADD metrics, unit & LocalStack integration tests passing, seed persistence wired |
| 1 | Cognito + Cedar authorizer | ⬜ not started | |
| 2 | Intake API + presigned uploads | ⬜ not started | |
| 2 | AI provider + triage pipeline | ⬜ not started | |
| 2 | Priority scoring | ⬜ not started | |
| 2 | Duplicate detection | ⬜ not started | |
| 3 | Routing engine | ⬜ not started | |
| 3 | SLA + sweeper + escalation | ⬜ not started | |
| 4 | Web app shell + submit (PWA) | ⬜ not started | |
| 4 | Queue + incident detail | ⬜ not started | |
| 4 | Dashboard + metrics | ⬜ not started | |
| 5 | Copilot agent | ⬜ not started | |
| 5 | Prevention agent | ⬜ not started | |
| 6 | SAM deploy + CloudFront | ⬜ not started | |
| 6 | Observability + budgets | ⬜ not started | |
| 7 | Demo mode + script | ⬜ not started | |

**Known issues / open decisions**
_(agents: append here, don't overwrite)_

- [ ] Bedrock model IDs pending region verification
- [ ] Strands vs. plain Bedrock fallback for Copilot — decide by end of Phase 5

---

## 15. Instructions for coding agents

1. **Read this file. Then read only the module you're changing.** Don't scan the repo.
2. **Stay inside the scope of your prompt.** If you spot a bug elsewhere, note it in §14 under Known issues. Don't fix it.
3. **Never modify `packages/contracts` unless told to.** If you need a change there, stop and say so.
4. **Never add infrastructure from the §13 "never add" list.** Flag it instead.
5. **Write tests as you go**, in the style described in §10.
6. **Update §14** — status row plus any new known issue — as the last step of your task.
7. **If this document is wrong or stale, say so explicitly** in your summary. A silently stale map is worse than no map.
8. **End every task with a short report**: files created/modified, commands to verify, assumptions made, anything you deliberately left out.
