import { describe, expect, it } from 'vitest';
import { PHASES } from './index.js';

describe('PHASES', () => {
  it('lists the Game phases in order', () => {
    expect(PHASES).toEqual(['LOBBY', 'QUESTION_OPEN', 'REVEAL', 'FINISHED']);
  });
});
