import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

// Resolve aws-sdk from packages/data where it is a declared dependency
const dataPkgRequire = createRequire(path.join(projectRoot, 'packages/data/package.json'));
const { DynamoDBClient, CreateTableCommand, DescribeTableCommand } = dataPkgRequire('@aws-sdk/client-dynamodb');
const uploadsPkgRequire = createRequire(path.join(projectRoot, 'services/api-uploads/package.json'));
const { S3Client, CreateBucketCommand, HeadBucketCommand } = uploadsPkgRequire('@aws-sdk/client-s3');

const endpoint = process.env.LOCALSTACK_ENDPOINT || process.env.AWS_ENDPOINT_URL || 'http://localhost:4566';
const region = process.env.AWS_REGION || 'us-east-1';
const tableName = process.env.TABLE_NAME || 'opslens-local';
const mediaBucket = process.env.MEDIA_BUCKET || 'opslens-media-local';

const client = new DynamoDBClient({
  endpoint,
  region,
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test',
  },
});

const s3Client = new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test',
  },
});

async function bootstrap() {
  console.log(`[Bootstrap] Checking table "${tableName}" at ${endpoint}...`);
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    console.log(`[Bootstrap] Table "${tableName}" already exists.`);
  } catch (err) {
    if (err.name === 'ResourceNotFoundException' || err.__type?.includes('ResourceNotFound')) {
      console.log(`[Bootstrap] Creating table "${tableName}"...`);
      await client.send(
        new CreateTableCommand({
          TableName: tableName,
          BillingMode: 'PAY_PER_REQUEST',
          AttributeDefinitions: [
            { AttributeName: 'PK', AttributeType: 'S' },
            { AttributeName: 'SK', AttributeType: 'S' },
            { AttributeName: 'gsi1pk', AttributeType: 'S' },
            { AttributeName: 'gsi1sk', AttributeType: 'S' },
            { AttributeName: 'gsi2pk', AttributeType: 'S' },
            { AttributeName: 'gsi2sk', AttributeType: 'S' },
            { AttributeName: 'gsi3pk', AttributeType: 'S' },
            { AttributeName: 'gsi3sk', AttributeType: 'S' },
            { AttributeName: 'gsi4pk', AttributeType: 'S' },
            { AttributeName: 'gsi4sk', AttributeType: 'S' },
          ],
          KeySchema: [
            { AttributeName: 'PK', KeyType: 'HASH' },
            { AttributeName: 'SK', KeyType: 'RANGE' },
          ],
          GlobalSecondaryIndexes: [
            {
              IndexName: 'GSI1',
              KeySchema: [
                { AttributeName: 'gsi1pk', KeyType: 'HASH' },
                { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
              ],
              Projection: { ProjectionType: 'ALL' },
            },
            {
              IndexName: 'GSI2',
              KeySchema: [
                { AttributeName: 'gsi2pk', KeyType: 'HASH' },
                { AttributeName: 'gsi2sk', KeyType: 'RANGE' },
              ],
              Projection: { ProjectionType: 'ALL' },
            },
            {
              IndexName: 'GSI3',
              KeySchema: [
                { AttributeName: 'gsi3pk', KeyType: 'HASH' },
                { AttributeName: 'gsi3sk', KeyType: 'RANGE' },
              ],
              Projection: { ProjectionType: 'ALL' },
            },
            {
              IndexName: 'GSI4',
              KeySchema: [
                { AttributeName: 'gsi4pk', KeyType: 'HASH' },
                { AttributeName: 'gsi4sk', KeyType: 'RANGE' },
              ],
              Projection: { ProjectionType: 'ALL' },
            },
          ],
        }),
      );
      console.log(`[Bootstrap] Table "${tableName}" created successfully.`);
    } else {
      throw err;
    }
  }

  console.log(`[Bootstrap] Checking S3 media bucket "${mediaBucket}" at ${endpoint}...`);
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: mediaBucket }));
    console.log(`[Bootstrap] S3 bucket "${mediaBucket}" already exists.`);
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      console.log(`[Bootstrap] Creating S3 bucket "${mediaBucket}"...`);
      await s3Client.send(new CreateBucketCommand({ Bucket: mediaBucket }));
      console.log(`[Bootstrap] S3 bucket "${mediaBucket}" created successfully.`);
    } else {
      throw err;
    }
  }

  const eventBusName = process.env.EVENT_BUS_NAME || 'opslens-events-local';
  console.log(`[Bootstrap] Checking EventBridge bus "${eventBusName}" at ${endpoint}...`);
  try {
    const ebPkgRequire = createRequire(path.join(projectRoot, 'services/api-incidents/package.json'));
    const { EventBridgeClient, CreateEventBusCommand, DescribeEventBusCommand } = ebPkgRequire('@aws-sdk/client-eventbridge');
    const ebClient = new EventBridgeClient({
      endpoint,
      region,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    try {
      await ebClient.send(new DescribeEventBusCommand({ Name: eventBusName }));
      console.log(`[Bootstrap] EventBridge bus "${eventBusName}" already exists.`);
    } catch {
      console.log(`[Bootstrap] Creating EventBridge bus "${eventBusName}"...`);
      await ebClient.send(new CreateEventBusCommand({ Name: eventBusName }));
      console.log(`[Bootstrap] EventBridge bus "${eventBusName}" created successfully.`);
    }
  } catch (ebErr) {
    console.warn(`[Bootstrap] Note: EventBridge setup skipped or failed:`, ebErr.message);
  }

  const notificationTopic = process.env.NOTIFICATION_TOPIC || 'opslens-notifications-local';
  console.log(`[Bootstrap] Checking SNS topic "${notificationTopic}" at ${endpoint}...`);
  try {
    const snsPkgRequire = createRequire(path.join(projectRoot, 'services/worker-notifier/package.json'));
    const { SNSClient, CreateTopicCommand } = snsPkgRequire('@aws-sdk/client-sns');
    const snsClient = new SNSClient({
      endpoint,
      region,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    const res = await snsClient.send(new CreateTopicCommand({ Name: notificationTopic }));
    console.log(`[Bootstrap] SNS topic "${notificationTopic}" ready (${res.TopicArn}).`);
  } catch (snsErr) {
    console.warn(`[Bootstrap] Note: SNS setup skipped or failed:`, snsErr.message);
  }
}

bootstrap().catch((err) => {
  console.error('[Bootstrap] Failed to bootstrap LocalStack resources:', err);
  process.exit(1);
});
