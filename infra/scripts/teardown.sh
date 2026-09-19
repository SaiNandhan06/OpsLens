#!/usr/bin/env bash
set -euo pipefail

STAGE="${1:-staging}"
REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="opslens-${STAGE}"

echo "================================================================"
echo " Tearing down OpsLens"
echo " Stage:  ${STAGE}"
echo " Region: ${REGION}"
echo " Stack:  ${STACK_NAME}"
echo "================================================================"

sam delete \
  --stack-name "${STACK_NAME}" \
  --region "${REGION}" \
  --no-prompts

echo "OpsLens stack '${STACK_NAME}' deleted successfully."
