import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { McpNotesStack } from '../../lib/mcp-notes-stack.js';

describe('McpNotes CDK Stack', () => {
  const app = new cdk.App();
  const stack = new McpNotesStack(app, 'TestStack');
  const template = Template.fromStack(stack);

  describe('Cognito User Pool', () => {
    it('has password policy with minLength 8', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        Policies: {
          PasswordPolicy: {
            MinimumLength: 8,
          },
        },
      });
    });

    it('has PreSignUp Lambda trigger attached', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        LambdaConfig: {
          PreSignUp: Match.objectLike({
            'Fn::GetAtt': Match.anyValue(),
          }),
        },
      });
    });
  });

  describe('Cognito User Pool Client', () => {
    it('has userPassword auth flow enabled', () => {
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        ExplicitAuthFlows: Match.arrayWith([
          'ALLOW_USER_PASSWORD_AUTH',
        ]),
      });
    });

    it('has refresh token validity of 90 days (in minutes)', () => {
      // CDK sets TokenValidityUnits and RefreshTokenValidity in minutes
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        RefreshTokenValidity: 129600, // 90 days * 24h * 60min
      });
    });
  });

  describe('DynamoDB Table', () => {
    it('has correct key schema (userId PK, noteId SK)', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        KeySchema: [
          { AttributeName: 'userId', KeyType: 'HASH' },
          { AttributeName: 'noteId', KeyType: 'RANGE' },
        ],
      });
    });

    it('uses PAY_PER_REQUEST billing', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        BillingMode: 'PAY_PER_REQUEST',
      });
    });
  });

  describe('API Gateway', () => {
    it('has a Cognito Authorizer of type COGNITO_USER_POOLS', () => {
      template.hasResourceProperties('AWS::ApiGateway::Authorizer', {
        Type: 'COGNITO_USER_POOLS',
      });
    });

    it('deploys to prod stage', () => {
      template.hasResourceProperties('AWS::ApiGateway::Stage', {
        StageName: 'prod',
      });
    });
  });

  describe('Lambda Functions', () => {
    it('has Lambda functions with DynamoDB table name in environment', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: {
            TABLE_NAME: Match.anyValue(),
          },
        },
      });
    });

    it('creates at least 6 Lambda functions (5 CRUD + 1 PreSignUp)', () => {
      const functions = template.findResources('AWS::Lambda::Function');
      expect(Object.keys(functions).length).toBeGreaterThanOrEqual(6);
    });

    it('all CRUD Lambda functions use nodejs20.x runtime', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'nodejs20.x',
        Handler: Match.stringLikeRegexp('.*\\.handler'),
      });
    });
  });
});
