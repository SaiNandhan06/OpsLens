# OpsLens — Product Requirements Document
**v1.0 · MVP scope for Bharat Build AWS Hackathon**

---

## 1. Problem

Small and mid-sized warehouses have no affordable intelligent operations layer. Incidents arrive as WhatsApp messages, shouted handovers, phone calls, and half-filled spreadsheets. They are unstructured, duplicated across teams, routed to the wrong people, and missing the one thing that matters — **business impact**. Recurring failures are resolved individually and never recognised as a pattern.

The cost: avoidable downtime, delayed shipments, SLA penalties, and operations managers who find out about problems after they've already cost money.

## 2. Product statement

OpsLens is a multi-tenant SaaS platform that converts any incident report — typed, spoken, or photographed — into a structured, business-impact-prioritised, correctly routed, SLA-tracked work item, and surfaces recurring failure patterns before they become disruptions.

**Positioning:** not a ticketing tool with AI bolted on. The prioritisation itself is the product.

## 3. Users

| Persona | Role | Primary need | Success looks like |
|---|---|---|---|
| **Ravi** — floor worker | `worker` | Report a problem in under 20 seconds, on a phone, possibly with no signal, possibly not in English | Photo + two sentences → done. No form fields. |
| **Priya** — shift supervisor | `supervisor` | Know what to deal with *first*, not what arrived first | A queue ordered by real impact, with the reasoning visible |
| **Arjun** — maintenance tech | `maintenance` | Enough context to fix it on the first visit | Asset history, similar past incidents, recommended first action |
| **Meena** — operations manager | `manager` | Real-time operational risk, and what keeps breaking | Hotspots, SLA breach rate, trend lines, prevention recommendations |
| **Sam** — tenant admin | `admin` | Configure teams, assets, SLA policies, scoring weights | Self-serve setup, no engineer required |

## 4. In scope (MVP)

**Incident types:** conveyor breakdown, scanner failure, inventory mismatch, damaged package, loading-bay congestion, safety incident, cold-storage temperature alert.

**Capabilities:**
1. Multi-channel intake — text, photo, voice; offline capture with sync
2. AI extraction — category, severity, location, asset, impact signals, entities
3. Business-impact priority scoring with a visible breakdown
4. Duplicate and related-incident detection
5. Automatic team routing with manual override
6. SLA timers, breach detection, and an escalation ladder
7. Incident lifecycle with an immutable audit timeline
8. Operations dashboard with hotspots and trends
9. Ops Copilot — natural-language questions over incident data
10. Prevention Agent — recurring-pattern detection and preventive recommendations
11. Multi-tenancy with strict data isolation

## 5. Out of scope (state this explicitly on your roadmap slide)

Real IoT sensor ingestion · ERP/WMS integration · work-order execution and parts inventory · mobile native apps · trained ML models on historical data (MVP scoring is rule-based by design) · billing/subscriptions · SSO/SAML · multi-industry verticals.

---

## 6. Functional requirements

### FR-1 Incident submission
- **FR-1.1** A worker submits an incident with free text (required), up to 3 photos (optional), and one voice note (optional).
- **FR-1.2** Photos upload directly to S3 via a presigned URL. Binaries never pass through the API.
- **FR-1.3** The API returns `201` with an incident ID and `status: NEW` in under 500ms. Triage runs asynchronously.
- **FR-1.4** If the device is offline, the submission queues locally and syncs automatically when connectivity returns, with a visible pending state.
- **FR-1.5** Voice notes are transcribed; non-English transcripts are translated for triage while the original is retained and displayed.
- **FR-1.6** The reporter sees live triage progress (polling, 3s interval, stops when `status != NEW|TRIAGING`).

