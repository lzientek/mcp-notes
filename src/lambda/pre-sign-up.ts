import type { PreSignUpTriggerEvent, PreSignUpTriggerHandler } from 'aws-lambda';

/**
 * Cognito PreSignUp Lambda trigger.
 * Auto-confirms user and auto-verifies email to remove friction
 * for a personal single-user tool.
 */
export const handler: PreSignUpTriggerHandler = async (
  event: PreSignUpTriggerEvent,
) => {
  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = true;
  return event;
};
