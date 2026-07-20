#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { McpNotesStack } from '../lib/mcp-notes-stack.js';

const app = new cdk.App();
new McpNotesStack(app, 'McpNotesStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'eu-west-1',
  },
});
