import { describe, expect, it } from 'vitest';
import { generateJoinCode } from './join-code.js';

// FR-4.3: six uppercase letters and digits, without the look-alikes 0, O, 1 and I.
const SPEC = /^[A-HJ-NP-Z2-9]{6}$/;
const ALLOWED = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

describe('generateJoinCode', () => {
  it('produces six characters from the allowed alphabet, covering all of it', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const code = generateJoinCode(Math.random);
      expect(code).toMatch(SPEC);
      for (const ch of code) seen.add(ch);
    }
    expect([...seen].sort().join('')).toBe([...ALLOWED].sort().join(''));
  });

  it('stays in the alphabet at the extremes of the random source', () => {
    expect(generateJoinCode(() => 0)).toMatch(SPEC);
    expect(generateJoinCode(() => 0.999999999)).toMatch(SPEC);
  });
});
