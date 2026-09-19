# OpsLens

> **Enterprise AI-Powered Warehouse Incident Triage, Routing, and SLA Escalation Platform**  
> Built as a multi-tenant, serverless cloud application on AWS using TypeScript and DynamoDB single-table design.

---

## 📌 Overview

**OpsLens** automates the end-to-end lifecycle of warehouse incident reports. It ingests unstructured inputs (text descriptions, camera photos, voice notes in any language), transcribes and translates audio, extracts structured telemetry, scores operational priority, identifies duplicate and recurring failures, routes work to on-duty teams based on active shifts, tracks SLAs via an EventBridge sweeper on sparse indexes, and executes tiered escalations with multi-channel notifications.

### Key Capabilities

- 📥 **Multi-Modal Intake**: Direct presigned S3 uploads for photos (JPEG, PNG, WebP) and audio voice memos (WebM, MP4, MP3) with automated attachment promotion from staging to incident prefixes.
- 🎙️ **Voice Processing**: Automated speech transcription (AWS Transcribe) with automatic source language detection (e.g. Hindi, Spanish) and translation while preserving original audio and transcripts.
- 🧠 **AI Triage & Categorization**: Extracts incident category, severity, equipment/asset IDs, and recommended actions using Claude 3 Haiku / Bedrock Titan with automated fallback to deterministic rule-based triage on schema or budget failure.
- 📊 **Deterministic Priority Scoring**: 5-factor scoring formula (Business Impact, Safety Risk, SLA Urgency, Recurrence, Downtime) normalized to 0–100 with tenant-customizable weights.
- 🔍 **Duplicate & Related Detection**: Computes 256-dimensional embeddings and performs cosine similarity matching over 14-day candidate windows via GSI2 with supervisor merge workflows.
- 🧭 **Shift-Aware Routing**: Evaluates routing rules in strict priority (Asset Rule $\rightarrow$ Category+Location Rule $\rightarrow$ Category Default $\rightarrow$ Fallback Team) with facility timezone shift schedule awareness.
- ⏱️ **Sparse-Index SLA Tracking & Escalation**: Single EventBridge scheduled sweeper (`rate(1 minute)`) queries sparse `GSI3` partition indexes (`earliestDueAt <= now`, limit 100) without full table scans, executing ladder escalations (Assignee $\rightarrow$ Supervisor $\rightarrow$ Operations Manager).
- 📢 **Multi-Channel Notifications**: EventBridge consumer dispatches alerts via Amazon SNS with deep links to the internal incident console and logs timeline entries.

---

## 🏗️ Architecture

```
                                      +------------------------------------+
                                      |          Amazon EventBridge        |
                                      |         (opslens-events-*)         |
                                      +---+---------------+------------+---+
                                          |               |            |
                    INCIDENT_CREATED      |               |            |  INCIDENT_ROUTED / SLA_BREACHED /
                   +----------------------+               |            |  INCIDENT_ESCALATED
                   |                                      |            v
                   v                                      |    +-----------------------+
        +-----------------------+                         |    | services/             |
        | services/             |                         |    | worker-notifier       |
        | worker-triage         |                         |    +-----------+-----------+
        +-----------+-----------+                         |                |
                    |                                     |                v
                    | Extract -> Classify                 |        +---------------+
                    | -> Score -> Dedupe -> Route         |        | Amazon SNS    |
                    v                                     |        +---------------+
        +-----------------------+                         |
        | DynamoDB Single Table |                         | (Scheduled rate(1 min))
        | (opslens-*)           |<------------------------+----------------+
        +-----------^-----------+                                          |
                    |                                                      v
                    |                                          +-----------------------+
            API     |                                          | services/             |
        +-----------+-----------+                              | worker-sla-sweeper    |
        | services/             |                              +-----------------------+
        | api-incidents         |                              (Queries Sparse GSI3)
        | api-uploads           |
        | authorizer (Cedar)    |
        +-----------^-----------+
                    |
              REST API / HTTPS
                    |
              [Web / Mobile UI]
```

---

## 📋 Prerequisites

Ensure the following tools are installed on your workstation:

1. **Node.js**: `v20.x` or higher (LTS recommended)
2. **pnpm**: `v9.x` or higher (`corepack enable` or `npm install -g pnpm`)
3. **Docker & Docker Compose**: For running LocalStack locally
4. **AWS SAM CLI**: For local API simulation and AWS deployments (`sam --version`)
5. **AWS CLI v2**: For cloud management (`aws --version`)

