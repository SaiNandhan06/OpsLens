import { describe, it, expect } from 'vitest';
import { getAuthContext } from '../src/auth.js';
import { UnauthorizedError } from '../src/errors.js';

describe('platform auth helper', () => {
  it('extracts valid AuthContext from requestContext.authorizer', () => {
    const event = {
      requestContext: {
        authorizer: {
          tenantId: 'north-hub',
          userId: 'usr-1',
          role: 'worker',
          email: 'worker@north-hub.opslens.internal',
        },
      },
    };

    const ctx = getAuthContext(event);
    expect(ctx.tenantId).toBe('north-hub');
    expect(ctx.userId).toBe('usr-1');
    expect(ctx.role).toBe('worker');
    expect(ctx.email).toBe('worker@north-hub.opslens.internal');
  });

  it('extracts valid AuthContext from HTTP API authorizer.lambda nesting', () => {
    const event = {
      requestContext: {
        authorizer: {
          lambda: {
            tenantId: 'south-hub',
            userId: 'usr-2',
            role: 'supervisor',
            email: 'sup@south-hub.opslens.internal',
          },
        },
      },
    };

    const ctx = getAuthContext(event);
    expect(ctx.tenantId).toBe('south-hub');
    expect(ctx.role).toBe('supervisor');
  });

  it('throws UnauthorizedError when requestContext is missing or empty', () => {
    expect(() => getAuthContext(undefined)).toThrow(UnauthorizedError);
    expect(() => getAuthContext({})).toThrow(UnauthorizedError);
    expect(() => getAuthContext({ requestContext: {} })).toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError when AuthContext shape is invalid (e.g. invalid role)', () => {
    const event = {
      requestContext: {
        authorizer: {
          tenantId: 'north-hub',
          userId: 'usr-1',
          role: 'hacker', // invalid role
          email: 'invalid@test.com',
        },
      },
    };

    expect(() => getAuthContext(event)).toThrow(UnauthorizedError);
  });
});
