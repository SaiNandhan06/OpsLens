#!/usr/bin/env bash
set -euo pipefail

STAGE="${1:-staging}"
REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="opslens-${STAGE}"
TABLE_NAME="opslens-${STAGE}"
MEDIA_BUCKET="opslens-media-${STAGE}"
EVENT_BUS_NAME="opslens-events-${STAGE}"
LLM_PROVIDER="${LLM_PROVIDER:-bedrock}"

echo "================================================================"
echo " Deploying OpsLens"
echo " Stage:        ${STAGE}"
echo " Region:       ${REGION}"
echo " Stack:        ${STACK_NAME}"
echo " LLM Provider: ${LLM_PROVIDER}"
echo "================================================================"

# 1. Build monorepo packages and Lambda handlers
echo "[1/3] Building TypeScript projects..."
pnpm build

# 2. SAM Build
echo "[2/3] Building SAM artifacts..."
sam build --template-file template.yaml

# 3. SAM Deploy
echo "[3/3] Deploying CloudFormation stack..."
sam deploy \
  --stack-name "${STACK_NAME}" \
  --region "${REGION}" \
  --parameter-overrides \
    Stage="${STAGE}" \
    TableName="${TABLE_NAME}" \
    MediaBucket="${MEDIA_BUCKET}" \
    EventBusName="${EVENT_BUS_NAME}" \
    LlmProvider="${LLM_PROVIDER}" \
  --resolve-s3 \
  --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND \
  --no-confirm-changeset

echo "OpsLens deployment for stage '${STAGE}' completed successfully."
