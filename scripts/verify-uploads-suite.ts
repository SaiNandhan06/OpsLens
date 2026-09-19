import fs from 'node:fs';
import path from 'node:path';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../services/api-uploads/src/handler.js';
import {
  createPresignedUploadUrl,
  createS3Client,
  getMediaBucket,
  headObject,
} from '../services/api-uploads/src/s3.js';

interface CheckResult {
  num: number;
  title: string;
  status: 'PASS' | 'FAIL';
  evidence: string[];
}

const results: CheckResult[] = [];

async function runSuite() {
  console.log('====================================================');
  console.log(' OpsLens Uploads Verification Suite');
  console.log('====================================================\n');

  const s3 = createS3Client();
  const bucket = getMediaBucket();

  // ----------------------------------------------------
  // Check 1: Request presigned URL, PUT small test image to LocalStack, confirm object exists at key
  // ----------------------------------------------------
  {
    const ev: string[] = [];
    try {
      const presign = await createPresignedUploadUrl({
        tenantId: 'north-hub',
        contentType: 'image/jpeg',
        fileExtension: 'jpg',
        client: s3,
      });

      ev.push(`Generated Presigned URL: ${presign.uploadUrl.substring(0, 100)}...`);
      ev.push(`Expected S3 Key: ${presign.s3Key}`);

      // Small 1x1 test JPEG payload
      const testImageBuffer = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
        0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
        0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
        0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
        0xff, 0xd9,
      ]);

      const putRes = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'image/jpeg',
        },
        body: testImageBuffer,
      });

      ev.push(`PUT Response Status: ${putRes.status} ${putRes.statusText}`);
      if (!putRes.ok) {
        throw new Error(`Failed to PUT image to presigned URL: ${putRes.status}`);
      }

      const headRes = await headObject(bucket, presign.s3Key, s3);
      ev.push(`S3 HeadObject Confirmed: Key=${presign.s3Key}, ContentLength=${headRes.ContentLength} bytes`);

      results.push({
        num: 1,
        title: 'Presigned URL PUT & S3 Object Existence in LocalStack',
        status: 'PASS',
        evidence: ev,
      });
    } catch (err) {
      ev.push(`Error: ${(err as Error).message}`);
      results.push({
        num: 1,
        title: 'Presigned URL PUT & S3 Object Existence in LocalStack',
        status: 'FAIL',
        evidence: ev,
      });
    }
  }

  // ----------------------------------------------------
  // Check 2: Confirm oversized and wrong-content-type requests return 400 with specific error code
  // ----------------------------------------------------
  {
    const ev: string[] = [];
    try {
      const oversizedPhotoEvent = {
        body: JSON.stringify({
          kind: 'photo',
          contentType: 'image/png',
          sizeBytes: 6 * 1024 * 1024, // 6MB > 5MB limit
        }),
        requestContext: {
          authorizer: {
            tenantId: 'north-hub',
            userId: 'usr-1',
            role: 'worker',
            email: 'w@n.io',
          },
        },
      } as unknown as APIGatewayProxyEvent;

      const resOversized = await handler(oversizedPhotoEvent);
      const bodyOversized = JSON.parse(resOversized.body);
      ev.push(`Oversized Photo: StatusCode=${resOversized.statusCode}, ErrorCode=${bodyOversized.error?.code}, Message="${bodyOversized.error?.message}"`);

      const wrongMimeEvent = {
        body: JSON.stringify({
          kind: 'photo',
          contentType: 'application/pdf',
          sizeBytes: 1024,
        }),
        requestContext: {
          authorizer: {
            tenantId: 'north-hub',
            userId: 'usr-1',
            role: 'worker',
            email: 'w@n.io',
          },
        },
      } as unknown as APIGatewayProxyEvent;

      const resWrongMime = await handler(wrongMimeEvent);
      const bodyWrongMime = JSON.parse(resWrongMime.body);
      ev.push(`Wrong MIME Type: StatusCode=${resWrongMime.statusCode}, ErrorCode=${bodyWrongMime.error?.code}, Message="${bodyWrongMime.error?.message}"`);

      const wrongKindEvent = {
        body: JSON.stringify({
          kind: 'document',
          contentType: 'image/jpeg',
          sizeBytes: 1024,
        }),
        requestContext: {
          authorizer: {
            tenantId: 'north-hub',
            userId: 'usr-1',
            role: 'worker',
            email: 'w@n.io',
          },
        },
      } as unknown as APIGatewayProxyEvent;

      const resWrongKind = await handler(wrongKindEvent);
      const bodyWrongKind = JSON.parse(resWrongKind.body);
      ev.push(`Invalid Kind: StatusCode=${resWrongKind.statusCode}, ErrorCode=${bodyWrongKind.error?.code}, Message="${bodyWrongKind.error?.message}"`);

      const isPass =
        resOversized.statusCode === 400 &&
        bodyOversized.error?.code === 'VALIDATION_ERROR' &&
        resWrongMime.statusCode === 400 &&
        bodyWrongMime.error?.code === 'VALIDATION_ERROR' &&
        resWrongKind.statusCode === 400 &&
        bodyWrongKind.error?.code === 'VALIDATION_ERROR';

      results.push({
        num: 2,
        title: 'Oversized and Wrong-Content-Type Return 400 with Specific Error Code',
        status: isPass ? 'PASS' : 'FAIL',
        evidence: ev,
      });
    } catch (err) {
      ev.push(`Error: ${(err as Error).message}`);
      results.push({
        num: 2,
        title: 'Oversized and Wrong-Content-Type Return 400 with Specific Error Code',
        status: 'FAIL',
        evidence: ev,
      });
    }
  }

  // ----------------------------------------------------
  // Check 3: Confirm key is tenant-prefixed and user from another tenant cannot obtain a URL for that prefix
  // ----------------------------------------------------
  {
    const ev: string[] = [];
    try {
      // User 1 is north-hub
      const northEvent = {
        body: JSON.stringify({
          kind: 'photo',
          contentType: 'image/jpeg',
          sizeBytes: 1024,
        }),
        requestContext: {
          authorizer: {
            tenantId: 'north-hub',
            userId: 'usr-north-01',
            role: 'worker',
            email: 'worker@north-hub.io',
          },
        },
      } as unknown as APIGatewayProxyEvent;

      const northRes = await handler(northEvent);
      const northBody = JSON.parse(northRes.body);
      ev.push(`User 'north-hub' generated key: ${northBody.s3Key}`);
      ev.push(`  Matches prefix '^tenants/north-hub/': ${northBody.s3Key.startsWith('tenants/north-hub/')}`);

      // User 2 is south-hub, attempting to pass body or request
      const southEvent = {
        body: JSON.stringify({
          kind: 'photo',
          contentType: 'image/jpeg',
          sizeBytes: 1024,
          // Attacker attempting to request north-hub prefix in payload
          tenantId: 'north-hub',
          prefix: 'tenants/north-hub/',
        }),
        requestContext: {
          authorizer: {
            tenantId: 'south-hub',
            userId: 'usr-south-01',
            role: 'worker',
            email: 'worker@south-hub.io',
          },
        },
      } as unknown as APIGatewayProxyEvent;

      const southRes = await handler(southEvent);
      const southBody = JSON.parse(southRes.body);
      ev.push(`User 'south-hub' generated key: ${southBody.s3Key}`);
      ev.push(`  Matches prefix '^tenants/south-hub/': ${southBody.s3Key.startsWith('tenants/south-hub/')}`);
      ev.push(`  Does NOT contain 'north-hub': ${!southBody.s3Key.includes('north-hub')}`);

      const isPass =
        northBody.s3Key.startsWith('tenants/north-hub/') &&
        southBody.s3Key.startsWith('tenants/south-hub/') &&
        !southBody.s3Key.includes('north-hub');

      results.push({
        num: 3,
        title: 'Tenant-Prefixed S3 Key & Cross-Tenant Prefix Isolation',
        status: isPass ? 'PASS' : 'FAIL',
        evidence: ev,
      });
    } catch (err) {
      ev.push(`Error: ${(err as Error).message}`);
      results.push({
        num: 3,
        title: 'Tenant-Prefixed S3 Key & Cross-Tenant Prefix Isolation',
        status: 'FAIL',
        evidence: ev,
      });
    }
  }

  // ----------------------------------------------------
  // Check 4: Confirm bucket blocks public access and has SSE enabled in template.yaml
  // ----------------------------------------------------
  {
    const ev: string[] = [];
    try {
      const templatePath = path.resolve(process.cwd(), 'template.yaml');
      const templateContent = fs.readFileSync(templatePath, 'utf-8');

      // Check SSE
      const hasSSEAlgorithm = /SSEAlgorithm:\s*AES256/.test(templateContent);
      const hasBucketEncryption = /BucketEncryption:/.test(templateContent);
      ev.push(`SSE Configuration Present: ${hasBucketEncryption && hasSSEAlgorithm}`);

      // Check Public Access Block
      const hasBlockPublicAcls = /BlockPublicAcls:\s*true/.test(templateContent);
      const hasBlockPublicPolicy = /BlockPublicPolicy:\s*true/.test(templateContent);
      const hasIgnorePublicAcls = /IgnorePublicAcls:\s*true/.test(templateContent);
      const hasRestrictPublicBuckets = /RestrictPublicBuckets:\s*true/.test(templateContent);
      ev.push(`Public Access Block Configuration:`);
      ev.push(`  BlockPublicAcls: true (${hasBlockPublicAcls})`);
      ev.push(`  BlockPublicPolicy: true (${hasBlockPublicPolicy})`);
      ev.push(`  IgnorePublicAcls: true (${hasIgnorePublicAcls})`);
      ev.push(`  RestrictPublicBuckets: true (${hasRestrictPublicBuckets})`);

      const isPass =
        hasSSEAlgorithm &&
        hasBucketEncryption &&
        hasBlockPublicAcls &&
        hasBlockPublicPolicy &&
        hasIgnorePublicAcls &&
        hasRestrictPublicBuckets;

      results.push({
        num: 4,
        title: 'Bucket Blocks Public Access & Has SSE Enabled in template.yaml',
        status: isPass ? 'PASS' : 'FAIL',
        evidence: ev,
      });
    } catch (err) {
      ev.push(`Error: ${(err as Error).message}`);
      results.push({
        num: 4,
        title: 'Bucket Blocks Public Access & Has SSE Enabled in template.yaml',
        status: 'FAIL',
        evidence: ev,
      });
    }
  }

  // ----------------------------------------------------
  // Check 5: Confirm staging lifecycle rule exists with a 1-day expiry
  // ----------------------------------------------------
  {
    const ev: string[] = [];
    try {
      const templatePath = path.resolve(process.cwd(), 'template.yaml');
      const templateContent = fs.readFileSync(templatePath, 'utf-8');

      const hasLifecycleConfig = /LifecycleConfiguration:/.test(templateContent);
      const hasStatusEnabled = /Status:\s*Enabled/.test(templateContent);
      const hasExpirationInDays1 = /ExpirationInDays:\s*1/.test(templateContent);
      const hasStagingPrefixOrId = /staging/i.test(templateContent);

      ev.push(`LifecycleConfiguration block: ${hasLifecycleConfig}`);
      ev.push(`Status: Enabled: ${hasStatusEnabled}`);
      ev.push(`ExpirationInDays: 1: ${hasExpirationInDays1}`);
      ev.push(`Rule targets staging: ${hasStagingPrefixOrId}`);

      const isPass =
        hasLifecycleConfig &&
        hasStatusEnabled &&
        hasExpirationInDays1 &&
        hasStagingPrefixOrId;

      results.push({
        num: 5,
        title: 'Staging Lifecycle Rule Exists with 1-Day Expiry in template.yaml',
        status: isPass ? 'PASS' : 'FAIL',
        evidence: ev,
      });
    } catch (err) {
      ev.push(`Error: ${(err as Error).message}`);
      results.push({
        num: 5,
        title: 'Staging Lifecycle Rule Exists with 1-Day Expiry in template.yaml',
        status: 'FAIL',
        evidence: ev,
      });
    }
  }

  // ----------------------------------------------------
  // Check 6: Confirm presign URL expires in 15 minutes
  // ----------------------------------------------------
  {
    const ev: string[] = [];
    try {
      const presign = await createPresignedUploadUrl({
        tenantId: 'north-hub',
        contentType: 'image/jpeg',
        fileExtension: 'jpg',
        client: s3,
      });

      const urlObj = new URL(presign.uploadUrl);
      const expiresParam = urlObj.searchParams.get('X-Amz-Expires');
      ev.push(`URL Query Param 'X-Amz-Expires': ${expiresParam} seconds`);

      const expiryDiffSeconds = (new Date(presign.expiresAt).getTime() - Date.now()) / 1000;
      ev.push(`Response field 'expiresAt': ${presign.expiresAt} (~${Math.round(expiryDiffSeconds)}s from now)`);

      const isPass = expiresParam === '900' && Math.abs(expiryDiffSeconds - 900) < 10;

      results.push({
        num: 6,
        title: 'Presigned URL Expires in Exactly 15 Minutes (900 seconds)',
        status: isPass ? 'PASS' : 'FAIL',
        evidence: ev,
      });
    } catch (err) {
      ev.push(`Error: ${(err as Error).message}`);
      results.push({
        num: 6,
        title: 'Presigned URL Expires in Exactly 15 Minutes (900 seconds)',
        status: 'FAIL',
        evidence: ev,
      });
    }
  }

  // ----------------------------------------------------
  // Print Summary Table
  // ----------------------------------------------------
  console.log('## Uploads Verification Results\n');
  console.log('| Check # | Requirement | Status |');
  console.log('|:---:|---|:---:|');
  for (const r of results) {
    console.log(`| ${r.num} | ${r.title} | **${r.status}** |`);
  }
  console.log('\n### Detailed Evidence by Check\n');
  for (const r of results) {
    console.log(`#### Check ${r.num}: ${r.title} [${r.status}]`);
    for (const line of r.evidence) {
      console.log(`- ${line}`);
    }
    console.log();
  }
}

runSuite().catch((err) => {
  console.error('Fatal suite error:', err);
  process.exit(1);
});
