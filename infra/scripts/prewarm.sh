#!/usr/bin/env bash
set -euo pipefail

STAGE="${1:-prod}"
REGION="${AWS_REGION:-us-east-1}"

echo "================================================================"
echo " Prewarming OpsLens Lambda Functions"
echo " Stage:  ${STAGE}"
echo " Region: ${REGION}"
echo "================================================================"

FUNCTIONS=(
  "AuthorizerFunction"
  "ApiIncidentsFunction"
  "ApiUploadsFunction"
  "WorkerTriageFunction"
  "WorkerSlaSweeperFunction"
  "WorkerNotifierFunction"
)

for FN in "${FUNCTIONS[@]}"; do
  PHYSICAL_ID=$(aws cloudformation describe-stack-resource \
    --stack-name "opslens-${STAGE}" \
    --logical-resource-id "${FN}" \
    --region "${REGION}" \
    --query "StackResourceDetail.PhysicalResourceId" \
    --output text 2>/dev/null || true)

  if [ -n "${PHYSICAL_ID}" ] && [ "${PHYSICAL_ID}" != "None" ]; then
    echo "Pinging ${FN} (${PHYSICAL_ID})..."
    aws lambda invoke \
      --function-name "${PHYSICAL_ID}" \
      --region "${REGION}" \
      --invocation-type Event \
      --payload '{"source":"opslens.prewarm"}' \
      /dev/null >/dev/null 2>&1 || true
  else
    echo "Resource ${FN} not found or stack not deployed."
  fi
done

echo "Prewarming completed."
