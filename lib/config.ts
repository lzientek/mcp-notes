import type { Node } from 'constructs';

/**
 * Everything that used to be hardcoded in the middle of the stack: the domain,
 * the hosted zone and the two certificates. Kept in one place so a value is
 * changed once, and so a dev deployment can override what it needs.
 */
export interface McpNotesConfig {
  /** Apex domain of the app */
  domainName: string;
  /** Canonical frontend URL, used for share links */
  frontendUrl: string;
  /** Custom domain of the REST API */
  apiDomainName: string;
  hostedZoneId: string;
  /** us-east-1 certificate — CloudFront only accepts certificates from there */
  cloudFrontCertificateArn: string;
  /** Regional certificate for the API Gateway custom domain */
  apiCertificateArn: string;
  /** Origins allowed to call the API, most-canonical first */
  allowedOrigins: string[];
}

const PROD_CONFIG: McpNotesConfig = {
  domainName: 'notlai.com',
  frontendUrl: 'https://www.notlai.com',
  apiDomainName: 'api.notlai.com',
  hostedZoneId: 'Z00190361DHV3BI03ZMC5',
  cloudFrontCertificateArn:
    'arn:aws:acm:us-east-1:171161696369:certificate/c7e5f78a-4a3a-4c3e-bf97-b3c6b99c8d82',
  apiCertificateArn:
    'arn:aws:acm:eu-west-1:171161696369:certificate/ab893409-9541-4092-8ca9-73bad470be95',
  allowedOrigins: ['https://www.notlai.com', 'https://notlai.com'],
};

/**
 * Production config, plus any origins passed through CDK context. Lets a local
 * frontend talk to the deployed API:
 *
 *   npx cdk deploy -c devOrigins=http://localhost:5173
 */
export function resolveConfig(node: Node): McpNotesConfig {
  const devOrigins = node.tryGetContext('devOrigins') as string | undefined;
  if (!devOrigins) return PROD_CONFIG;

  const extra = devOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    ...PROD_CONFIG,
    allowedOrigins: [...PROD_CONFIG.allowedOrigins, ...extra],
  };
}
