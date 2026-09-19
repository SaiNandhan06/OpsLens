# OpsLens — Engineering Project Plan
**Bharat Build AWS Hackathon | Incident Intelligence for Warehouse Operations**
Version 1.0 · Planning owner: technical lead (you) · Implementation: coding agents

---

## 0. Executive read

OpsLens turns messy, human-reported warehouse incidents into **scored, routed, SLA-tracked, and pattern-aware** work items. The judged story is a single unbroken loop:

> **report → understand → prioritise by business impact → route → escalate → prevent**

The three things that decide whether you win:

1. **The demo runs flawlessly in under 5 minutes.** Nothing else matters if the demo stalls.
2. **The priority score is visibly business-driven**, not a dropdown. Judges have seen a hundred ticketing tools.
3. **The "prevent" step closes the loop.** Most submissions stop at "AI classified the ticket." Yours should end with *"Dock 4 has failed 3× in 9 days; schedule motor inspection Tuesday; estimated downtime avoided: 94 minutes."*

Everything in this plan is ordered so that if you run out of time, you cut from the bottom and still have a complete story.

---

## 1. Scope decisions (locked before any code is written)

These are the decisions that prevent the most rework. Treat them as frozen; changing one mid-build costs you half a day.

| # | Decision | Choice | Why |
|---|---|---|---|
| D1 | Vertical | Warehouse & logistics only | Single vocabulary for assets, SLAs, impact model. Multi-industry is a trap. |
| D2 | Tenancy | Multi-tenant, single DynamoDB table, tenant-prefixed keys | Proves SaaS thinking without per-tenant infra cost. |
| D3 | Compute | Lambda + API Gateway HTTP API (serverless, scale-to-zero) | Idle cost ≈ $0. Containers/EKS bill while you sleep. |
| D4 | AI hot path | Single structured Bedrock call, **not** an agent loop | Deterministic, fast, ~10× cheaper per incident. |
| D5 | Agentic layer | Strands Agents SDK, only for Copilot + Prevention agent | Agentic where it earns its cost; scores AWS-implementation points. |
| D6 | Vision | Bedrock multimodal reads the photo directly | One call instead of Rekognition → labels → second LLM call. Rekognition stays optional. |
| D7 | Duplicate detection | Titan embeddings + cosine over a **candidate set** from DynamoDB | OpenSearch Serverless has a large monthly floor. Do not use it for a hackathon. |
| D8 | SLA timers | One EventBridge rule at `rate(1 minute)` → sweeper Lambda | ~43k invocations/month, inside free tier. Per-incident schedulers are fiddly and harder to demo. |
| D9 | Dashboard | Custom React dashboard over pre-aggregated DynamoDB counters | QuickSight is per-user per-month. Keep it as an optional slide. |
| D10 | Realtime | Polling every 3s **only while an incident is triaging** | WebSockets add cost, connection state, and a failure mode on demo day. |
| D11 | Networking | **No VPC for Lambdas. No NAT Gateway.** | A NAT Gateway is the single most common way hackathon teams burn $30+ for nothing. |
| D12 | Language | TypeScript backend + frontend; Python only for the two Strands agent Lambdas | One language for 90% of the code, Strands is Python-first. |

**Fallback on D5:** if Strands integration eats more than 3 hours, replace the agents with a plain two-step Bedrock call behind the same API contract. The API shape must not change, so the frontend never notices.

---

## 2. Target architecture (logical)

```
                        ┌──────────────────────────────┐
  Worker (PWA, mobile)  │  React + Vite  ·  S3+CloudFront
  Manager (dashboard)   │  offline queue · Cognito auth
                        └──────────────┬───────────────┘
                                       │ HTTPS
                            ┌──────────▼───────────┐
                            │ API Gateway HTTP API │
                            │  Cedar Lambda authz  │  ← tenant + role decision
                            └──────────┬───────────┘
                                       │
        ┌──────────────┬───────────────┼────────────────┬──────────────┐
        │              │               │                │              │
   ┌────▼────┐   ┌─────▼─────┐   ┌─────▼─────┐   ┌──────▼──────┐  ┌────▼─────┐
   │ Intake  │   │ Incident  │   │ Dashboard │   │  Copilot    │  │ Presign  │
   │ Lambda  │   │ CRUD      │   │ Summary   │   │ (Strands)   │  │  S3 URL  │
   └────┬────┘   └───────────┘   └───────────┘   └─────────────┘  └──────────┘
        │ writes NEW + emits event
   ┌────▼──────────────────────────────────────────────┐
   │ EventBridge (custom bus: opslens-events)          │
   └────┬───────────────────────┬──────────────────────┘
        │ INCIDENT_CREATED      │ INCIDENT_ROUTED / SLA_BREACHED
   ┌────▼─────────────┐    ┌────▼──────────┐     ┌───────────────────┐
   │ Triage pipeline  │    │ Notifier      │     │ SLA Sweeper       │
   │ extract→classify │    │ SNS email/SMS │     │ rate(1 minute)    │
   │ →score→dedupe    │    └───────────────┘     │ queries GSI3      │
   │ →route           │                          └───────────────────┘
   └────┬─────────────┘
        │                    ┌──────────────────────────────┐
   ┌────▼──────────┐         │ Prevention Agent (Strands)   │
   │ Amazon Bedrock│         │ EventBridge cron, 1×/day     │
   │ LLM + Titan   │         │ clusters recurrence → recs   │
   │ embeddings    │         └──────────────────────────────┘
   └───────────────┘
        │
   ┌────▼──────────────────────────────────────────────────┐
   │ DynamoDB single table (on-demand)  ·  S3 media bucket │
   └────────────────────────────────────────────────────────┘
```

