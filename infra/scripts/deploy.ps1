param(
    [string]$Stage = "staging",
    [string]$Region = "us-east-1",
    [string]$LlmProvider = "bedrock"
)

$ErrorActionPreference = "Stop"

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host " Deploying OpsLens" -ForegroundColor Cyan
Write-Host " Stage:        $Stage" -ForegroundColor Cyan
Write-Host " Region:       $Region" -ForegroundColor Cyan
Write-Host " Stack:        opslens-$Stage" -ForegroundColor Cyan
Write-Host " LLM Provider: $LlmProvider" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

# 1. Build monorepo packages and Lambda handlers
Write-Host "[1/3] Building TypeScript projects..." -ForegroundColor Yellow
pnpm build

# 2. SAM Build
Write-Host "[2/3] Building SAM artifacts..." -ForegroundColor Yellow
sam build --template-file template.yaml

# 3. SAM Deploy
Write-Host "[3/3] Deploying CloudFormation stack..." -ForegroundColor Yellow
sam deploy `
  --stack-name "opslens-$Stage" `
  --region "$Region" `
  --parameter-overrides `
    Stage="$Stage" `
    TableName="opslens-$Stage" `
    MediaBucket="opslens-media-$Stage" `
    EventBusName="opslens-events-$Stage" `
    LlmProvider="$LlmProvider" `
  --resolve-s3 `
  --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND `
  --no-confirm-changeset

Write-Host "OpsLens deployment for stage '$Stage' completed successfully." -ForegroundColor Green
