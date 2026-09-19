import type { ShiftPattern } from './types.js';

export interface LocalTimeDetails {
  hour: number;
  minute: number;
  weekday: string;
  isWeekend: boolean;
}

/**
 * Extracts local hour, minute, and weekday for a given timestamp in the specified IANA timezone.
 */
export function getLocalTimeDetails(now: Date | string | number, timezone = 'UTC'): LocalTimeDetails {
  const date = typeof now === 'string' || typeof now === 'number' ? new Date(now) : now;
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    });
    const parts = dtf.formatToParts(date);
    let hour = 0;
    let minute = 0;
    let weekday = '';
    for (const part of parts) {
      if (part.type === 'hour') hour = parseInt(part.value, 10);
      if (part.type === 'minute') minute = parseInt(part.value, 10);
      if (part.type === 'weekday') weekday = part.value;
    }
    if (hour === 24) hour = 0;
    const isWeekend = weekday === 'Sat' || weekday === 'Sun';
    return { hour, minute, weekday, isWeekend };
  } catch {
    // Fallback to UTC if timezone invalid
    const hour = date.getUTCHours();
    const minute = date.getUTCMinutes();
    const day = date.getUTCDay();
    const isWeekend = day === 0 || day === 6;
    return { hour, minute, weekday: isWeekend ? 'Sat' : 'Mon', isWeekend };
  }
}

/**
 * Determines if a team with a given shift pattern has active personnel on shift
 * at the given timestamp in the tenant's local timezone.
 *
 * Supported Shift Models:
 * - 24x7_ROTATIONAL: 24/7 continuous operations (always on-shift).
 * - STANDARD_DAY: Mon-Fri 08:00 - 17:00 local time. Weekends and outside 08:00-17:00 are off-shift.
 * - TWO_SHIFT: Daily 06:00 - 22:00 local time. Night hours (22:00 - 06:00) are off-shift.
 */
export function isTeamOnShift(
  shiftPattern: ShiftPattern | undefined,
  timezone = 'UTC',
  now: Date | string | number = new Date(),
): boolean {
  if (!shiftPattern || shiftPattern === '24x7_ROTATIONAL') {
    return true;
  }

  const { hour, isWeekend } = getLocalTimeDetails(now, timezone);

  switch (shiftPattern) {
    case 'STANDARD_DAY': {
      if (isWeekend) return false;
      // 08:00 to 17:00
      return hour >= 8 && hour < 17;
    }

    case 'TWO_SHIFT': {
      // 06:00 to 22:00 daily
      return hour >= 6 && hour < 22;
    }

    default:
      return true;
  }
}