### FR-2 AI extraction and classification
- **FR-2.1** The triage pipeline extracts: `category`, `severity` (LOW/MEDIUM/HIGH/CRITICAL), `locationId`, `assetId`, `summary` (≤120 chars), `impactSignals`, `entities`, `recommendedFirstAction`, `confidence` (0–1).
- **FR-2.2** Output must conform to a strict schema. On validation failure, retry once with a repair prompt; on second failure, fall back to the rule-based classifier and set `confidence: 0.3` with `triageMode: FALLBACK`.
- **FR-2.3** Photos are analysed by the same multimodal call, not a separate vision service.
- **FR-2.4** If `confidence < 0.6`, the incident enters `NEEDS_INFO` and the reporter is asked **exactly one** targeted clarifying question. Answering it re-runs triage once.
- **FR-2.5** Every AI-derived field is stored alongside its source (`ai` | `rule` | `human`) so the UI can show provenance and humans can override.

### FR-3 Priority scoring
- **FR-3.1** Priority score = weighted sum of five normalised factors (0–100 each):

  | Factor | Default weight | Derived from |
  |---|---|---|
  | Business impact | 0.30 | affected orders/shipments, blocked throughput |
  | Safety risk | 0.25 | injury potential, hazard class |
  | SLA urgency | 0.20 | time remaining vs SLA window |
  | Recurrence | 0.15 | prior occurrences on same asset in 30 days |
  | Downtime | 0.10 | estimated minutes of process stoppage |

- **FR-3.2** Weights are stored per tenant and editable by `admin`. Changing them recalculates scores for open incidents only.
- **FR-3.3** The incident detail view must render the full breakdown: each factor's raw value, normalised value, weight, and contribution. **This is a hard requirement, not a nice-to-have.**
- **FR-3.4** SLA urgency is recomputed on every sweeper pass, so an ageing incident climbs the queue on its own. This is visibly demonstrable.
- **FR-3.5** A supervisor can override the final priority; the override is recorded in the timeline with the original score preserved.

### FR-4 Duplicate and related detection
- **FR-4.1** At intake, generate an embedding of `summary + description + assetId`.
- **FR-4.2** Retrieve candidates: same tenant, same asset **or** same location, created within 14 days, capped at 50, newest first.
- **FR-4.3** Cosine similarity ≥ `DUPLICATE_THRESHOLD` (default 0.93) **and** same asset **and** target still open → `DUPLICATE_CANDIDATE`. Similarity ≥ `RELATED_THRESHOLD` (default 0.86) → `RELATED`.
- **FR-4.4** Duplicates are **suggested, never auto-merged.** A supervisor confirms. Merging links the child to the parent, transfers attachments, and closes the child as `MERGED`.
- **FR-4.5** Related incidents appear in the detail view with similarity score and a one-line reason.

### FR-5 Routing
- **FR-5.1** Routing rules resolve in order: asset-specific rule → category+location rule → category default → tenant fallback team.
- **FR-5.2** Shift-awareness: if the resolved team has no one on the active shift, route to the fallback team and flag `routedOutOfShift`.
- **FR-5.3** Any user with `supervisor`+ can reassign. Reassignment is timeline-logged with reason.
- **FR-5.4** Every routing decision stores which rule matched, so the UI can explain it.

### FR-6 SLA and escalation
- **FR-6.1** SLA policies are defined per (tenant, category, severity) with `ackMinutes` and `resolveMinutes`.
- **FR-6.2** On routing, compute `ackDueAt` and `resolveDueAt` and index them for the sweeper.
- **FR-6.3** A sweeper runs every minute, finds incidents past due, and escalates.
- **FR-6.4** Escalation ladder: assignee → team supervisor → operations manager. Each rung fires once; re-escalation only on the next threshold.
- **FR-6.5** Escalations send SNS notifications and write a timeline event. The UI shows an escalation badge and countdown.
- **FR-6.6** Acknowledging stops the ack timer; resolving stops the resolve timer. Both are recorded with actor and timestamp.

### FR-7 Lifecycle and audit
- **FR-7.1** States: `NEW → TRIAGING → ROUTED → ACKNOWLEDGED → IN_PROGRESS → RESOLVED → CLOSED`. Side states: `NEEDS_INFO`, `MERGED`, `REOPENED`.
- **FR-7.2** Illegal transitions are rejected by the API with a `409`.
- **FR-7.3** Every transition, assignment, comment, escalation, AI decision, and override writes an append-only timeline event with actor, timestamp, and payload. Timeline events are never updated or deleted.