**Local ("Build It") mirror:** LocalStack for DynamoDB/S3/SNS/SQS/EventBridge, SAM CLI for Lambda invocation, and a **MockLLMProvider** returning deterministic fixtures. You should be able to run the entire product, including the demo script, with zero AWS calls.

---

## 3. Phases

Each phase lists its exit criteria. A phase is not "done" because code exists — it is done when the exit criterion is demonstrably true.

### Phase 0 — Foundations & unblocking (Day 0, ~3h)
Monorepo, shared contracts, seed data, and the two things that block everything else: Bedrock model access and region choice.

- Repo scaffold, pnpm workspaces, lint/format/test harness
- Shared `contracts` package: types, enums, API request/response shapes, error envelope
- Seed dataset: 3 tenants, ~12 assets, 6 teams, 4 SLA policies, 40 historical incidents (must include a deliberate Dock-4 conveyor recurrence cluster)
- **Request Bedrock model access in the target region — do this in hour one**
- AWS Budget alarm at $10 and $25; CloudWatch log retention default 7 days

**Exit:** `pnpm test` green on an empty-but-wired repo; Bedrock access approved; seed JSON committed.

### Phase 1 — Data & access spine (Day 1 morning)
- DynamoDB single-table design + repository layer (all access tenant-scoped by construction)
- Cognito user pool, groups: `worker`, `supervisor`, `maintenance`, `manager`, `admin`
- Cedar policy set + Lambda authorizer returning `{tenantId, userId, role}` context
- S3 media bucket + presigned upload endpoint

**Exit:** an authenticated request for tenant A **cannot** read tenant B's data, proven by an automated test, not by inspection.

### Phase 2 — Intake & AI triage (Day 1 afternoon → Day 2 morning)
- `POST /v1/incidents` writes `NEW` in <300ms and emits `INCIDENT_CREATED`
- LLM provider abstraction (`MockLLMProvider` | `BedrockLLMProvider`)
- Extraction + classification: category, severity, location, asset, impact signals, confidence
- Priority scoring engine (tenant-configurable weights)
- Duplicate/related detection via embeddings + cosine over candidates
- Voice (Transcribe) and image (Bedrock vision) input paths

**Exit:** submit the Dock 4 conveyor photo+text → within ~8s the incident shows category, severity, priority score **with a visible breakdown**, and two linked prior incidents.

### Phase 3 — Routing, SLA, escalation (Day 2 afternoon)
- Routing engine: category + asset + shift → team, with fallback and override
- SLA policy resolution → `dueAt`, written to the SLA GSI
- Sweeper Lambda: breach detection, escalation ladder (assignee → supervisor → manager)
- SNS notifications; in-app timeline events for every state change

**Exit:** an unacknowledged high-severity incident escalates on its own, the timeline shows who was notified and when, and the countdown is visible in the UI.

### Phase 4 — Operator & manager surfaces (Day 2 evening → Day 3 morning)
- PWA submission screen: text, photo, voice, offline queue with sync
- Incident queue (sorted by priority score), detail view, triage actions, merge duplicates
- Manager dashboard: open by severity, MTTA/MTTR, SLA breach rate, hotspot table, recurrence trends, downtime-avoided counter

**Exit:** the full worker→manager journey is clickable on a phone-sized viewport without a mouse.

### Phase 5 — Agentic layer (Day 3 afternoon)
- **Ops Copilot** (Strands): natural-language questions over incidents, tenant-scoped tools, cited answers
- **Prevention Agent** (Strands, scheduled): clusters recurrence, drafts preventive maintenance recommendations with reasoning and estimated downtime avoided

