import { verifyToken, UnauthorizedAuthError } from './jwt.js';
import { mapRouteToAction } from './route-mapper.js';
import { evaluateCedar } from './cedar-evaluator.js';

export * from './jwt.js';
export * from './route-mapper.js';
export * from './cedar-evaluator.js';
export * from './permission-matrix.js';

export interface AuthorizerEvent {
  type?: string;
  methodArn?: string;
  routeArn?: string;
  routeKey?: string;
  rawPath?: string;
  path?: string;
  httpMethod?: string;
  requestContext?: {
    httpMethod?: string;
    path?: string;
    http?: {
      method?: string;
      path?: string;
    };
    accountId?: string;
    apiId?: string;
    stage?: string;
  };
  headers?: Record<string, string | undefined>;
}

export interface AuthorizerResponse {
  principalId: string;
  policyDocument: {
    Version: string;
    Statement: Array<{
      Action: string;
      Effect: 'Allow' | 'Deny';
      Resource: string;
    }>;
  };
  context: {
    tenantId: string;
    userId: string;
    role: string;
    email: string;
  };
}

function generatePolicy(
  principalId: string,
  effect: 'Allow' | 'Deny',
  resourceArn: string,
  context?: {
    tenantId: string;
    userId: string;
    role: string;
    email: string;
  },
): AuthorizerResponse {
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: effect,
          Resource: resourceArn,
        },
      ],
    },
    context: context || {
      tenantId: '',
      userId: principalId,
      role: '',
      email: '',
    },
  };
}

/**
 * Lambda REQUEST authorizer handler.
 * Validates Cognito JWT, evaluates Cedar policies, and returns IAM Allow/Deny policy with context.
 */
export async function handler(event: AuthorizerEvent): Promise<AuthorizerResponse> {
  const authHeader =
    event.headers?.Authorization ||
    event.headers?.authorization ||
    event.headers?.['x-authorization'] ||
    event.headers?.['X-Authorization'];

  if (!authHeader) {
    // AWS API Gateway expects an exact 'Unauthorized' error to produce a 401 HTTP response
    throw new UnauthorizedAuthError('Unauthorized');
  }

  // 1. Verify token signature, issuer, audience, and expiry
  let claims;
  try {
    claims = await verifyToken(authHeader);
  } catch {
    throw new UnauthorizedAuthError('Unauthorized');
  }

  // 2. Extract path and method
  const method =
    event.httpMethod ||
    event.requestContext?.httpMethod ||
    event.requestContext?.http?.method ||
    'GET';

  const path =
    event.path ||
    event.rawPath ||
    event.requestContext?.path ||
    event.requestContext?.http?.path ||
    '/';

  const methodArn = event.methodArn || event.routeArn || '*';

  // 3. Map route to Cedar action and resource
  const mapping = mapRouteToAction(method, path);

  // 4. Resource is scoped by tenant (extract tenant from header or default to user's tenant)
  const resourceTenantId =
    event.headers?.['x-tenant-id'] ||
    event.headers?.['X-Tenant-Id'] ||
    claims.tenantId;

  // 5. Evaluate Cedar policy set
  const cedarResult = evaluateCedar({
    principal: {
      id: claims.userId,
      tenantId: claims.tenantId,
      role: claims.role,
    },
    action: mapping.action,
    resource: {
      type: mapping.resourceType,
      id: `${mapping.resourceType.toLowerCase()}-${claims.tenantId}`,
      tenantId: resourceTenantId,
    },
  });

  const effect: 'Allow' | 'Deny' = cedarResult.isAuthorized ? 'Allow' : 'Deny';

  return generatePolicy(claims.userId, effect, methodArn, {
    tenantId: claims.tenantId,
    userId: claims.userId,
    role: claims.role,
    email: claims.email,
  });
}
