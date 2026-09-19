import { handler } from '../services/api-uploads/src/handler.js';
import {
  createPresignedUploadUrl,
  createS3Client,
  getMediaBucket,
  headObject,
} from '../services/api-uploads/src/s3.js';
import type { APIGatewayProxyEvent } from 'aws-lambda';

async function verifyUploads() {
  console.log('=== [OpsLens] Verifying services/api-uploads ===\n');

  const tenantId = 'north-hub';
  const bucket = getMediaBucket();
  const s3 = createS3Client();

  // 1. Test Presigned PUT URL & Direct S3 Upload against LocalStack
  console.log('1. Testing presigned URL generation and PUT against LocalStack S3...');
  const presignResult = await createPresignedUploadUrl({
    tenantId,
    contentType: 'image/jpeg',
    fileExtension: 'jpg',
    client: s3,
  });

  console.log('   Presigned URL generated:', presignResult.uploadUrl);
  console.log('   Staging S3 Key:', presignResult.s3Key);

  // Validate Key pattern
  const stagingRegex = /^tenants\/north-hub\/incidents\/staging\/[0-9A-HJKMNP-TV-Z]{26}\.jpg$/;
  if (!stagingRegex.test(presignResult.s3Key)) {
    throw new Error(`S3 key ${presignResult.s3Key} did not match expected format`);
  }
  console.log('   ✅ Key pattern matches tenants/<tenantId>/incidents/staging/<ulid>.<ext>');

  // Perform HTTP PUT with test image payload
  const testPayload = Buffer.from('FAKE_JPEG_IMAGE_BINARY_DATA_TEST_123');
  const uploadResponse = await fetch(presignResult.uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'image/jpeg',
    },
    body: testPayload,
  });

  if (!uploadResponse.ok) {
    throw new Error(`S3 PUT failed with status ${uploadResponse.status} ${uploadResponse.statusText}`);
  }
  console.log(`   ✅ S3 PUT succeeded (HTTP ${uploadResponse.status})`);

  // Verify object exists in bucket via HeadObject
  const headRes = await headObject(bucket, presignResult.s3Key, s3);
  console.log(`   ✅ S3 HeadObject confirmed: ContentLength = ${headRes.ContentLength} bytes`);

  // 2. Test Lambda Handler with valid photo request
  console.log('\n2. Testing Lambda Handler with valid photo (photo <= 5MB)...');
  const validPhotoEvent = {
    body: JSON.stringify({
      kind: 'photo',
      contentType: 'image/png',
      sizeBytes: 1024 * 1024,
    }),
    headers: {
      'x-correlation-id': 'corr-verify-photo',
    },
    requestContext: {
      authorizer: {
        tenantId: 'north-hub',
        userId: 'usr-worker-01',
        role: 'worker',
        email: 'worker@north-hub.opslens.internal',
      },
    },
  } as unknown as APIGatewayProxyEvent;

  const photoRes = await handler(validPhotoEvent);
  console.log(`   Lambda status: ${photoRes.statusCode}`);
  const photoBody = JSON.parse(photoRes.body);
  console.log(`   Generated Key: ${photoBody.s3Key}`);
  if (photoRes.statusCode !== 200 || !photoBody.uploadUrl) {
    throw new Error(`Expected 200, got ${photoRes.statusCode}`);
  }
  console.log('   ✅ Valid photo request returns 200 and presigned URL');

  // 3. Test Lambda Handler with valid audio request
  console.log('\n3. Testing Lambda Handler with valid audio (audio <= 10MB)...');
  const validAudioEvent = {
    body: JSON.stringify({
      kind: 'audio',
      contentType: 'audio/webm',
      sizeBytes: 8 * 1024 * 1024,
    }),
    headers: {
      'x-correlation-id': 'corr-verify-audio',
    },
    requestContext: {
      authorizer: {
        tenantId: 'south-hub',
        userId: 'usr-supervisor-01',
        role: 'supervisor',
        email: 'supervisor@south-hub.opslens.internal',
      },
    },
  } as unknown as APIGatewayProxyEvent;

  const audioRes = await handler(validAudioEvent);
  console.log(`   Lambda status: ${audioRes.statusCode}`);
  const audioBody = JSON.parse(audioRes.body);
  console.log(`   Generated Key: ${audioBody.s3Key}`);
  if (audioRes.statusCode !== 200 || !audioBody.uploadUrl) {
    throw new Error(`Expected 200, got ${audioRes.statusCode}`);
  }
  console.log('   ✅ Valid audio request returns 200 and presigned URL');

  // 4. Test Rejecting oversized photo (> 5MB)
  console.log('\n4. Testing oversized photo (> 5MB) rejection...');
  const oversizePhotoEvent = {
    body: JSON.stringify({
      kind: 'photo',
      contentType: 'image/jpeg',
      sizeBytes: 5 * 1024 * 1024 + 1,
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

  const oversizePhotoRes = await handler(oversizePhotoEvent);
  console.log(`   Status: ${oversizePhotoRes.statusCode}, Body: ${oversizePhotoRes.body}`);
  if (oversizePhotoRes.statusCode !== 400) {
    throw new Error(`Expected 400 for oversized photo, got ${oversizePhotoRes.statusCode}`);
  }
  console.log('   ✅ Oversized photo rejected with 400 VALIDATION_ERROR');

  // 5. Test Rejecting oversized audio (> 10MB)
  console.log('\n5. Testing oversized audio (> 10MB) rejection...');
  const oversizeAudioEvent = {
    body: JSON.stringify({
      kind: 'audio',
      contentType: 'audio/mp4',
      sizeBytes: 10 * 1024 * 1024 + 1,
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

  const oversizeAudioRes = await handler(oversizeAudioEvent);
  console.log(`   Status: ${oversizeAudioRes.statusCode}, Body: ${oversizeAudioRes.body}`);
  if (oversizeAudioRes.statusCode !== 400) {
    throw new Error(`Expected 400 for oversized audio, got ${oversizeAudioRes.statusCode}`);
  }
  console.log('   ✅ Oversized audio rejected with 400 VALIDATION_ERROR');

  // 6. Test Rejecting disallowed mime types
  console.log('\n6. Testing disallowed MIME types rejection...');
  const badMimeEvent = {
    body: JSON.stringify({
      kind: 'photo',
      contentType: 'application/octet-stream',
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

  const badMimeRes = await handler(badMimeEvent);
  console.log(`   Status: ${badMimeRes.statusCode}, Body: ${badMimeRes.body}`);
  if (badMimeRes.statusCode !== 400) {
    throw new Error(`Expected 400 for invalid MIME, got ${badMimeRes.statusCode}`);
  }
  console.log('   ✅ Disallowed MIME type rejected with 400 VALIDATION_ERROR');

  console.log('\n🎉 ALL SERVICES/API-UPLOADS VERIFICATION CHECKS PASSED!');
}

verifyUploads().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