**Exit:** ask *"what's been failing most at Dock 4 this month?"* and get a grounded answer with incident IDs; the dashboard shows at least one auto-generated prevention recommendation.

### Phase 6 — Deploy & harden (Day 3 evening)
- SAM template, one-command deploy, staging + prod stacks
- CloudFront + custom domain (optional), CORS, CSP
- Structured logging, correlation IDs, X-Ray on triage path only
- Token budget guardrail per tenant per day; failure fallbacks (LLM down → rule-based classifier)

**Exit:** a public URL a judge can open on their own phone; a cold-start deploy from a clean AWS account documented and timed.

### Phase 7 — Demo hardening (Day 4)
- Demo Mode: one-click reset + seeded scenario, deterministic outputs
- Pre-warm script run 5 minutes before demo
- 5-minute demo script with timings, fallback recording, architecture diagram, README
- Metrics slide: triage time reduction, duplicate reduction, MTTA/MTTR, downtime avoided

**Exit:** two full rehearsals completed end-to-end without intervention.

---

## 4. Dependency graph

**Critical path** (delay here delays everything downstream):

```
Bedrock model access ──┐
                       ├──► LLM provider abstraction ──► Triage pipeline ──► Priority score ──┐
Shared contracts ──────┤                                        │                             │
                       │                                        └──► Duplicate detection ─────┤
DynamoDB schema ───────┴──► Repository layer ──► Intake API ────────────────────────────────┬─┤
                                    │                                                       │ │
                                    └──► Cedar authorizer ──► every protected endpoint      │ │
                                                                                            │ │
                                          Routing engine ◄───────────────────────────────────┘ │
                                                │                                              │
                                          SLA engine ──► Sweeper ──► Escalation ──► Notifier    │
                                                                                                │
                              Metrics rollup ◄────────────────────────────────────────────────┘
                                    │
                              Dashboard ──► Prevention Agent ──► Demo script
```

**Hard dependencies** (cannot start until upstream is done)

| Downstream | Blocked by | Note |
|---|---|---|
| Any Bedrock call | Model access approval in region | Approval is not instant. Day 0, hour 1. |
| Repository layer | Frozen key schema | Changing GSI design later means re-seeding and rewriting queries. |
| Every protected endpoint | Cedar authorizer + auth context shape | Freeze the `AuthContext` type early; endpoints can then be built in parallel. |
| Duplicate detection | Embeddings written at intake | Backfill the seed data or dedupe silently returns nothing on demo day. |
| SLA sweeper | `dueAt` written to GSI3 at routing time | Sweeper querying a GSI nobody populates is a classic silent failure. |
| Dashboard numbers | Metrics rollup on state transitions | Do not compute the dashboard by scanning the table. |
| Prevention Agent | ≥3 incidents on one asset in the seed data | The agent has nothing to find otherwise. |
| Demo script | Demo Mode reset | Without reset you get one clean run, then drift. |

**Soft dependencies** (parallelisable with a mock)

- Frontend can be built entirely against the contracts package + MSW mocks before any Lambda is deployed.
- Copilot agent can be built against seeded local DynamoDB before the triage pipeline is finished.
- Dashboard UI can be built against a hand-written summary fixture.

**Parallelisation plan** — if you have more than one coding agent running:

| Track | Owns | Never touches |
|---|---|---|
| A (backend core) | repository, intake, triage, routing, SLA | `apps/web/**` |
| B (frontend) | web app, PWA, dashboard UI | `services/**` |
| C (platform) | SAM template, auth, Cedar, observability, seed | business logic |

All three depend only on `packages/contracts`. **Only you change `packages/contracts`.** That is the single most important rule for running multiple agents without merge chaos.

---

## 5. Risk register

Likelihood/Impact on a 1–5 scale. Sorted by exposure.

