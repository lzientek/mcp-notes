import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Construct } from 'constructs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class McpNotesStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly notesTable: dynamodb.Table;
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

    // ─── DynamoDB Notes Table ────────────────────────────────────────────
    this.notesTable = new dynamodb.Table(this, 'McpNotesTable', {
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'noteId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ─── Lambda Functions (Notes CRUD) ───────────────────────────────────
    const lambdaCode = lambda.Code.fromAsset(
      path.join(__dirname, '..', 'src', 'lambda'),
    );

    const makeFn = (id: string, handler: string, description: string) =>
      new lambda.Function(this, id, {
        runtime: lambda.Runtime.NODEJS_20_X,
        code: lambdaCode,
        handler,
        description,
        environment: {
          TABLE_NAME: this.notesTable.tableName,
        },
      });

    const listNotesFn = makeFn(
      'ListNotesFn',
      'list-notes.handler',
      'List all notes for the authenticated user',
    );

    const createNoteFn = makeFn(
      'CreateNoteFn',
      'create-note.handler',
      'Create a new note',
    );

    const getNoteFn = makeFn(
      'GetNoteFn',
      'get-note.handler',
      'Get a specific note by ID',
    );

    const updateNoteFn = makeFn(
      'UpdateNoteFn',
      'update-note.handler',
      'Update an existing note',
    );

    const deleteNoteFn = makeFn(
      'DeleteNoteFn',
      'delete-note.handler',
      'Delete a note',
    );

    // Grant DynamoDB permissions
    this.notesTable.grantReadWriteData(listNotesFn);
    this.notesTable.grantReadWriteData(createNoteFn);
    this.notesTable.grantReadWriteData(getNoteFn);
    this.notesTable.grantReadWriteData(updateNoteFn);
    this.notesTable.grantReadWriteData(deleteNoteFn);

    // ─── API Gateway ─────────────────────────────────────────────────────
    this.api = new apigateway.RestApi(this, 'McpNotesApi', {
      restApiName: 'mcp-notes-api',
      deployOptions: { stageName: 'prod' },
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

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: 'https://api.notlai.com',
    });

    new cdk.CfnOutput(this, 'FrontendUrl', {
      value: 'https://www.notlai.com',
    });
  }
}
