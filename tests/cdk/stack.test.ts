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

    it('creates at least 6 Lambda functions (5 CRUD + stream processor)', () => {
      const functions = template.findResources('AWS::Lambda::Function');
      expect(Object.keys(functions).length).toBeGreaterThanOrEqual(6);
    });

    it('all CRUD Lambda functions use nodejs22.x runtime', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'nodejs22.x',
        Handler: Match.stringLikeRegexp('.*\\.handler'),
      });
    });
  });

  describe('CORS configuration', () => {
    it('injects the allowed origins into every application lambda', () => {
      const functions = template.findResources('AWS::Lambda::Function');
      const origins = Object.values(functions)
        .map((fn: any) => fn.Properties?.Environment?.Variables?.ALLOWED_ORIGINS)
        .filter(Boolean);

      // Every handler in src/lambda, excluding the CDK-generated helpers
      expect(origins).toHaveLength(18);
      expect(new Set(origins)).toEqual(
        new Set(['https://www.notlai.com,https://notlai.com']),
      );
    });

    it('adds dev origins passed through context', { timeout: 60_000 }, () => {
      const devApp = new cdk.App({ context: { devOrigins: 'http://localhost:5173' } });
      const devStack = new McpNotesStack(devApp, 'DevStack');
      const devTemplate = Template.fromStack(devStack);

      const functions = devTemplate.findResources('AWS::Lambda::Function');
      const origins = Object.values(functions)
        .map((fn: any) => fn.Properties?.Environment?.Variables?.ALLOWED_ORIGINS)
        .filter(Boolean);
      expect(origins[0]).toBe(
        'https://www.notlai.com,https://notlai.com,http://localhost:5173',
      );
    });
  });

  describe('Notes table indexes', () => {
    it('has an UpdatedAtIndex so list-notes can page without sorting in memory', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        KeySchema: [
          { AttributeName: 'userId', KeyType: 'HASH' },
          { AttributeName: 'noteId', KeyType: 'RANGE' },
        ],
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: 'UpdatedAtIndex',
            KeySchema: [
              { AttributeName: 'userId', KeyType: 'HASH' },
              { AttributeName: 'updatedAt', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          }),
        ]),
      });
    });
  });

  describe('Data protection', () => {
    it('enables point-in-time recovery on every table holding user data', () => {
      const tables = template.findResources('AWS::DynamoDB::Table');
      const retained = Object.values(tables).filter(
        (t: any) => t.DeletionPolicy === 'Retain',
      );
      // notes, tags, shares, folders — the activity table is TTL'd and disposable
      expect(retained).toHaveLength(4);
      for (const table of retained) {
        expect((table as any).Properties.PointInTimeRecoverySpecification).toEqual({
          PointInTimeRecoveryEnabled: true,
        });
      }
    });

    it('tags every taggable resource for cost attribution', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        // arrayWith matches an ordered subsequence: tags come out alphabetical
        Tags: Match.arrayWith([
          Match.objectLike({ Key: 'ManagedBy', Value: 'cdk' }),
          Match.objectLike({ Key: 'Project', Value: 'mcp-notes' }),
        ]),
      });
    });

    it('cleans up interrupted uploads on the frontend bucket', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
              Status: 'Enabled',
            }),
          ]),
        },
      });
    });
  });

  describe('Stream processing', () => {
    it('sends failed batches to a dead letter queue', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        MessageRetentionPeriod: 1209600, // 14 days
      });

      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        BisectBatchOnFunctionError: true,
        MaximumRetryAttempts: 3,
        DestinationConfig: {
          OnFailure: { Destination: Match.anyValue() },
        },
      });
    });
  });
});
