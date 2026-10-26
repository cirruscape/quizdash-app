// Generation outcomes as CloudWatch Embedded Metric Format: a JSON log line that CloudWatch turns
// into metrics, with no SDK call or extra permission. The ops stack alarms on the failure rate (M5).
import type { JobOutcome } from '../service/quiz-service.js';

const METRICS = ['GenerationSucceeded', 'GenerationFailed', 'GenerationRefused'] as const;
const COUNTED: Record<Exclude<JobOutcome, 'SKIPPED'>, (typeof METRICS)[number]> = {
  SUCCEEDED: 'GenerationSucceeded',
  FAILED: 'GenerationFailed',
  REFUSED: 'GenerationRefused',
};

/** One job's outcome as an embedded metric, or null for a skipped job, which isn't counted. */
export function jobMetrics(outcome: JobOutcome, env: string, now: number): object | null {
  if (outcome === 'SKIPPED') return null;
  const counted = COUNTED[outcome];
  return {
    _aws: {
      Timestamp: now,
      CloudWatchMetrics: [
        {
          Namespace: 'QuizApp',
          Dimensions: [['Env']],
          Metrics: METRICS.map((Name) => ({ Name, Unit: 'Count' })),
        },
      ],
    },
    Env: env,
    ...Object.fromEntries(METRICS.map((name) => [name, name === counted ? 1 : 0])),
  };
}
