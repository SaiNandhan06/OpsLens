import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { logger } from '@opslens/platform';

let client: SNSClient | null = null;

export function getSnsClient(): SNSClient {
  if (!client) {
    const endpoint = process.env.LOCALSTACK_ENDPOINT || process.env.AWS_ENDPOINT_URL || 'http://localhost:4566';
    const region = process.env.AWS_REGION || 'us-east-1';

    client = new SNSClient({
      region,
      endpoint,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
      },
    });
  }
  return client;
}

export function getNotificationTopicArn(): string {
  return (
    process.env.NOTIFICATION_TOPIC_ARN ||
    'arn:aws:sns:us-east-1:000000000000:opslens-notifications-local'
  );
}

export interface SendNotificationParams {
  subject: string;
  message: string;
  recipient: string;
  eventType: string;
  incidentId: string;
  tenantId: string;
}

export async function sendSnsNotification(
  params: SendNotificationParams,
  snsClient: SNSClient = getSnsClient(),
): Promise<{ messageId?: string; success: boolean }> {
  const topicArn = getNotificationTopicArn();
  try {
    const res = await snsClient.send(
      new PublishCommand({
        TopicArn: topicArn,
        Subject: params.subject,
        Message: params.message,
        MessageAttributes: {
          tenantId: { DataType: 'String', StringValue: params.tenantId },
          incidentId: { DataType: 'String', StringValue: params.incidentId },
          eventType: { DataType: 'String', StringValue: params.eventType },
          recipient: { DataType: 'String', StringValue: params.recipient },
        },
      }),
    );

    logger.info('SNS notification dispatched successfully', {
      incidentId: params.incidentId,
      eventType: params.eventType,
      recipient: params.recipient,
      messageId: res.MessageId,
    });

    return { messageId: res.MessageId, success: true };
  } catch (err: any) {
    logger.error('Failed to dispatch SNS notification', {
      error: err.message,
      incidentId: params.incidentId,
      eventType: params.eventType,
    });
    return { success: false };
  }
}
