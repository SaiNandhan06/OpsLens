param(
    [string]$Stage = "staging",
    [string]$Region = "us-east-1"
)

$ErrorActionPreference = "Stop"

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host " Tearing down OpsLens" -ForegroundColor Cyan
Write-Host " Stage:  $Stage" -ForegroundColor Cyan
Write-Host " Region: $Region" -ForegroundColor Cyan
Write-Host " Stack:  opslens-$Stage" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

sam delete `
  --stack-name "opslens-$Stage" `
  --region "$Region" `
  --no-prompts

Write-Host "OpsLens stack 'opslens-$Stage' deleted successfully." -ForegroundColor Green