---

## 🚀 Local Development Setup

### 1. Clone the Repository

```bash
git clone https://github.com/SaiNandhan06/OpsLens.git
cd OpsLens
```

### 2. Install Dependencies

Install all dependencies across monorepo packages:

```bash
pnpm install
```

### 3. Setup Environment Variables

Copy the default environment configuration:

```bash
cp .env.example .env
```

The default values in `.env.example` point to LocalStack (`http://localhost:4566`) with `LLM_PROVIDER=mock` so you can run the entire platform without incurring any AWS charges.

### 4. Start LocalStack

Spin up the local AWS emulation container:

```bash
docker compose -f docker-compose.localstack.yml up -d
```

Confirm that LocalStack is healthy:

```bash
docker compose -f docker-compose.localstack.yml ps
```

### 5. Bootstrap AWS Resources

Creates the DynamoDB single table (`opslens-local`), S3 media bucket (`opslens-media-local`), EventBridge bus (`opslens-events-local`), and SNS notification topic (`opslens-notifications-local`):

```bash
pnpm run bootstrap:local
```

### 6. Seed Reference & Historical Data

Seeds tenant metadata, locations, assets, team routing profiles, SLA policies, and 40 seeded incidents with precomputed 256-dimensional embeddings:

```bash
pnpm run seed:local
```

### 7. Compile All Packages

Compile all TypeScript packages and service Lambda functions:

```bash
pnpm run build
```

---

## 🧪 Running Tests & Verification

### Unit Test Suite

Run unit tests across all 16 workspace packages:

```bash
pnpm test
```

### End-to-End Verification Suites

OpsLens includes dedicated verification suites testing live scenarios against LocalStack:

| Script | Purpose / Scope | Command |
|:---|:---|:---|
| **Intake API** | P95 latency (<500ms), attachment promotion from staging, 201 ULID generation, tenant isolation | `npx tsx scripts/verify-intake.ts` |
| **AI Triage** | Golden-path triage, rule-based fallback, vague report clarification, Hindi voice notes | `npx tsx scripts/verify-triage.ts` |
| **Scoring** | 5-factor scoring engine, formula validation, SLA urgency climb, weight modification | `npx tsx scripts/verify-scoring.ts` |
| **Duplicate Detection** | GSI2 14-day candidate search, cosine similarity ranking, supervisor merge workflows | `npx tsx scripts/verify-duplicate.ts` |
| **Routing & Lifecycle** | Rule precedence, shift-awareness, 10x10 state transition matrix enforcement | `npx tsx scripts/verify-routing.ts` |
| **SLA & Escalations** | Sparse GSI3 sweeper, idempotency, rung-by-rung escalation ladder, SNS alerts, MTTA/MTTR | `npx tsx scripts/verify-sla.ts` |
| **AI Provider** | Bedrock Titan embeddings, Claude 3 Haiku schema validation, token budget guardrails | `npx tsx scripts/verify-ai.ts` |

Run any verification script:

```bash
npx tsx scripts/verify-sla.ts
```

---

## 💻 Running the Local API & UI

### Run the Serverless API locally

Simulate API Gateway + Lambda using AWS SAM:

```bash
pnpm run dev:api
```

The API will be available at `http://127.0.0.1:3000`.

### Run the Web Dashboard

Start the frontend development server:

```bash
pnpm run dev:web
```

---

## ☁️ Deployment to AWS (Staging / Production)

OpsLens is packaged and deployed using **AWS SAM** (`template.yaml`).

### Deploying via Script

#### Linux / macOS:
```bash
# Deploy to staging
./infra/scripts/deploy.sh staging

# Deploy to production
./infra/scripts/deploy.sh prod
```

#### Windows (PowerShell):
```powershell
# Deploy to staging
.\infra\scripts\deploy.ps1 -Stage staging

# Deploy to production
.\infra\scripts\deploy.ps1 -Stage prod
```

### Manual SAM Deployment

```bash
# 1. Build all packages
pnpm run build

# 2. Build SAM template
sam build --template-file template.yaml

# 3. Deploy CloudFormation stack
sam deploy \
  --stack-name opslens-staging \
  --parameter-overrides \
    Stage=staging \
    TableName=opslens-staging \
    MediaBucket=opslens-media-staging \
    EventBusName=opslens-events-staging \
    LlmProvider=bedrock \
  --resolve-s3 \
  --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND
```

