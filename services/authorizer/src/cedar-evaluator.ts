import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cedar from '@cedar-policy/cedar-wasm/nodejs';
import { Role } from '@opslens/contracts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Locate infra/cedar relative to project root
function findCedarDir(): string {
  let curr = __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(curr, 'infra/cedar');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    curr = path.dirname(curr);
  }
  return path.resolve(process.cwd(), 'infra/cedar');
}

const cedarDir = findCedarDir();
const policiesPath = path.join(cedarDir, 'policies.cedar');
const schemaPath = path.join(cedarDir, 'schema.cedarschema');

export const cedarPolicies = fs.existsSync(policiesPath) ? fs.readFileSync(policiesPath, 'utf-8') : '';
export const cedarSchema = fs.existsSync(schemaPath) ? fs.readFileSync(schemaPath, 'utf-8') : '';

// Build policy map preserving @id annotations as policy IDs
export const staticPoliciesMap: Record<string, string> = {};
if (cedarPolicies) {
  const parts = cedar.policySetTextToParts(cedarPolicies);
  if (parts.type === 'success') {
    parts.policies.forEach((p, idx) => {
      const match = p.match(/@id\("([^"]+)"\)/);
      const policyId = match ? match[1]! : `policy${idx}`;
      staticPoliciesMap[policyId] = p;
    });
  }
}

export interface CedarAuthRequest {
  principal: {
    id: string;
    tenantId: string;
    role: Role;
  };
  action: string;
  resource: {
    type: string;
    id: string;
    tenantId: string;
  };
  context?: Record<string, unknown>;
}

export interface CedarAuthResponse {
  isAuthorized: boolean;
  decision: 'allow' | 'deny';
  reasons: string[];
  errors: unknown[];
  forbidPolicyTriggered: boolean;
}

/**
 * Evaluates an authorization request against the OpsLens Cedar policy set.
 */
export function evaluateCedar(req: CedarAuthRequest): CedarAuthResponse {
  const principalType = 'OpsLens::User';
  const actionType = 'OpsLens::Action';
  const resourceType = `OpsLens::${req.resource.type}`;

  const authorizationCall = {
    principal: { type: principalType, id: req.principal.id },
    action: { type: actionType, id: req.action },
    resource: { type: resourceType, id: req.resource.id },
    context: req.context || {},
    policies: {
      staticPolicies: Object.keys(staticPoliciesMap).length > 0 ? staticPoliciesMap : cedarPolicies,
    },
    entities: [
      {
        uid: { type: principalType, id: req.principal.id },
        attrs: {
          tenantId: req.principal.tenantId,
          role: req.principal.role,
        },
        parents: [],
      },
      {
        uid: { type: resourceType, id: req.resource.id },
        attrs: {
          tenantId: req.resource.tenantId,
        },
        parents: [],
      },
    ],
  };

  const result = cedar.isAuthorized(authorizationCall as any);

  if (result.type === 'failure') {
    return {
      isAuthorized: false,
      decision: 'deny',
      reasons: [],
      errors: result.errors,
      forbidPolicyTriggered: false,
    };
  }

  const decision = result.response.decision;
  const reasons = (result.response.diagnostics?.reason || []) as string[];
  const forbidPolicyTriggered = reasons.includes('policy_forbid_cross_tenant');

  return {
    isAuthorized: decision === 'allow',
    decision,
    reasons,
    errors: result.response.diagnostics?.errors || [],
    forbidPolicyTriggered,
  };
}
