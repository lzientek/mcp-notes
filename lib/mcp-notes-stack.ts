import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as path from 'node:path';
import type { Construct } from 'constructs';

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

    // PreSignUp trigger: auto-confirm users, auto-verify email
    const preSignUpFn = new lambda.Function(this, 'PreSignUpFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'pre-sign-up.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'src', 'lambda')),
      description: 'Auto-confirm users and verify email on signup',
    });

    this.userPool.addTrigger(
      cognito.UserPoolOperation.PRE_SIGN_UP,
      preSignUpFn,
    );

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
      value: this.api.url,
    });
  }
}
