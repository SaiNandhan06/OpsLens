import type { ScheduledEvent, Context } from 'aws-lambda';
import { runSlaSweeper, SlaSweeperResult } from './sweeper.js';
import { logger } from '@opslens/platform';

export * from './sweeper.js';
export * from './eventbridge.js';

/**
 * Lambda entry point triggered by EventBridge Scheduled Rule (rate(1 minute)).
 */
export async function handler(
  event: ScheduledEvent,
  _context?: Context,
): Promise<SlaSweeperResult> {
  const sweepTime = event.time ? new Date(event.time) : new Date();
  logger.info('Received EventBridge scheduled rate(1 minute) SLA sweeper trigger', {
    eventTime: event.time,
    sweepTime: sweepTime.toISOString(),
  });

  return runSlaSweeper({ now: sweepTime });
}