| # | Risk | L | I | Trigger to watch for | Mitigation | Fallback if it fires |
|---|---|---|---|---|---|---|
| R1 | Bedrock model not enabled / not available in chosen region | 4 | 5 | `AccessDeniedException` or model not listed in console | Request access day 0 hour 1; verify actual model IDs in your region before writing any prompt code | Deploy in a region where it is available and accept latency; or use cross-region inference |
| R2 | Demo fails live (cold start, wifi, rate limit) | 4 | 5 | Any rehearsal that needs a retry | Pre-warm script; Demo Mode with deterministic seeds; rehearse twice | Pre-recorded 90s screen capture, cued and ready |
| R3 | Scope creep — trying to ship all 7 incident types + email ingestion + IoT | 5 | 4 | Any task not in the current phase getting started | Phases are ordered so you cut from the bottom; features graded Must/Should/Could | Ship Must + Should; put Could on a "roadmap" slide, which judges like anyway |
| R4 | LLM output is unparseable or inconsistent | 4 | 4 | Intermittent JSON parse failures in triage | Force structured output with a strict schema; validate with a runtime validator; one retry with a repair prompt | Rule-based keyword classifier fallback, flagged `confidence: low` |
| R5 | Credit burn from an always-on resource | 3 | 4 | Budget alert; any resource with hourly billing | No NAT, no EKS/Fargate, no OpenSearch Service, no provisioned concurrency, no QuickSight; on-demand DynamoDB; 7-day log retention | Tear down the stack between work sessions; `sam delete` is cheap to redo |
| R6 | Tenant data leak across tenants | 2 | 5 | Any query built without a tenant prefix | Repository layer takes `tenantId` as a required first argument; automated cross-tenant denial test in CI | Treat as a stop-the-line defect |
| R7 | Multiple coding agents overwrite each other | 4 | 3 | Merge conflicts in shared files | Track ownership table above; contracts frozen and owned by you; small, scoped prompts | Re-run the affected phase prompt against a clean branch |
| R8 | Duplicate detection returns nothing on demo | 3 | 4 | Dedupe panel empty during rehearsal | Seed the Dock-4 cluster deliberately; backfill embeddings in the seed script; tune threshold against seed data | Lower the similarity threshold; show "related incidents" instead of strict duplicates |
| R9 | SLA countdown looks wrong (timezone/clock skew) | 3 | 3 | Timer showing negative or off by hours | Store all timestamps as UTC ISO-8601; render in tenant timezone at the edge only | Show relative time ("12m left") which hides most timezone bugs |
| R10 | Strands agent loop burns tokens or hangs | 3 | 3 | Copilot response >15s or token spike | Hard cap on tool-call iterations; per-tenant daily token budget; timeout at 20s | Swap to the two-step Bedrock fallback behind the same endpoint |
| R11 | Image uploads fail (payload size) | 3 | 3 | 413 errors from API Gateway | Presigned S3 upload from the browser; never POST binaries through API Gateway | Client-side downscale to ≤1024px before upload |
| R12 | Transcribe/voice path incomplete at demo time | 3 | 2 | Phase 2 running late | Voice is Should, not Must; feature-flag it | Demo text + image only; mention voice on the roadmap slide |
| R13 | Judges can't tell what the AI actually did | 3 | 4 | Rehearsal feedback of "so it's a ticket tool?" | Always render the **score breakdown** and the **model's extracted fields**, not just the final label | Add an "AI reasoning" expandable panel to the incident detail view |

**Top three to act on today:** R1 (access request), R3 (freeze scope), R2 (build Demo Mode earlier than feels necessary).

---

## 6. Cost control playbook

Target: **under $15 of the $200 credits** for the entire hackathon, including rehearsals.

**Never provision (hourly billing, no scale-to-zero):**
- NAT Gateway — keep Lambdas out of VPCs entirely
- OpenSearch Service or OpenSearch Serverless
- ECS/EKS/Fargate services, EC2, Lightsail, RDS/Aurora provisioned
- QuickSight paid users, SageMaker real-time endpoints
- Provisioned concurrency, DynamoDB provisioned capacity, global tables

**Do use (scale-to-zero or generous free tier):**
- Lambda, API Gateway HTTP API, EventBridge, SNS, SQS
- DynamoDB on-demand (`PAY_PER_REQUEST`)
- S3 + CloudFront, or Amplify Hosting
- Cognito (large free MAU tier)
- Bedrock on-demand token pricing — no endpoint, no idle cost

**Development discipline (this is where the savings actually come from):**
1. `LLM_PROVIDER=mock` is the **default** in local and test. Real Bedrock calls require an explicit opt-in env var. Assume 90%+ of your dev loop needs zero AI calls.
2. Cache identical triage inputs by content hash during development so repeated test runs don't re-bill.
3. Use the **cheapest capable model tier** for classification; reserve the larger model for the Copilot and Prevention agent only. Verify current model IDs and pricing in the Bedrock console for your region — don't hardcode from memory.
4. Titan embeddings at **256 dimensions**, not 1024 — cheaper, smaller DynamoDB items, and accuracy is fine for this use case.
5. Cap `maxTokens` on every call. Triage output is a small JSON object; 800 tokens is plenty.
6. Set CloudWatch log retention to 7 days on **every** log group at creation. Default retention is "never expire" and quietly accrues storage.
7. Set an AWS Budget with alerts at $10 and $25 on day 0.
8. `sam delete` the staging stack when you're not actively using it.
9. Batch the Prevention Agent to once per day, not per incident.

