import { evaluateCedar } from '../services/authorizer/src/index.js';

async function main() {
  console.log('[Check 3] Verifying cross-tenant denial from explicit forbid policy...\n');

  // Test with 'admin' role (which has full permit to all actions and resources)
  const req = {
    principal: {
      id: 'usr-admin-north',
      tenantId: 'north-hub',
      role: 'admin' as const,
    },
    action: 'createIncident',
    resource: {
      type: 'Incident',
      id: 'inc-south-1',
      tenantId: 'south-hub',
    },
  };

  const result = evaluateCedar(req);

  console.log(`Principal: ${req.principal.id} (tenant=${req.principal.tenantId}, role=${req.principal.role})`);
  console.log(`Resource: ${req.resource.id} (type=${req.resource.type}, tenant=${req.resource.tenantId})`);
  console.log(`Action: ${req.action}`);
  console.log(`\nDecision: ${result.decision.toUpperCase()}`);
  console.log(`IsAuthorized: ${result.isAuthorized}`);
  console.log(`Diagnostics Reasons: ${JSON.stringify(result.reasons)}`);
  console.log(`Forbid Policy Triggered: ${result.forbidPolicyTriggered}`);

  const hasForbidReason = result.reasons.includes('policy_forbid_cross_tenant');
  console.log(`\nDid denial come from forbid policy 'policy_forbid_cross_tenant'? ${hasForbidReason ? 'YES (PASS)' : 'NO (FAIL)'}`);

  if (result.decision !== 'deny' || !hasForbidReason) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
