import { jwtVerify, createRemoteJWKSet, SignJWT } from 'jose';
import { Role } from '@opslens/contracts';

export interface VerifiedClaims {
  userId: string;
  email: string;
  tenantId: string;
  role: Role;
}

export class UnauthorizedAuthError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedAuthError';
  }
}

// Local testing symmetric secret for deterministic tests and mock environment
export const LOCAL_TEST_SECRET = new TextEncoder().encode('opslens-local-development-secret-key-32-chars!!');
export const LOCAL_TEST_ISSUER = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_opslens-local';
export const LOCAL_TEST_AUDIENCE = 'opslens-spa-client-local';

/**
 * Creates a signed JWT for testing.
 */
export async function createTestJwt(
  claims: {
    userId: string;
    email: string;
    tenantId: string;
    role: Role;
  },
  options: {
    expiresIn?: string;
    issuer?: string;
    audience?: string;
    secret?: Uint8Array;
  } = {},
): Promise<string> {
  const secret = options.secret || LOCAL_TEST_SECRET;
  const issuer = options.issuer || LOCAL_TEST_ISSUER;
  const audience = options.audience || LOCAL_TEST_AUDIENCE;

  return new SignJWT({
    email: claims.email,
    'custom:tenantId': claims.tenantId,
    'cognito:groups': [claims.role],
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.userId)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn || '1h')
    .sign(secret);
}

/**
 * Validates a Cognito JWT token (signature, issuer, audience, and expiry).
 * Throws UnauthorizedAuthError (which maps to 401) on any failure.
 */
export async function verifyToken(
  token: string | undefined | null,
  options: {
    userPoolId?: string;
    clientId?: string;
    region?: string;
  } = {},
): Promise<VerifiedClaims> {
  if (!token || typeof token !== 'string' || token.trim() === '') {
    throw new UnauthorizedAuthError('Unauthorized: Missing authorization token');
  }

  const cleanToken = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();
  if (!cleanToken) {
    throw new UnauthorizedAuthError('Unauthorized: Empty Bearer token');
  }

  const region = options.region || process.env.AWS_REGION || 'us-east-1';
  const userPoolId = options.userPoolId || process.env.USER_POOL_ID;
  const clientId = options.clientId || process.env.CLIENT_ID;
  const stage = process.env.STAGE || 'local';

  try {
    let payload: Record<string, unknown>;

    if (stage === 'local' || !userPoolId || userPoolId.includes('local')) {
      // In local mode or local tests: verify with local test secret and criteria
      const verified = await jwtVerify(cleanToken, LOCAL_TEST_SECRET, {
        issuer: LOCAL_TEST_ISSUER,
        audience: LOCAL_TEST_AUDIENCE,
      });
      payload = verified.payload as Record<string, unknown>;
    } else {
      // In production/staging: verify with Cognito remote JWKS
      const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
      const JWKS = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
      const verified = await jwtVerify(cleanToken, JWKS, {
        issuer,
        audience: clientId,
      });
      payload = verified.payload as Record<string, unknown>;
    }

    const userId = payload.sub as string;
    const email = (payload.email as string) || '';
    const tenantId = (payload['custom:tenantId'] as string) || (payload.tenantId as string);
    const groups = (payload['cognito:groups'] as string[]) || [];
    const role = (groups[0] || payload.role) as Role;

    if (!userId || !tenantId || !role) {
      throw new UnauthorizedAuthError('Unauthorized: Token missing required claims (sub, tenantId, role)');
    }

    return {
      userId,
      email,
      tenantId,
      role,
    };
  } catch (err: unknown) {
    const error = err as Error;
    // Map any JWT failure (expired, bad signature, malformed) to 401 Unauthorized
    throw new UnauthorizedAuthError(`Unauthorized: ${error.message}`);
  }
}