**Rough per-incident AI cost at MVP settings:** one small multimodal classification call plus one embedding call. At hackathon volumes (a few hundred incidents across all rehearsals) this is cents, not dollars. The risk to your credits is never the AI — it's an idle container or NAT gateway you forgot about.

---

## 7. Recommended additional features

I've graded these. **Must** = in the core demo. **Should** = strong differentiator, build if Phase 1–4 land on time. **Could** = roadmap slide only.

| Feature | Grade | Why it's worth it |
|---|---|---|
| **Score breakdown panel** — show the 5 weighted factors that produced the priority | **Must** | This *is* your differentiator. If it isn't visible, you don't have one. |
| **Demo Mode** — one-click reset to a seeded, deterministic scenario | **Must** | Turns a fragile demo into a repeatable one. Zero AWS cost. Build it in Phase 2, not Phase 7. |
| **Confidence-gated clarification** — if extraction confidence is low, ask the reporter exactly one follow-up question instead of guessing | **Should** | Reads as AI maturity rather than AI bravado. Cheap to build, memorable in a demo. |
| **Multilingual voice intake** (Hindi/regional → Transcribe → Translate → triage) | **Should** | Directly on-theme for a Bharat-focused hackathon, and genuinely true to warehouse floors. |
| **Offline-first PWA with sync queue** | **Should** | Warehouses have dead zones. Costs nothing on AWS, shows real domain understanding. |
| **Downtime-avoided / ROI counter** on the dashboard | **Should** | Converts your work into a number a buyer cares about. Judges remember numbers. |
| **Prevention Agent recommendations** | **Should** | Completes the report→prevent loop that most submissions never close. |
| **Shift handover digest** — auto-summary of open/escalated items at shift change | **Could** | Nice ops-authentic touch; a scheduled Lambda + one LLM call. |
| **Email ingestion via SES inbound** → S3 → triage | **Could** | Proves "meets people where they are," but adds domain verification friction. |
| **Anonymous near-miss safety reporting toggle** | **Could** | Real safety-culture feature; low effort, good story. |
| **Immutable audit timeline per incident** | **Should** | Nearly free (you're writing events anyway) and it's what makes the system credible for compliance. |
| **Per-tenant token budget guardrail** | **Should** | Protects your credits *and* is a genuine SaaS-maturity talking point. |

One to explicitly **not** build: a chat interface as the primary submission path. It undercuts your own "this is more than a chatbot" positioning.

---

## 8. Four-day schedule

| Day | Morning | Afternoon | Evening | Gate |
|---|---|---|---|---|
| **0** (prep) | Bedrock access request, region choice, budget alarms | Repo scaffold, contracts, seed data | — | Seed + contracts committed |
| **1** | Data layer, Cognito, Cedar authorizer | Intake API, LLM abstraction, extraction/classification | Priority scoring | End-to-end: submit → scored incident |
| **2** | Duplicate detection, Demo Mode | Routing, SLA, sweeper, escalation | Frontend shell + submit screen | Escalation fires unattended |
| **3** | Queue + detail UI, dashboard | Strands Copilot + Prevention Agent | Deploy, CloudFront, observability | Public URL works on a phone |
| **4** | Demo script + rehearsal 1 | Fix whatever rehearsal 1 broke | Rehearsal 2, recording, README, diagram | Two clean runs |

**Hard stop rule:** at the start of Day 4, whatever isn't working gets feature-flagged off, not fixed. Day 4 is for the demo, not for code.

---

## 9. Definition of done (submission checklist)

- [ ] Public URL, loads in under 3s cold, works on a phone browser
- [ ] Judge can log in with a provided demo account and submit a real incident
- [ ] Triage completes visibly, with the score breakdown shown
- [ ] Duplicate/related incidents surface with similarity reasoning
- [ ] SLA countdown runs and escalates without human action
- [ ] Dashboard shows hotspots, MTTA/MTTR, SLA breach rate, downtime avoided
- [ ] At least one auto-generated prevention recommendation is visible
- [ ] Copilot answers a natural-language question with cited incident IDs
- [ ] Cross-tenant isolation test passes in CI
- [ ] Architecture diagram + README + 5-minute demo script in the repo
- [ ] Demo Mode reset works, twice in a row
- [ ] Fallback recording exists
- [ ] AWS spend under budget, verified in Cost Explorer
