import { describe, expect, it } from 'vitest';
import { modelConfigFromEnv } from './model.js';

describe('modelConfigFromEnv', () => {
  it('reads the model ID and region', () => {
    expect(
      modelConfigFromEnv({ MODEL_ID: 'global.amazon.nova-2-lite-v1:0', AWS_REGION: 'us-west-2' }),
    ).toEqual({ region: 'us-west-2', modelId: 'global.amazon.nova-2-lite-v1:0' });
  });

  it('defaults the region to ap-southeast-2', () => {
    expect(modelConfigFromEnv({ MODEL_ID: 'm' }).region).toBe('ap-southeast-2');
  });

  it('fails fast when MODEL_ID is missing, rather than silently picking a model', () => {
    expect(() => modelConfigFromEnv({})).toThrow('MODEL_ID is not set');
  });
});
