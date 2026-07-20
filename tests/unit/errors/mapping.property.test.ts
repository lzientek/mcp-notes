import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  UsernameExistsException,
  NotAuthorizedException,
  UserNotFoundException,
  TooManyRequestsException,
  InvalidPasswordException,
  InvalidParameterException,
} from '@aws-sdk/client-cognito-identity-provider';
import { mapCognitoError } from '../../../src/mcp-server/errors/mapper.js';

// All known Cognito exception factories
const cognitoExceptions = [
  () => new UsernameExistsException({ message: 'User already exists', $metadata: {} }),
  () => new NotAuthorizedException({ message: 'Incorrect username or password', $metadata: {} }),
  () => new UserNotFoundException({ message: 'User does not exist', $metadata: {} }),
  () => new TooManyRequestsException({ message: 'Rate exceeded', $metadata: {} }),
  () => new InvalidPasswordException({ message: 'Password too short', $metadata: {} }),
  () => new InvalidParameterException({ message: 'Invalid parameter', $metadata: {} }),
  () => new Error('Unknown network error'),
  () => new Error('Connection timeout'),
  () => ({ name: 'SomeRandomException', message: 'Random error' }),
];

/**
 * Property 5: Error mapping completeness
 * For any Cognito exception type, mapCognitoError returns an object with all three fields:
 * non-empty code, non-empty message, non-empty remedy with actionable instruction.
 *
 * **Validates: Requirements 7.1, 7.2**
 */
describe('Property 5: Error mapping completeness', () => {
  it('every mapped error has non-empty code, message, and remedy', () => {
    // Use oneOf to pick any exception type
    const exceptionArb = fc.constantFrom(...cognitoExceptions).map((factory) => factory());

    fc.assert(
      fc.property(exceptionArb, (error) => {
        const result = mapCognitoError(error);

        expect(result.code).toBeTruthy();
        expect(typeof result.code).toBe('string');
        expect(result.code.length).toBeGreaterThan(0);

        expect(result.message).toBeTruthy();
        expect(typeof result.message).toBe('string');
        expect(result.message.length).toBeGreaterThan(0);

        expect(result.remedy).toBeTruthy();
        expect(typeof result.remedy).toBe('string');
        expect(result.remedy.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 6: Error mapping does not leak credential distinction
 * For NotAuthorizedException (wrong password) and UserNotFoundException (unknown email),
 * the mapped error code is identical (AUTH_INVALID_CREDENTIALS) and message does not
 * reveal which field was wrong.
 *
 * **Validates: Requirements 3.3, 3.4**
 */
describe('Property 6: Error mapping does not leak credential distinction', () => {
  it('NotAuthorizedException and UserNotFoundException produce the same error code', () => {
    const loginFailureArb = fc.constantFrom(
      new NotAuthorizedException({ message: 'Incorrect username or password', $metadata: {} }),
      new UserNotFoundException({ message: 'User does not exist', $metadata: {} }),
    );

    fc.assert(
      fc.property(loginFailureArb, (error) => {
        const result = mapCognitoError(error);
        expect(result.code).toBe('AUTH_INVALID_CREDENTIALS');
      }),
      { numRuns: 100 },
    );
  });

  it('error message does not reveal whether email or password was wrong', () => {
    const loginFailureArb = fc.constantFrom(
      new NotAuthorizedException({ message: 'Incorrect username or password', $metadata: {} }),
      new UserNotFoundException({ message: 'User does not exist', $metadata: {} }),
    );

    const leakingPhrases = [
      'email not found',
      'user not found',
      'unknown email',
      'wrong password',
      'password incorrect',
      'no such user',
      'does not exist',
    ];

    fc.assert(
      fc.property(loginFailureArb, (error) => {
        const result = mapCognitoError(error);
        const messageLower = result.message.toLowerCase();
        for (const phrase of leakingPhrases) {
          expect(messageLower).not.toContain(phrase);
        }
      }),
      { numRuns: 100 },
    );
  });
});
