import { DynamoDBClient, DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/**
 * Returns the configured DynamoDB table name from the environment.
 * Defaults to 'opslens-local'.
 */
export function getTableName(): string {
  return process.env.TABLE_NAME || 'opslens-local';
}

/**
 * Determines whether the current execution context is targeting LocalStack.
 */
export function isLocal(): boolean {
  return (
    process.env.STAGE === 'local' ||
    Boolean(process.env.LOCALSTACK_HOSTNAME) ||
    Boolean(process.env.AWS_ENDPOINT_URL) ||
    !process.env.STAGE
  );
}

/**
 * Creates a configured DynamoDBClient instance.
 */
export function createDynamoClient(config: DynamoDBClientConfig = {}): DynamoDBClient {
  const isLocalEnv = isLocal();
  const endpoint =
    process.env.LOCALSTACK_ENDPOINT ||
    process.env.AWS_ENDPOINT_URL ||
    (isLocalEnv ? 'http://localhost:4566' : undefined);

  const region = process.env.AWS_REGION || 'us-east-1';

  const clientConfig: DynamoDBClientConfig = {
    region,
    ...config,
  };

  if (endpoint) {
    clientConfig.endpoint = endpoint;
  }

  if (isLocalEnv) {
    clientConfig.credentials = clientConfig.credentials || {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
    };
  }

  return new DynamoDBClient(clientConfig);
}

/**
 * Creates a DynamoDBDocumentClient with marshall options.
 * `removeUndefinedValues: true` ensures sparse attributes (like GSI3 on resolved incidents)
 * are cleanly handled without writing empty strings or nulls.
 */
export function createDocClient(dynamoClient?: DynamoDBClient): DynamoDBDocumentClient {
  const rawClient = dynamoClient || createDynamoClient();
  return DynamoDBDocumentClient.from(rawClient, {
    marshallOptions: {
      removeUndefinedValues: true,
      convertEmptyValues: false,
    },
    unmarshallOptions: {
      wrapNumbers: false,
    },
  });
}

/**
 * Singleton DocumentClient instance for runtime usage.
 */
export const docClient: DynamoDBDocumentClient = createDocClient();

export function getDocClient(): DynamoDBDocumentClient {
  return docClient;
}
