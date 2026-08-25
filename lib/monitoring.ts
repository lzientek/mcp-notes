import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import type * as apigateway from 'aws-cdk-lib/aws-apigateway';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import type * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';

export interface MonitoringProps {
  api: apigateway.RestApi;
  /** Every application lambda — errors are summed into a single alarm. */
  functions: lambda.IFunction[];
  streamProcessor: lambda.IFunction;
  streamDlq: sqs.IQueue;
  tables: dynamodb.ITable[];
  /**
   * Where alarms and the budget notification are sent. Defaults to the address
   * in lib/config.ts; override it at deploy time with
   * `npx cdk deploy -c alertEmail=someone@example.com`.
   */
  alertEmail: string;
  /** Monthly spend, in USD, above which the budget notifies. */
  monthlyBudgetUsd: number;
}

/** CloudWatch refuses an alarm whose math expression spans more than 10 metrics. */
const MAX_METRICS_PER_ALARM = 10;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Sums one metric across several resources into a single alarm-able metric.
 * idPrefix must be unique within an alarm or a widget: two expressions sharing
 * a metric id in the same place is an error.
 */
function sumOf(
  idPrefix: string,
  label: string,
  metrics: cloudwatch.IMetric[],
): cloudwatch.IMetric {
  const usingMetrics = Object.fromEntries(
    metrics.map((metric, i) => [`${idPrefix}${i}`, metric]),
  );
  return new cloudwatch.MathExpression({
    expression: metrics.map((_, i) => `${idPrefix}${i}`).join('+'),
    usingMetrics,
    label,
    period: cdk.Duration.minutes(5),
  });
}

/**
 * Five alarms and one dashboard — deliberately under the ten alarms and three
 * dashboards that stay free, which is why lambda errors and table throttles are
 * each summed into one alarm rather than split per resource.
 */
export function addMonitoring(scope: Construct, props: MonitoringProps): void {
  const topic = new sns.Topic(scope, 'AlarmTopic', {
    displayName: 'mcp-notes alarms',
  });
  topic.addSubscription(new subscriptions.EmailSubscription(props.alertEmail));

  const alarm = (
    id: string,
    metric: cloudwatch.IMetric,
    threshold: number,
    alarmDescription: string,
    evaluationPeriods = 1,
  ): cloudwatch.Alarm => {
    const created = new cloudwatch.Alarm(scope, id, {
      metric,
      threshold,
      evaluationPeriods,
      alarmDescription,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    created.addAlarmAction(new actions.SnsAction(topic));
    return created;
  };

  const tableThrottles = sumOf(
    'throttle',
    'DynamoDB throttled requests',
    props.tables.map(
      (table) =>
        new cloudwatch.Metric({
          namespace: 'AWS/DynamoDB',
          metricName: 'ThrottledRequests',
          dimensionsMap: { TableName: table.tableName },
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
        }),
    ),
  );

  const apiServerErrors = props.api.metricServerError({
    period: cdk.Duration.minutes(5),
  });

  const dlqDepth = props.streamDlq.metricApproximateNumberOfMessagesVisible({
    period: cdk.Duration.minutes(5),
  });

  // A stalled shard shows up here long before anyone notices missing activity.
  const iteratorAge = props.streamProcessor.metric('IteratorAge', {
    statistic: 'Maximum',
    period: cdk.Duration.minutes(5),
  });

  // One alarm per group of ten functions — the metric cap above, not a choice.
  const errorGroups = chunk(props.functions, MAX_METRICS_PER_ALARM);
  errorGroups.forEach((group, i) => {
    const suffix = errorGroups.length > 1 ? String(i + 1) : '';
    alarm(
      `LambdaErrorsAlarm${suffix}`,
      sumOf(
        `err${i}g`,
        `Lambda errors ${i + 1}`,
        group.map((fn) => fn.metricErrors({ period: cdk.Duration.minutes(5) })),
      ),
      5,
      'Lambdas are failing',
      2,
    );
  });
  alarm('ApiServerErrorsAlarm', apiServerErrors, 5, 'API Gateway is returning 5xx', 2);
  alarm('TableThrottlesAlarm', tableThrottles, 1, 'DynamoDB is throttling requests');
  alarm('StreamDlqAlarm', dlqDepth, 1, 'Activity stream batches landed in the DLQ');
  alarm(
    'StreamIteratorAgeAlarm',
    iteratorAge,
    15 * 60 * 1000, // 15 minutes, in milliseconds
    'The activity stream is falling behind',
  );

  new cloudwatch.Dashboard(scope, 'McpNotesDashboard', {
    dashboardName: 'mcp-notes',
    widgets: [
      [
        new cloudwatch.GraphWidget({
          title: 'API requests and errors',
          left: [props.api.metricCount({ period: cdk.Duration.minutes(5) })],
          right: [
            props.api.metricClientError({ period: cdk.Duration.minutes(5) }),
            apiServerErrors,
          ],
          width: 12,
        }),
        new cloudwatch.GraphWidget({
          title: 'API latency (p50 / p99)',
          left: [
            props.api.metricLatency({ period: cdk.Duration.minutes(5), statistic: 'p50' }),
            props.api.metricLatency({ period: cdk.Duration.minutes(5), statistic: 'p99' }),
          ],
          width: 12,
        }),
      ],
      [
        new cloudwatch.GraphWidget({
          title: 'Lambda errors and throttles',
          left: [
            sumOf(
              'dasherr',
              'Lambda errors',
              props.functions.map((fn) =>
                fn.metricErrors({ period: cdk.Duration.minutes(5) }),
              ),
            ),
          ],
          right: [
            sumOf(
              'dashthr',
              'Lambda throttles',
              props.functions.map((fn) =>
                fn.metricThrottles({ period: cdk.Duration.minutes(5) }),
              ),
            ),
          ],
          width: 12,
        }),
        new cloudwatch.GraphWidget({
          title: 'Activity stream health',
          left: [iteratorAge],
          right: [dlqDepth],
          width: 12,
        }),
      ],
      [
        new cloudwatch.GraphWidget({
          title: 'DynamoDB consumed capacity',
          left: props.tables.map((table) =>
            table.metricConsumedReadCapacityUnits({ period: cdk.Duration.minutes(5) }),
          ),
          right: props.tables.map((table) =>
            table.metricConsumedWriteCapacityUnits({ period: cdk.Duration.minutes(5) }),
          ),
          width: 24,
        }),
      ],
    ],
  });

  // The first two budgets are free.
  new budgets.CfnBudget(scope, 'MonthlyBudget', {
    budget: {
      budgetName: 'mcp-notes-monthly',
      budgetType: 'COST',
      timeUnit: 'MONTHLY',
      budgetLimit: { amount: props.monthlyBudgetUsd, unit: 'USD' },
    },
    notificationsWithSubscribers: [
      {
        notification: {
          notificationType: 'FORECASTED',
          comparisonOperator: 'GREATER_THAN',
          threshold: 100,
          thresholdType: 'PERCENTAGE',
        },
        subscribers: [{ subscriptionType: 'EMAIL', address: props.alertEmail }],
      },
    ],
  });
}
