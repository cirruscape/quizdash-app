import { describe, expect, it } from 'vitest';
import { jobMetrics } from './job-metrics.js';

describe('jobMetrics', () => {
  it('counts one outcome as a CloudWatch embedded metric, per environment', () => {
    expect(jobMetrics('FAILED', 'prod', 1_800_000_000_000)).toEqual({
      _aws: {
        Timestamp: 1_800_000_000_000,
        CloudWatchMetrics: [
          {
            Namespace: 'QuizApp',
            Dimensions: [['Env']],
            Metrics: [
              { Name: 'GenerationSucceeded', Unit: 'Count' },
              { Name: 'GenerationFailed', Unit: 'Count' },
              { Name: 'GenerationRefused', Unit: 'Count' },
            ],
          },
        ],
      },
      Env: 'prod',
      GenerationSucceeded: 0,
      GenerationFailed: 1,
      GenerationRefused: 0,
    });
  });

  it('records nothing for a skipped job', () => {
    expect(jobMetrics('SKIPPED', 'prod', 0)).toBeNull();
  });
});