### Teardown / Deletion

#### Linux / macOS:
```bash
./infra/scripts/teardown.sh staging
```

#### Windows (PowerShell):
```powershell
.\infra\scripts\teardown.ps1 -Stage staging
```

---

## 🗄️ DynamoDB Single-Table Design

OpsLens uses a single DynamoDB table (`opslens-<stage>`) partitioned by tenant with composite sort keys and four Global Secondary Indexes (GSIs):

| Key / Index | Partition Key (PK) | Sort Key (SK) | Purpose |
|:---|:---|:---|:---|
| **Primary Key** | `TENANT#<tenantId>` | `INCIDENT#<id>`, `USER#<id>`, `ASSET#<id>`, `TEAM#<id>`, etc. | Base item storage and direct key lookups |
| **GSI1** | `TENANT#<tenantId>#STATUS#<status>` | `PRIORITY#<paddedScore>#<createdAt>` | Incident queue ordered by priority (descending) |
| **GSI2** | `TENANT#<tenantId>#ASSET#<assetId>` | `CREATED#<createdAt>` | Asset incident history, duplicate detection, and recurrence |
| **GSI3** | `TENANT#<tenantId>#SLA#ACTIVE` | `DUE#<earliestDueAt>` | **Sparse index** for the 1-minute SLA sweeper (only active SLA incidents) |
| **GSI4** | `TENANT#<tenantId>#REPORTER#<userId>` | `CREATED#<createdAt>` | "My Incidents" worker query partition |

---

## 🌐 API Reference

All requests require authorization headers (`Authorization: Bearer <token>` or authorizer claims with `tenantId` and `role`).

| Method | Path | Description | Roles |
|:---|:---|:---|:---|
| `POST` | `/v1/uploads/presign` | Request presigned S3 PUT URL for photo/audio staging | Worker+ |
| `POST` | `/v1/incidents` | Submit a new incident report | Worker+ |
| `GET` | `/v1/incidents` | Query incident queue (filter by status, cursor pagination) | Worker+ |
| `GET` | `/v1/incidents/{id}` | Fetch full incident details with timeline and score breakdown | Worker+ |
| `PATCH` | `/v1/incidents/{id}` | State machine transition or team reassignment | Worker+ / Supervisor |
| `POST` | `/v1/incidents/{id}/answer` | Submit clarifying answer to restart triage pipeline | Worker+ |
| `GET` | `/v1/incidents/{id}/related` | Fetch duplicate and related incident candidates | Worker+ |
| `POST` | `/v1/incidents/{id}/merge` | Merge duplicate child incident into parent | Supervisor+ |

---

## 📁 Repository Structure

```
OpsLens/
├── apps/
│   └── web/                   # Frontend SPA console (Vite + React / TypeScript)
├── packages/
│   ├── ai/                    # LLM Provider abstraction, Bedrock, Mock, Prompts
│   ├── contracts/             # Shared Zod schemas, TypeScript types, DTOs
│   ├── core/                  # Pure domain logic (scoring, dedupe, routing, SLA, lifecycle)
│   ├── data/                  # DynamoDB repositories, S3 client, keys
│   └── platform/              # Logger, API handler wrapper, error definitions, auth
├── services/
│   ├── authorizer/            # Lambda Request Authorizer (Cedar ABAC policies)
│   ├── api-uploads/           # S3 presigned upload generator
│   ├── api-incidents/         # Incidents REST API (CRUD, merge, reassignment)
│   ├── worker-triage/         # EventBridge consumer: extract -> classify -> score -> dedupe -> route
│   ├── worker-sla-sweeper/    # EventBridge rate(1 min) sweeper on sparse GSI3
│   └── worker-notifier/       # Notification dispatcher (SNS, timeline events)
├── infra/
│   ├── cedar/                 # Cedar policy definitions & authorization schema
│   └── scripts/               # Bootstrap, deploy, teardown, and prewarm scripts
├── scripts/                   # Verification and test suites for all platform modules
├── seed/                      # Seed fixtures (tenants, assets, locations, incidents)
├── template.yaml              # AWS SAM CloudFormation infrastructure template
├── samconfig.toml             # SAM configuration defaults
└── docker-compose.localstack.yml # LocalStack infrastructure definition
```

---

## 📄 License

This project is licensed under the MIT License.