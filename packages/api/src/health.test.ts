import { describe, expect, it } from 'vitest';
import { HealthResponse } from '@quizapp/contracts';
import { handler } from './health.js';

describe('health handler', () => {
  it('returns a valid HealthResponse', async () => {
    const result = await handler();
    if (typeof result === 'string') throw new Error('expected a structured result');
    expect(result.statusCode).toBe(200);
    expect(HealthResponse.parse(JSON.parse(result.body ?? ''))).toEqual({
      status: 'ok',
      env: 'local',
    });
  });
});