### FR-8 Dashboard
- **FR-8.1** Metrics: open incidents by severity, MTTA, MTTR, SLA breach rate, duplicate rate, incidents by category, top 5 asset/location hotspots, 14-day trend, estimated downtime avoided.
- **FR-8.2** Metrics are read from pre-aggregated daily counters. **Full-table scans are forbidden.**
- **FR-8.3** Filterable by date range (7/14/30 days), location, and category.
- **FR-8.4** Hotspot rows link through to the filtered incident list.

### FR-9 Ops Copilot
- **FR-9.1** `manager` and `supervisor` can ask natural-language questions scoped to their tenant.
- **FR-9.2** The agent has read-only, tenant-scoped tools: `searchIncidents`, `getAssetHistory`, `getMetrics`, `getSlaStatus`. It cannot write.
- **FR-9.3** Answers cite the incident IDs they rest on. Unsupported claims are not made; if the data doesn't answer the question, it says so.
- **FR-9.4** Hard limits: max 6 tool iterations, 20s timeout, per-tenant daily token budget. On limit, return a partial answer with an explanation rather than failing silently.

### FR-10 Prevention Agent
- **FR-10.1** Runs on a daily schedule per tenant.
- **FR-10.2** Identifies assets with ≥3 incidents of the same category in 30 days, or a rising trend.
- **FR-10.3** Produces a recommendation: asset, observed pattern, suggested preventive action, suggested timing, estimated downtime avoided, and supporting incident IDs.
- **FR-10.4** Recommendations appear on the dashboard and can be dismissed or converted into a scheduled maintenance incident.

### FR-11 Multi-tenancy and access control
- **FR-11.1** Every stored item is tenant-prefixed. Every query is tenant-scoped at the repository layer, enforced by the function signature, not by convention.
- **FR-11.2** A Cedar-based Lambda authorizer resolves `{tenantId, userId, role}` before any handler runs.
- **FR-11.3** Permissions:

  | Action | worker | maintenance | supervisor | manager | admin |
  |---|:--:|:--:|:--:|:--:|:--:|
  | Create incident | ✓ | ✓ | ✓ | ✓ | ✓ |
  | View own incidents | ✓ | ✓ | ✓ | ✓ | ✓ |
  | View all tenant incidents | | ✓ | ✓ | ✓ | ✓ |
  | Acknowledge / update status | | ✓ | ✓ | ✓ | ✓ |
  | Reassign / merge / override priority | | | ✓ | ✓ | ✓ |
  | View dashboard | | | ✓ | ✓ | ✓ |
  | Use Copilot | | | ✓ | ✓ | ✓ |
  | Configure teams / SLA / weights | | | | | ✓ |

- **FR-11.4** A cross-tenant access attempt returns `403` and logs a security event. An automated test proves this in CI.

### FR-12 Demo Mode
- **FR-12.1** `POST /v1/admin/demo/reset` (admin only, and only when `DEMO_MODE=true`) wipes tenant data and reloads the seed scenario.
- **FR-12.2** Seed includes a deliberate Dock 4 conveyor recurrence cluster and at least one already-breaching SLA.
- **FR-12.3** With `LLM_PROVIDER=mock`, triage outputs are deterministic for seeded inputs, so rehearsals are identical every time.

---

## 7. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-1 | Intake API response | p95 < 500ms |
| NFR-2 | Triage completion | p95 < 10s from submission |
| NFR-3 | Dashboard load | p95 < 1.5s |
| NFR-4 | Cold start | < 1.5s (no VPC, minimal bundle) |
| NFR-5 | Availability during demo | 100% — pre-warm required |
| NFR-6 | Idle infrastructure cost | ~$0/day |
| NFR-7 | Total hackathon AWS spend | < $15 |
| NFR-8 | Mobile support | Fully usable at 390px width |
| NFR-9 | Media at rest | S3 SSE, presigned URLs expire in 15 min |
| NFR-10 | Observability | Correlation ID on every log line; structured JSON logs |
| NFR-11 | Log retention | 7 days on every log group |

