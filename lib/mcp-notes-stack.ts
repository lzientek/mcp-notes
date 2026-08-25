import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { DynamoEventSource, SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Construct } from 'constructs';
import { resolveConfig } from './config.js';
import { addMonitoring } from './monitoring.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class McpNotesStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly notesTable: dynamodb.Table;
  public readonly tagsTable: dynamodb.Table;
  public readonly sharesTable: dynamodb.Table;
  public readonly foldersTable: dynamodb.Table;
  public readonly activityTable: dynamodb.Table;
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const config = resolveConfig(this.node);

    // Applied to every taggable resource in the stack, for cost attribution.
    cdk.Tags.of(this).add('Project', 'mcp-notes');
    cdk.Tags.of(this).add('Environment', 'prod');
    cdk.Tags.of(this).add('ManagedBy', 'cdk');

    // ─── Cognito User Pool ───────────────────────────────────────────────
    this.userPool = new cognito.UserPool(this, 'McpNotesUserPool', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.NONE,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // User Pool Client: public client (no secret), USER_PASSWORD_AUTH
    this.userPoolClient = this.userPool.addClient('McpNotesClient', {
      authFlows: {
        userPassword: true,
      },
      generateSecret: false,
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(90),
      accessTokenValidity: cdk.Duration.hours(1),
    });

    // ─── Cognito Logging (userNotification errors → CloudWatch) ──────────
    const cognitoLogGroup = new logs.LogGroup(this, 'CognitoUserPoolLogs', {
      logGroupName: `/aws/vendedlogs/cognito/${this.userPool.userPoolId}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const cognitoLogDelivery = new cognito.CfnLogDeliveryConfiguration(this, 'CognitoLogDelivery', {
      userPoolId: this.userPool.userPoolId,
      logConfigurations: [
        {
          eventSource: 'userNotification',
          logLevel: 'ERROR',
          cloudWatchLogsConfiguration: {
            logGroupArn: cdk.Arn.format(
              {
                service: 'logs',
                resource: 'log-group',
                resourceName: `/aws/vendedlogs/cognito/${this.userPool.userPoolId}`,
                arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
              },
              this,
            ),
          },
        },
      ],
    });
    cognitoLogDelivery.node.addDependency(cognitoLogGroup);

    // ─── DynamoDB Notes Table ────────────────────────────────────────────
    this.notesTable = new dynamodb.Table(this, 'McpNotesTable', {
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'noteId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // Lets list-notes page through notes newest-first without reading the whole
    // partition and sorting in memory.
    this.notesTable.addGlobalSecondaryIndex({
      indexName: 'UpdatedAtIndex',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'updatedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ─── DynamoDB Tags Table ─────────────────────────────────────────────
    this.tagsTable = new dynamodb.Table(this, 'McpNotesTagsTable', {
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'tagId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ─── DynamoDB Shares Table ───────────────────────────────────────────
    this.sharesTable = new dynamodb.Table(this, 'McpNotesSharesTable', {
      partitionKey: { name: 'shareId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.sharesTable.addGlobalSecondaryIndex({
      indexName: 'NoteIdIndex',
      partitionKey: { name: 'noteId', type: dynamodb.AttributeType.STRING },
    });

    this.sharesTable.addGlobalSecondaryIndex({
      indexName: 'RecipientEmailIndex',
      partitionKey: { name: 'recipientEmail', type: dynamodb.AttributeType.STRING },
    });

    // ─── DynamoDB Folders Table ──────────────────────────────────────────
    this.foldersTable = new dynamodb.Table(this, 'McpNotesFoldersTable', {
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'folderId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ─── DynamoDB Activity Table ─────────────────────────────────────────
    this.activityTable = new dynamodb.Table(this, 'McpNotesActivityTable', {
      partitionKey: { name: 'noteId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // ─── Lambda Functions (Notes CRUD) ───────────────────────────────────
    const lambdaDir = path.join(__dirname, '..', 'src', 'lambda');

    const allFunctions: NodejsFunction[] = [];

    // Same construct id and scope as before — the logical ids do not move.
    const createFunction = (
      functionId: string,
      entryFile: string,
      description: string,
      environment: Record<string, string> = {},
    ): NodejsFunction => {
      const fn = new NodejsFunction(this, functionId, {
        runtime: lambda.Runtime.NODEJS_22_X,
        entry: path.join(lambdaDir, entryFile),
        handler: 'handler',
        description,
        environment: {
          ALLOWED_ORIGINS: config.allowedOrigins.join(','),
          ...environment,
        },
      });
      allFunctions.push(fn);
      return fn;
    };

    const listNotesFn = createFunction('ListNotesFn', 'list-notes.ts', 'List all notes for the authenticated user', {
        TABLE_NAME: this.notesTable.tableName,
        SHARES_TABLE_NAME: this.sharesTable.tableName,
    });

    const createNoteFn = createFunction('CreateNoteFn', 'create-note.ts', 'Create a new note', {
        TABLE_NAME: this.notesTable.tableName,
        TAGS_TABLE_NAME: this.tagsTable.tableName,
    });

    const getNoteFn = createFunction('GetNoteFn', 'get-note.ts', 'Get a specific note by ID', {
        TABLE_NAME: this.notesTable.tableName,
        SHARES_TABLE_NAME: this.sharesTable.tableName,
    });

    const updateNoteFn = createFunction('UpdateNoteFn', 'update-note.ts', 'Update an existing note', {
        TABLE_NAME: this.notesTable.tableName,
        TAGS_TABLE_NAME: this.tagsTable.tableName,
        SHARES_TABLE_NAME: this.sharesTable.tableName,
    });

    const deleteNoteFn = createFunction('DeleteNoteFn', 'delete-note.ts', 'Delete a note', {
        TABLE_NAME: this.notesTable.tableName,
        SHARES_TABLE_NAME: this.sharesTable.tableName,
    });

    // ─── Lambda Functions (Sharing) ──────────────────────────────────────
    const shareNoteFn = createFunction('ShareNoteFn', 'share-note.ts', 'Create a public link or user share for a note', {
        TABLE_NAME: this.notesTable.tableName,
        SHARES_TABLE_NAME: this.sharesTable.tableName,
      FRONTEND_URL: config.frontendUrl,
    });

    const unshareNoteFn = createFunction('UnshareNoteFn', 'unshare-note.ts', 'Revoke a public link or user share', {
        TABLE_NAME: this.notesTable.tableName,
        SHARES_TABLE_NAME: this.sharesTable.tableName,
    });

    const getSharedNoteFn = createFunction('GetSharedNoteFn', 'get-shared-note.ts', 'Get a shared note by shareId (public, no auth)', {
        TABLE_NAME: this.notesTable.tableName,
        SHARES_TABLE_NAME: this.sharesTable.tableName,
    });

    // ─── Lambda Functions (Tags CRUD) ────────────────────────────────────
    const listTagsFn = createFunction('ListTagsFn', 'list-tags.ts', 'List all tags for the authenticated user', {
        TAGS_TABLE_NAME: this.tagsTable.tableName,
    });

    const createTagFn = createFunction('CreateTagFn', 'create-tag.ts', 'Create a new tag', {
        TAGS_TABLE_NAME: this.tagsTable.tableName,
    });

    const deleteTagFn = createFunction('DeleteTagFn', 'delete-tag.ts', 'Delete a tag and remove it from all notes', {
        TAGS_TABLE_NAME: this.tagsTable.tableName,
        TABLE_NAME: this.notesTable.tableName,
    });

    // ─── Lambda Functions (Folders CRUD) ─────────────────────────────────
    const listFoldersFn = createFunction('ListFoldersFn', 'list-folders.ts', 'List all folders for the authenticated user', {
        FOLDERS_TABLE_NAME: this.foldersTable.tableName,
    });

    const createFolderFn = createFunction('CreateFolderFn', 'create-folder.ts', 'Create a new folder', {
        FOLDERS_TABLE_NAME: this.foldersTable.tableName,
    });

    const deleteFolderFn = createFunction('DeleteFolderFn', 'delete-folder.ts', 'Delete a folder and move notes back to root', {
        FOLDERS_TABLE_NAME: this.foldersTable.tableName,
        TABLE_NAME: this.notesTable.tableName,
    });

    // ─── Lambda Functions (Bulk Operations) ──────────────────────────────
    const bulkDeleteNotesFn = createFunction('BulkDeleteNotesFn', 'bulk-delete-notes.ts', 'Delete multiple notes at once', {
        TABLE_NAME: this.notesTable.tableName,
        SHARES_TABLE_NAME: this.sharesTable.tableName,
    });

    // ─── Lambda Functions (Activity) ─────────────────────────────────────
    const processNoteStreamFn = createFunction('ProcessNoteStreamFn', 'process-note-stream.ts', 'Process DynamoDB Stream events to generate activity log', {
        ACTIVITY_TABLE_NAME: this.activityTable.tableName,
    });

    // Without a failure destination, a batch that keeps failing is retried until
    // the records age out and is then dropped silently — and it blocks the shard
    // meanwhile. Failed batches land here instead.
    const streamDlq = new sqs.Queue(this, 'ProcessNoteStreamDlq', {
      retentionPeriod: cdk.Duration.days(14),
      enforceSSL: true,
    });

    processNoteStreamFn.addEventSource(new DynamoEventSource(this.notesTable, {
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      batchSize: 10,
      retryAttempts: 3,
      // Narrow a failing batch down to the offending record instead of
      // discarding the nine good ones with it.
      bisectBatchOnError: true,
      onFailure: new SqsDlq(streamDlq),
    }));

    streamDlq.grantSendMessages(processNoteStreamFn);

    const listActivityFn = createFunction('ListActivityFn', 'list-activity.ts', 'List activity events for a note', {
        ACTIVITY_TABLE_NAME: this.activityTable.tableName,
        TABLE_NAME: this.notesTable.tableName,
        SHARES_TABLE_NAME: this.sharesTable.tableName,
    });

    const getActivityDiffFn = createFunction('GetActivityDiffFn', 'get-activity-diff.ts', 'Get content diff for a specific activity event', {
        ACTIVITY_TABLE_NAME: this.activityTable.tableName,
        TABLE_NAME: this.notesTable.tableName,
        SHARES_TABLE_NAME: this.sharesTable.tableName,
    });

    // ─── DynamoDB Permissions ────────────────────────────────────────────
    // Notes table
    this.notesTable.grantReadData(listNotesFn);
    this.notesTable.grantReadWriteData(createNoteFn);
    this.notesTable.grantReadData(getNoteFn);
    this.notesTable.grantReadWriteData(updateNoteFn);
    this.notesTable.grantReadWriteData(deleteNoteFn);
    this.notesTable.grantReadWriteData(deleteTagFn);

    // Tags table
    this.tagsTable.grantReadData(listTagsFn);
    this.tagsTable.grantReadWriteData(createTagFn);
    this.tagsTable.grantReadWriteData(deleteTagFn);
    this.tagsTable.grantReadData(createNoteFn);
    this.tagsTable.grantReadData(updateNoteFn);

    // Shares table
    this.sharesTable.grantReadWriteData(shareNoteFn);
    this.sharesTable.grantReadWriteData(unshareNoteFn);
    this.sharesTable.grantReadData(getSharedNoteFn);
    this.sharesTable.grantReadData(listNotesFn);
    this.sharesTable.grantReadData(getNoteFn);
    this.sharesTable.grantReadData(updateNoteFn);
    this.sharesTable.grantReadWriteData(deleteNoteFn);

    // Notes table access for share functions
    this.notesTable.grantReadData(shareNoteFn);
    this.notesTable.grantReadData(unshareNoteFn);
    this.notesTable.grantReadData(getSharedNoteFn);

    // Folders table
    this.foldersTable.grantReadData(listFoldersFn);
    this.foldersTable.grantReadWriteData(createFolderFn);
    this.foldersTable.grantReadWriteData(deleteFolderFn);

    // Notes table access for folder/bulk operations
    this.notesTable.grantReadWriteData(deleteFolderFn);
    this.notesTable.grantReadWriteData(bulkDeleteNotesFn);

    // Shares table access for bulk delete (cascade)
    this.sharesTable.grantReadWriteData(bulkDeleteNotesFn);

    // Activity table
    this.activityTable.grantReadWriteData(processNoteStreamFn);
    this.activityTable.grantReadData(listActivityFn);

    // List activity needs read access to notes and shares for auth check
    this.notesTable.grantReadData(listActivityFn);
    this.sharesTable.grantReadData(listActivityFn);

    // Get activity diff
    this.activityTable.grantReadData(getActivityDiffFn);
    this.notesTable.grantReadData(getActivityDiffFn);
    this.sharesTable.grantReadData(getActivityDiffFn);

    // ─── API Gateway ─────────────────────────────────────────────────────
    this.api = new apigateway.RestApi(this, 'McpNotesApi', {
      restApiName: 'mcp-notes-api',
      deployOptions: { stageName: 'prod' },
      defaultCorsPreflightOptions: {
        allowOrigins: config.allowedOrigins,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      'McpNotesAuthorizer',
      {
        cognitoUserPools: [this.userPool],
      },
    );

    const authorizationOptions: apigateway.MethodOptions = {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    // CORS headers on 4xx gateway responses (authorizer rejections)
    this.api.addGatewayResponse('CorsUnauthorized', {
      type: apigateway.ResponseType.UNAUTHORIZED,
      responseHeaders: {
        'Access-Control-Allow-Origin': `'${config.allowedOrigins[0]}'`,
        'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
      },
    });

    this.api.addGatewayResponse('CorsAccessDenied', {
      type: apigateway.ResponseType.ACCESS_DENIED,
      responseHeaders: {
        'Access-Control-Allow-Origin': `'${config.allowedOrigins[0]}'`,
        'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
      },
    });

    this.api.addGatewayResponse('CorsDefault4xx', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': `'${config.allowedOrigins[0]}'`,
        'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
      },
    });

    // /notes
    const notes = this.api.root.addResource('notes');
    notes.addMethod(
      'GET',
      new apigateway.LambdaIntegration(listNotesFn),
      authorizationOptions,
    );
    notes.addMethod(
      'POST',
      new apigateway.LambdaIntegration(createNoteFn),
      authorizationOptions,
    );

    // /notes/{noteId}
    const singleNote = notes.addResource('{noteId}');
    singleNote.addMethod(
      'GET',
      new apigateway.LambdaIntegration(getNoteFn),
      authorizationOptions,
    );
    singleNote.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(updateNoteFn),
      authorizationOptions,
    );
    singleNote.addMethod(
      'DELETE',
      new apigateway.LambdaIntegration(deleteNoteFn),
      authorizationOptions,
    );

    // /tags
    const tags = this.api.root.addResource('tags');
    tags.addMethod(
      'GET',
      new apigateway.LambdaIntegration(listTagsFn),
      authorizationOptions,
    );
    tags.addMethod(
      'POST',
      new apigateway.LambdaIntegration(createTagFn),
      authorizationOptions,
    );

    // /tags/{tagId}
    const singleTag = tags.addResource('{tagId}');
    singleTag.addMethod(
      'DELETE',
      new apigateway.LambdaIntegration(deleteTagFn),
      authorizationOptions,
    );

    // /folders
    const folders = this.api.root.addResource('folders');
    folders.addMethod(
      'GET',
      new apigateway.LambdaIntegration(listFoldersFn),
      authorizationOptions,
    );
    folders.addMethod(
      'POST',
      new apigateway.LambdaIntegration(createFolderFn),
      authorizationOptions,
    );

    // /folders/{folderId}
    const singleFolder = folders.addResource('{folderId}');
    singleFolder.addMethod(
      'DELETE',
      new apigateway.LambdaIntegration(deleteFolderFn),
      authorizationOptions,
    );

    // /notes/bulk-delete
    const bulkDelete = notes.addResource('bulk-delete');
    bulkDelete.addMethod(
      'POST',
      new apigateway.LambdaIntegration(bulkDeleteNotesFn),
      authorizationOptions,
    );

    // /notes/{noteId}/activity
    const noteActivity = singleNote.addResource('activity');
    noteActivity.addMethod(
      'GET',
      new apigateway.LambdaIntegration(listActivityFn),
      authorizationOptions,
    );

    // /notes/{noteId}/activity/diff
    const noteActivityDiff = noteActivity.addResource('diff');
    noteActivityDiff.addMethod(
      'GET',
      new apigateway.LambdaIntegration(getActivityDiffFn),
      authorizationOptions,
    );

    // /notes/{noteId}/share
    const noteShare = singleNote.addResource('share');
    noteShare.addMethod(
      'POST',
      new apigateway.LambdaIntegration(shareNoteFn),
      authorizationOptions,
    );
    noteShare.addMethod(
      'DELETE',
      new apigateway.LambdaIntegration(unshareNoteFn),
      authorizationOptions,
    );

    // /shared/{shareId} — public, no auth
    const shared = this.api.root.addResource('shared');
    const sharedNote = shared.addResource('{shareId}');
    sharedNote.addMethod(
      'GET',
      new apigateway.LambdaIntegration(getSharedNoteFn),
      // No authorizationOptions — public endpoint
    );

    // ─── DNS & Certificates ────────────────────────────────────────────────
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      'NotlaiZone',
      {
        hostedZoneId: config.hostedZoneId,
        zoneName: config.domainName,
      },
    );

    const cloudfrontCertificate = acm.Certificate.fromCertificateArn(
      this,
      'CloudFrontCert',
      config.cloudFrontCertificateArn,
    );

    const apiCertificate = acm.Certificate.fromCertificateArn(
      this,
      'ApiGatewayCert',
      config.apiCertificateArn,
    );

    // ─── API Gateway Custom Domain ──────────────────────────────────────
    const apiDomainName = new apigateway.DomainName(this, 'ApiDomainName', {
      domainName: config.apiDomainName,
      certificate: apiCertificate,
      endpointType: apigateway.EndpointType.REGIONAL,
      securityPolicy: apigateway.SecurityPolicy.TLS_1_2,
    });

    apiDomainName.addBasePathMapping(this.api);

    // ─── Frontend Hosting (S3 + CloudFront) ──────────────────────────────
    const websiteBucket = new s3.Bucket(this, 'McpNotesFrontendBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [
        {
          // Stale assets are already pruned by BucketDeployment; what lingers
          // otherwise is the debris of interrupted uploads.
          id: 'abort-incomplete-uploads',
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
    });

    // CloudFront Function to redirect bare domain to www
    const redirectFunction = new cloudfront.Function(
      this,
      'RedirectToWwwFunction',
      {
        code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var host = request.headers.host.value;
  if (host === '${config.domainName}') {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        location: { value: '${config.frontendUrl}' + request.uri }
      }
    };
  }
  return request;
}
`),
        functionName: 'mcp-notes-redirect-to-www',
      },
    );

    const distribution = new cloudfront.Distribution(
      this,
      'McpNotesFrontendDist',
      {
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(websiteBucket),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          functionAssociations: [
            {
              function: redirectFunction,
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            },
          ],
        },
        domainNames: [`www.${config.domainName}`, config.domainName],
        certificate: cloudfrontCertificate,
        defaultRootObject: 'index.html',
        errorResponses: [
          {
            httpStatus: 403,
            responsePagePath: '/index.html',
            responseHttpStatus: 200,
          },
          {
            httpStatus: 404,
            responsePagePath: '/index.html',
            responseHttpStatus: 200,
          },
        ],
      },
    );

    new s3deploy.BucketDeployment(this, 'McpNotesFrontendDeploy', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '..', 'dist', 'frontend'))],
      destinationBucket: websiteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // ─── Route53 DNS Records ─────────────────────────────────────────────
    new route53.ARecord(this, 'WwwARecord', {
      zone: hostedZone,
      recordName: `www.${config.domainName}`,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution),
      ),
    });

    new route53.AaaaRecord(this, 'WwwAaaaRecord', {
      zone: hostedZone,
      recordName: `www.${config.domainName}`,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution),
      ),
    });

    new route53.ARecord(this, 'ApexARecord', {
      zone: hostedZone,
      recordName: config.domainName,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution),
      ),
    });

    new route53.AaaaRecord(this, 'ApexAaaaRecord', {
      zone: hostedZone,
      recordName: config.domainName,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution),
      ),
    });

    new route53.ARecord(this, 'ApiARecord', {
      zone: hostedZone,
      recordName: config.apiDomainName,
      target: route53.RecordTarget.fromAlias(
        new targets.ApiGatewayDomain(apiDomainName),
      ),
    });

    new route53.AaaaRecord(this, 'ApiAaaaRecord', {
      zone: hostedZone,
      recordName: config.apiDomainName,
      target: route53.RecordTarget.fromAlias(
        new targets.ApiGatewayDomain(apiDomainName),
      ),
    });

    // ─── Monitoring ──────────────────────────────────────────────────────
    addMonitoring(this, {
      api: this.api,
      functions: allFunctions,
      streamProcessor: processNoteStreamFn,
      streamDlq,
      tables: [
        this.notesTable,
        this.tagsTable,
        this.sharesTable,
        this.foldersTable,
        this.activityTable,
      ],
      ...(config.alertEmail ? { alertEmail: config.alertEmail } : {}),
      monthlyBudgetUsd: config.monthlyBudgetUsd,
    });

    // ─── Outputs ─────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
    });

    new cdk.CfnOutput(this, 'NotesTableName', {
      value: this.notesTable.tableName,
    });

    new cdk.CfnOutput(this, 'TagsTableName', {
      value: this.tagsTable.tableName,
    });

    new cdk.CfnOutput(this, 'SharesTableName', {
      value: this.sharesTable.tableName,
    });

    new cdk.CfnOutput(this, 'FoldersTableName', {
      value: this.foldersTable.tableName,
    });

    new cdk.CfnOutput(this, 'ActivityTableName', {
      value: this.activityTable.tableName,
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: `https://${config.apiDomainName}`,
    });

    new cdk.CfnOutput(this, 'FrontendUrl', {
      value: config.frontendUrl,
    });
  }
}
