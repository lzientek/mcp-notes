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
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Construct } from 'constructs';

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
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // ─── DynamoDB Tags Table ─────────────────────────────────────────────
    this.tagsTable = new dynamodb.Table(this, 'McpNotesTagsTable', {
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'tagId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ─── DynamoDB Shares Table ───────────────────────────────────────────
    this.sharesTable = new dynamodb.Table(this, 'McpNotesSharesTable', {
      partitionKey: { name: 'shareId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
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

    const listNotesFn = new NodejsFunction(this, 'ListNotesFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(lambdaDir, 'list-notes.ts'),
      handler: 'handler',
      description: 'List all notes for the authenticated user',
      environment: {
        TABLE_NAME: this.notesTable.tableName,
        SHARES_TABLE_NAME: this.sharesTable.tableName,
      },
    });

    const createNoteFn = new NodejsFunction(this, 'CreateNoteFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(lambdaDir, 'create-note.ts'),
      handler: 'handler',
      description: 'Create a new note',
      environment: {
        TABLE_NAME: this.notesTable.tableName,
        TAGS_TABLE_NAME: this.tagsTable.tableName,
      },
    });

    const getNoteFn = new NodejsFunction(this, 'GetNoteFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(lambdaDir, 'get-note.ts'),
      handler: 'handler',
      description: 'Get a specific note by ID',
      environment: {
        TABLE_NAME: this.notesTable.tableName,
        SHARES_TABLE_NAME: this.sharesTable.tableName,
      },
    });

    const updateNoteFn = new NodejsFunction(this, 'UpdateNoteFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(lambdaDir, 'update-note.ts'),
      handler: 'handler',
      description: 'Update an existing note',
      environment: {
        TABLE_NAME: this.notesTable.tableName,
        TAGS_TABLE_NAME: this.tagsTable.tableName,
        SHARES_TABLE_NAME: this.sharesTable.tableName,
      },
    });

    const deleteNoteFn = new NodejsFunction(this, 'DeleteNoteFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(lambdaDir, 'delete-note.ts'),
      handler: 'handler',
      description: 'Delete a note',
      environment: {
        TABLE_NAME: this.notesTable.tableName,
        SHARES_TABLE_NAME: this.sharesTable.tableName,
      },
    });

    // ─── Lambda Functions (Sharing) ──────────────────────────────────────
    const shareNoteFn = new NodejsFunction(this, 'ShareNoteFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(lambdaDir, 'share-note.ts'),
      handler: 'handler',
      description: 'Create a public link or user share for a note',
      environment: {
        TABLE_NAME: this.notesTable.tableName,
        SHARES_TABLE_NAME: this.sharesTable.tableName,
        FRONTEND_URL: 'https://www.notlai.com',
      },
    });

    const unshareNoteFn = new NodejsFunction(this, 'UnshareNoteFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(lambdaDir, 'unshare-note.ts'),
      handler: 'handler',
      description: 'Revoke a public link or user share',
      environment: {
        TABLE_NAME: this.notesTable.tableName,
        SHARES_TABLE_NAME: this.sharesTable.tableName,
      },
    });

    const getSharedNoteFn = new NodejsFunction(this, 'GetSharedNoteFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(lambdaDir, 'get-shared-note.ts'),
      handler: 'handler',
      description: 'Get a shared note by shareId (public, no auth)',
      environment: {
        TABLE_NAME: this.notesTable.tableName,
        SHARES_TABLE_NAME: this.sharesTable.tableName,
      },
    });

    // ─── Lambda Functions (Tags CRUD) ────────────────────────────────────
    const listTagsFn = new NodejsFunction(this, 'ListTagsFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(lambdaDir, 'list-tags.ts'),
      handler: 'handler',
      description: 'List all tags for the authenticated user',
      environment: {
        TAGS_TABLE_NAME: this.tagsTable.tableName,
      },
    });

    const createTagFn = new NodejsFunction(this, 'CreateTagFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(lambdaDir, 'create-tag.ts'),
      handler: 'handler',
      description: 'Create a new tag',
      environment: {
        TAGS_TABLE_NAME: this.tagsTable.tableName,
      },
    });

    const deleteTagFn = new NodejsFunction(this, 'DeleteTagFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(lambdaDir, 'delete-tag.ts'),
      handler: 'handler',
      description: 'Delete a tag and remove it from all notes',
      environment: {
        TAGS_TABLE_NAME: this.tagsTable.tableName,
        TABLE_NAME: this.notesTable.tableName,
      },
    });

    // ─── Lambda Functions (Folders CRUD) ─────────────────────────────────
    const listFoldersFn = new NodejsFunction(this, 'ListFoldersFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(lambdaDir, 'list-folders.ts'),
      handler: 'handler',
      description: 'List all folders for the authenticated user',
      environment: {
        FOLDERS_TABLE_NAME: this.foldersTable.tableName,
      },
    });

    const createFolderFn = new NodejsFunction(this, 'CreateFolderFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(lambdaDir, 'create-folder.ts'),
      handler: 'handler',
      description: 'Create a new folder',
      environment: {
        FOLDERS_TABLE_NAME: this.foldersTable.tableName,
      },
    });

    const deleteFolderFn = new NodejsFunction(this, 'DeleteFolderFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(lambdaDir, 'delete-folder.ts'),
      handler: 'handler',
      description: 'Delete a folder and move notes back to root',
      environment: {
        FOLDERS_TABLE_NAME: this.foldersTable.tableName,
        TABLE_NAME: this.notesTable.tableName,
      },
    });

    // ─── Lambda Functions (Bulk Operations) ──────────────────────────────
    const bulkDeleteNotesFn = new NodejsFunction(this, 'BulkDeleteNotesFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(lambdaDir, 'bulk-delete-notes.ts'),
      handler: 'handler',
      description: 'Delete multiple notes at once',
      environment: {
        TABLE_NAME: this.notesTable.tableName,
        SHARES_TABLE_NAME: this.sharesTable.tableName,
      },
    });

    // ─── Lambda Functions (Activity) ─────────────────────────────────────
    const processNoteStreamFn = new NodejsFunction(this, 'ProcessNoteStreamFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(lambdaDir, 'process-note-stream.ts'),
      handler: 'handler',
      description: 'Process DynamoDB Stream events to generate activity log',
      environment: {
        ACTIVITY_TABLE_NAME: this.activityTable.tableName,
      },
    });

    processNoteStreamFn.addEventSource(new DynamoEventSource(this.notesTable, {
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      batchSize: 10,
      retryAttempts: 3,
    }));

    const listActivityFn = new NodejsFunction(this, 'ListActivityFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(lambdaDir, 'list-activity.ts'),
      handler: 'handler',
      description: 'List activity events for a note',
      environment: {
        ACTIVITY_TABLE_NAME: this.activityTable.tableName,
        TABLE_NAME: this.notesTable.tableName,
        SHARES_TABLE_NAME: this.sharesTable.tableName,
      },
    });

    const getActivityDiffFn = new NodejsFunction(this, 'GetActivityDiffFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(lambdaDir, 'get-activity-diff.ts'),
      handler: 'handler',
      description: 'Get content diff for a specific activity event',
      environment: {
        ACTIVITY_TABLE_NAME: this.activityTable.tableName,
        TABLE_NAME: this.notesTable.tableName,
        SHARES_TABLE_NAME: this.sharesTable.tableName,
      },
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
        allowOrigins: ['https://www.notlai.com', 'https://notlai.com'],
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
        'Access-Control-Allow-Origin': "'https://www.notlai.com'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
      },
    });

    this.api.addGatewayResponse('CorsAccessDenied', {
      type: apigateway.ResponseType.ACCESS_DENIED,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'https://www.notlai.com'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
      },
    });

    this.api.addGatewayResponse('CorsDefault4xx', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'https://www.notlai.com'",
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
        hostedZoneId: 'Z00190361DHV3BI03ZMC5',
        zoneName: 'notlai.com',
      },
    );

    const cloudfrontCertificate = acm.Certificate.fromCertificateArn(
      this,
      'CloudFrontCert',
      'arn:aws:acm:us-east-1:171161696369:certificate/c7e5f78a-4a3a-4c3e-bf97-b3c6b99c8d82',
    );

    const apiCertificate = acm.Certificate.fromCertificateArn(
      this,
      'ApiGatewayCert',
      'arn:aws:acm:eu-west-1:171161696369:certificate/ab893409-9541-4092-8ca9-73bad470be95',
    );

    // ─── API Gateway Custom Domain ──────────────────────────────────────
    const apiDomainName = new apigateway.DomainName(this, 'ApiDomainName', {
      domainName: 'api.notlai.com',
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
  if (host === 'notlai.com') {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        location: { value: 'https://www.notlai.com' + request.uri }
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
        domainNames: ['www.notlai.com', 'notlai.com'],
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
      recordName: 'www.notlai.com',
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution),
      ),
    });

    new route53.AaaaRecord(this, 'WwwAaaaRecord', {
      zone: hostedZone,
      recordName: 'www.notlai.com',
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution),
      ),
    });

    new route53.ARecord(this, 'ApexARecord', {
      zone: hostedZone,
      recordName: 'notlai.com',
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution),
      ),
    });

    new route53.AaaaRecord(this, 'ApexAaaaRecord', {
      zone: hostedZone,
      recordName: 'notlai.com',
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution),
      ),
    });

    new route53.ARecord(this, 'ApiARecord', {
      zone: hostedZone,
      recordName: 'api.notlai.com',
      target: route53.RecordTarget.fromAlias(
        new targets.ApiGatewayDomain(apiDomainName),
      ),
    });

    new route53.AaaaRecord(this, 'ApiAaaaRecord', {
      zone: hostedZone,
      recordName: 'api.notlai.com',
      target: route53.RecordTarget.fromAlias(
        new targets.ApiGatewayDomain(apiDomainName),
      ),
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
      value: 'https://api.notlai.com',
    });

    new cdk.CfnOutput(this, 'FrontendUrl', {
      value: 'https://www.notlai.com',
    });
  }
}