---

## 8. Data model (DynamoDB single table `opslens`)

Table: `PK` (partition), `SK` (sort). On-demand billing. TTL attribute `ttl` on ephemeral items only.

| Entity | PK | SK | Key attributes |
|---|---|---|---|
| Tenant | `TENANT#<t>` | `META` | name, timezone, scoringWeights, thresholds |
| User | `TENANT#<t>` | `USER#<userId>` | email, name, role, teamId, shift |
| Team | `TENANT#<t>` | `TEAM#<teamId>` | name, members, supervisorId, shiftPattern |
| Asset | `TENANT#<t>` | `ASSET#<assetId>` | name, type, locationId, criticality |
| Location | `TENANT#<t>` | `LOC#<locId>` | name, zone |
| SLA policy | `TENANT#<t>` | `SLA#<category>#<severity>` | ackMinutes, resolveMinutes |
| Routing rule | `TENANT#<t>` | `ROUTE#<priority>#<ruleId>` | matcher, targetTeamId |
| Incident | `TENANT#<t>` | `INCIDENT#<ulid>` | status, category, severity, priorityScore, scoreBreakdown, assetId, locationId, assignedTeamId, ackDueAt, resolveDueAt, embedding, confidence, triageMode |
| Timeline event | `TENANT#<t>` | `INCIDENT#<ulid>#EVT#<ts>#<seq>` | type, actor, payload — append-only |
| Attachment | `TENANT#<t>` | `INCIDENT#<ulid>#ATT#<id>` | s3Key, kind, transcript |
| Duplicate link | `TENANT#<t>` | `INCIDENT#<parent>#LINK#<child>` | similarity, linkType, confirmedBy |
| Daily metrics | `TENANT#<t>` | `METRICS#<yyyy-mm-dd>` | counters (atomic ADD) |
| Recommendation | `TENANT#<t>` | `REC#<yyyy-mm-dd>#<assetId>` | pattern, action, estimatedDowntimeAvoided, evidenceIds, status |
| Token budget | `TENANT#<t>` | `BUDGET#<yyyy-mm-dd>` | tokensUsed, callCount |

**Global secondary indexes**

| Index | GSI PK | GSI SK | Serves |
|---|---|---|---|
| GSI1 — work queue | `TENANT#<t>#STATUS#<status>` | `PRIO#<score padded 3>#<createdAt>` | queue sorted by priority |
| GSI2 — asset history | `TENANT#<t>#ASSET#<assetId>` | `TS#<createdAt>` | recurrence, dedupe candidates, asset timeline |
| GSI3 — SLA watch | `TENANT#<t>#SLA#ACTIVE` | `DUE#<earliestDueAt>` | sweeper query — **must be sparse**: attributes removed on resolve |
| GSI4 — my incidents | `TENANT#<t>#USER#<reporterId>` | `TS#<createdAt>` | worker's own submissions |

**Design notes for implementers**
- Incident IDs are ULIDs — sortable by creation time, no coordination needed.
- All timestamps are UTC ISO-8601 strings. Rendering to local time happens only in the browser.
- Embeddings are stored at **256 dimensions** to keep items small.
- GSI3 must be sparse. Delete `slaActive`/`earliestDueAt` on resolution or the sweeper scans closed incidents forever.
- Daily metrics use atomic `ADD` on writes, never read-modify-write.

---

## 9. API contract (v1)

