import { describe, it, expect } from 'vitest';
import { Role } from '@opslens/contracts';
import {
  createTestJwt,
  verifyToken,
  UnauthorizedAuthError,
  evaluateCedar,
  handler,
  PRD_PERMISSION_MATRIX,
} from '../src/index.js';

const ALL_ROLES: Role[] = ['worker', 'maintenance', 'supervisor', 'manager', 'admin'];

describe('Cedar Permission Matrix (PRD §FR-11.3)', () => {
  const actions = Object.keys(PRD_PERMISSION_MATRIX);

  for (const action of actions) {
    const spec = PRD_PERMISSION_MATRIX[action]!;

    for (const role of ALL_ROLES) {
      const shouldAllow = spec.allowedRoles.includes(role);

      it(`Evaluates ${role} on ${action} -> ${shouldAllow ? 'ALLOW' : 'DENY'}`, () => {
        const result = evaluateCedar({
          principal: {
            id: `usr-${role}`,
            tenantId: 'north-hub',
            role,
          },
          action,
          resource: {
            type: spec.resourceType,
            id: `${spec.resourceType.toLowerCase()}-1`,
            tenantId: 'north-hub',
          },
        });

        if (shouldAllow) {
          expect(result.decision).toBe('allow');
          expect(result.isAuthorized).toBe(true);
        } else {
          expect(result.decision).toBe('deny');
          expect(result.isAuthorized).toBe(false);
        }
      });
    }
  }

  describe('Strict Cross-Tenant Forbid Rule', () => {
    it('denies access when principal is north-hub and resource is south-hub, explicitly triggered by forbid policy', () => {
      // Test even with admin role (which has full permit)
      const result = evaluateCedar({
        principal: {
          id: 'usr-admin-north',
          tenantId: 'north-hub',
          role: 'admin',
        },
        action: 'createIncident',
        resource: {
          type: 'Incident',
          id: 'inc-south-1',
          tenantId: 'south-hub',
        },
      });

      expect(result.decision).toBe('deny');
      expect(result.isAuthorized).toBe(false);
      // Confirm the denial comes specifically from the forbid policy, NOT from an absent permit
      expect(result.forbidPolicyTriggered).toBe(true);
      expect(result.reasons).toContain('policy_forbid_cross_tenant');
    });
  });
});

describe('Token Validation & Error Handling (401 vs 500)', () => {
  it('allows request with valid token matching permissions', async () => {
    const token = await createTestJwt({
      userId: 'usr-admin-1',
      email: 'admin@north-hub.internal',
      tenantId: 'north-hub',
      role: 'admin',
    });

    const response = await handler({
      headers: { Authorization: `Bearer ${token}` },
      httpMethod: 'POST',
      path: '/incidents',
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:api-id/local/POST/incidents',
    });

    expect(response.policyDocument.Statement[0]?.Effect).toBe('Allow');
    expect(response.context.tenantId).toBe('north-hub');
    expect(response.context.role).toBe('admin');
  });

  it('rejects request with missing token and throws 401 Unauthorized', async () => {
    await expect(
      handler({
        headers: {},
        httpMethod: 'GET',
        path: '/incidents',
      }),
    ).rejects.toThrow('Unauthorized');
  });

  it('rejects request with expired token and throws 401 Unauthorized', async () => {
    const expiredToken = await createTestJwt(
      {
        userId: 'usr-expired',
        email: 'expired@north-hub.internal',
        tenantId: 'north-hub',
        role: 'worker',
      },
      { expiresIn: '-10s' }, // Expired 10 seconds ago
    );

    await expect(
      handler({
        headers: { Authorization: `Bearer ${expiredToken}` },
        httpMethod: 'GET',
        path: '/incidents',
      }),
    ).rejects.toThrow('Unauthorized');
  });

  it('rejects request with bad signature token and throws 401 Unauthorized', async () => {
    const badSecret = new TextEncoder().encode('wrong-secret-key-that-does-not-match-32-chars!');
    const badToken = await createTestJwt(
      {
        userId: 'usr-tampered',
        email: 'tampered@north-hub.internal',
        tenantId: 'north-hub',
        role: 'admin',
      },
      { secret: badSecret },
    );

    await expect(
      handler({
        headers: { Authorization: `Bearer ${badToken}` },
        httpMethod: 'POST',
        path: '/incidents',
      }),
    ).rejects.toThrow('Unauthorized');
  });
});
