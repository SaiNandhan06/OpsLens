import { handler, createTestJwt } from '../services/authorizer/src/index.js';

async function testTokenScenario(name: string, headers: Record<string, string | undefined>) {
  try {
    await handler({
      headers,
      httpMethod: 'GET',
      path: '/incidents',
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:api-id/local/GET/incidents',
    });
    console.error(`FAIL: ${name} did not throw an error!`);
    return { name, status: 'FAIL', code: 200 };
  } catch (err: unknown) {
    const error = err as Error;
    const is401 = error.message === 'Unauthorized' || error.name === 'UnauthorizedAuthError';
    console.log(`${name}: Caught expected error -> "${error.message}" (Name: ${error.name}) => Maps to HTTP 401: ${is401 ? 'YES (PASS)' : 'NO (FAIL - 500)'}`);
    return { name, status: is401 ? 'PASS' : 'FAIL', message: error.message };
  }
}

async function main() {
  console.log('[Check 4] Confirming expired token, bad signature token, and missing token all return 401 (not 500)...\n');

  // 1. Missing Token
  const res1 = await testTokenScenario('1. Missing Token', {});

  // 2. Expired Token
  const expiredToken = await createTestJwt(
    {
      userId: 'usr-1',
      email: 'worker@north-hub.internal',
      tenantId: 'north-hub',
      role: 'worker',
    },
    { expiresIn: '-10s' },
  );
  const res2 = await testTokenScenario('2. Expired Token', {
    Authorization: `Bearer ${expiredToken}`,
  });

  // 3. Bad Signature Token
  const badSecret = new TextEncoder().encode('invalid-tampered-secret-key-32-chars!');
  const badToken = await createTestJwt(
    {
      userId: 'usr-1',
      email: 'worker@north-hub.internal',
      tenantId: 'north-hub',
      role: 'worker',
    },
    { secret: badSecret },
  );
  const res3 = await testTokenScenario('3. Bad Signature Token', {
    Authorization: `Bearer ${badToken}`,
  });

  const allPass = [res1, res2, res3].every((r) => r.status === 'PASS');
  console.log(`\nAll token error scenarios mapped to 401: ${allPass ? 'PASS' : 'FAIL'}`);

  if (!allPass) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
