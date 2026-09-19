import { describe, it, expect } from 'vitest';
import {
  ALL_STATUSES,
  VALID_TRANSITIONS,
  isValidTransition,
  validateTransition,
} from '../src/lifecycle/index.js';
import { IncidentStatus } from '@opslens/contracts';
import { InvalidTransitionError } from '@opslens/platform';

describe('packages/core/src/lifecycle', () => {
  it('defines 10 distinct lifecycle statuses', () => {
    expect(ALL_STATUSES).toHaveLength(10);
    expect(ALL_STATUSES).toEqual(
      expect.arrayContaining([
        'NEW',
        'TRIAGING',
        'ROUTED',
        'ACKNOWLEDGED',
        'IN_PROGRESS',
        'RESOLVED',
        'CLOSED',
        'NEEDS_INFO',
        'MERGED',
        'REOPENED',
      ]),
    );
  });

  describe('Transition Matrix Table Test (100 pairs)', () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const allowedTargets = VALID_TRANSITIONS[from] || [];
        const isAllowed = allowedTargets.includes(to);

        it(`evaluates transition: ${from} -> ${to} (expected: ${isAllowed ? 'LEGAL' : 'ILLEGAL'})`, () => {
          const result = isValidTransition(from, to);
          expect(result).toBe(isAllowed);

          if (isAllowed) {
            expect(() => validateTransition(from, to)).not.toThrow();
          } else {
            expect(() => validateTransition(from, to)).toThrowError(InvalidTransitionError);
            try {
              validateTransition(from, to);
            } catch (err: any) {
              expect(err).toBeInstanceOf(InvalidTransitionError);
              expect(err.code).toBe('INCIDENT_INVALID_TRANSITION');
              expect(err.statusCode).toBe(409);
              expect(err.message).toContain(`Illegal transition from ${from} to ${to}`);
            }
          }
        });
      }
    }
  });

  describe('Specific lifecycle flow verification', () => {
    it('supports the primary happy path: NEW -> TRIAGING -> ROUTED -> ACKNOWLEDGED -> IN_PROGRESS -> RESOLVED -> CLOSED', () => {
      const path: IncidentStatus[] = [
        'NEW',
        'TRIAGING',
        'ROUTED',
        'ACKNOWLEDGED',
        'IN_PROGRESS',
        'RESOLVED',
        'CLOSED',
      ];

      for (let i = 0; i < path.length - 1; i++) {
        const from = path[i]!;
        const to = path[i + 1]!;
        expect(isValidTransition(from, to)).toBe(true);
        expect(() => validateTransition(from, to)).not.toThrow();
      }
    });

    it('supports clarification loop: TRIAGING -> NEEDS_INFO -> TRIAGING', () => {
      expect(isValidTransition('TRIAGING', 'NEEDS_INFO')).toBe(true);
      expect(isValidTransition('NEEDS_INFO', 'TRIAGING')).toBe(true);
    });

    it('supports reopening from RESOLVED and CLOSED: RESOLVED -> REOPENED and CLOSED -> REOPENED', () => {
      expect(isValidTransition('RESOLVED', 'REOPENED')).toBe(true);
      expect(isValidTransition('CLOSED', 'REOPENED')).toBe(true);
    });

    it('allows non-terminal states to transition to MERGED', () => {
      const nonTerminal: IncidentStatus[] = [
        'NEW',
        'TRIAGING',
        'ROUTED',
        'ACKNOWLEDGED',
        'IN_PROGRESS',
        'NEEDS_INFO',
        'REOPENED',
      ];
      for (const s of nonTerminal) {
        expect(isValidTransition(s, 'MERGED')).toBe(true);
      }
    });

    it('enforces MERGED is strictly terminal with 0 outgoing transitions', () => {
      expect(VALID_TRANSITIONS['MERGED']).toHaveLength(0);
      for (const target of ALL_STATUSES) {
        expect(isValidTransition('MERGED', target)).toBe(false);
      }
    });

    it('disallows self-transitions', () => {
      for (const s of ALL_STATUSES) {
        expect(isValidTransition(s, s)).toBe(false);
      }
    });
  });
});