Base: `/v1`. Auth: `Authorization: Bearer <Cognito JWT>` on everything except `/health`.

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/health` | public | liveness |
| POST | `/uploads/presign` | worker+ | presigned S3 PUT for a photo/audio file |
| POST | `/incidents` | worker+ | create incident, returns `NEW` |
| GET | `/incidents` | worker+ | list; filters: `status`, `severity`, `category`, `assetId`, `locationId`, `assignedTeamId`, `minPriority`, `cursor`, `limit` |
| GET | `/incidents/{id}` | worker+ | detail incl. score breakdown, timeline, related, attachments |
| PATCH | `/incidents/{id}` | maintenance+ | status transition, assignment, severity/priority override |
| POST | `/incidents/{id}/comments` | worker+ | add comment |
| POST | `/incidents/{id}/answer` | worker+ | answer the clarifying question, re-runs triage |
| POST | `/incidents/{id}/merge` | supervisor+ | merge child into parent |
| GET | `/incidents/{id}/related` | worker+ | duplicate/related candidates |
| GET | `/assets`, `/teams`, `/locations` | worker+ | reference data |
| GET/PUT | `/config/scoring` | admin | scoring weights |
| GET/PUT | `/config/sla` | admin | SLA policies |
| GET | `/dashboard/summary` | supervisor+ | aggregated metrics |
| GET | `/dashboard/hotspots` | supervisor+ | top assets/locations |
| GET | `/recommendations` | supervisor+ | prevention recommendations |
| PATCH | `/recommendations/{id}` | supervisor+ | accept/dismiss |
| POST | `/copilot/query` | supervisor+ | natural-language query |
| POST | `/admin/demo/reset` | admin | reset + reseed (demo mode only) |

**Error envelope** — uniform across every endpoint:
```
{ "error": { "code": "INCIDENT_INVALID_TRANSITION",
             "message": "human readable",
             "details": { },
             "correlationId": "uuid" } }
```

**Status codes:** 200/201 success · 400 validation · 401 unauthenticated · 403 unauthorised or cross-tenant · 404 not found · 409 illegal state transition · 429 budget/rate limit · 500 unexpected.

---

## 10. Acceptance criteria — the "golden path"

This is the exact scenario that must work. Write it as an end-to-end test **and** rehearse it as the demo.

1. Ravi (`worker`, tenant `north-hub`) opens the PWA on a phone and submits: a photo of a stopped conveyor plus *"Dock 4 conveyor stopped again. Packages piling up. Third time this week."*
2. The API returns `201` in under 500ms with `status: NEW`. The UI shows "Analysing…".
3. Within 10 seconds the incident shows: category `EQUIPMENT_FAILURE`, severity `HIGH`, location `Dock 4`, asset `CONV-D4`, and a summary of the stoppage.
4. The priority score is ≥ 78, and the breakdown panel shows all five factors with their contributions — recurrence visibly elevated.
5. Two prior Dock 4 conveyor incidents appear under "Related", with similarity scores.
6. The incident routes automatically to the Maintenance team; the matched routing rule is displayed.
7. An SLA countdown starts (ack 20 min) and is visible on the card.
8. With the clock advanced past the ack window, the sweeper escalates to the shift manager. The timeline records the escalation and an SNS notification is sent.
9. Meena (`manager`) opens the dashboard: Dock 4 is the top hotspot, SLA breach rate and MTTA are shown, and the 14-day trend shows conveyor incidents rising.
10. A prevention recommendation is visible: inspect the CONV-D4 motor and belt assembly, with the three supporting incident IDs and an estimated downtime avoided.
11. Meena asks the Copilot *"what keeps failing at Dock 4?"* and receives a grounded answer citing those incident IDs.
12. A user from tenant `south-hub` requests that incident ID directly and receives `403`.

If steps 1–12 pass, you have a submission.

---

## 11. Success metrics (the slide judges will remember)

| Metric | Baseline (manual) | OpsLens target | How you show it |
|---|---|---|---|
| Time to triage an incident | 8–15 min | < 10 sec | live, on stage |
| Duplicate tickets | ~20% of volume | < 5% | dashboard duplicate rate |
| Mean time to acknowledge | 25+ min | < 8 min | dashboard MTTA |
| Mean time to resolve | varies | ~30% reduction | dashboard MTTR |
| Recurring issues identified | ad hoc / never | automatic, daily | recommendations panel |
| SLA breaches prevented | unknown | counted | escalations-before-breach counter |
| Estimated downtime avoided | unmeasured | quantified in minutes | ROI counter |

State clearly that baselines are illustrative for the MVP. Judges respect honest framing far more than invented precision — and it opens the door to "here's how we'd validate this in a pilot," which is a strong closing line.
