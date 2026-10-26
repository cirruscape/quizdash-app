import { describe, expect, it } from 'vitest';
import { BLOCKED_WORDS } from './blocked-words.js';
import { createBlocklist } from './blocklist.js';

// Made-up words: these tests are about the matching, not the list itself.
const blocked = createBlocklist(['badword', 'rude']);

describe('blocklist', () => {
  it.each(['badword', 'BadWord', 'xxbadwordxx', 'Bad Word'])('catches %j', (name) => {
    expect(blocked(name)).toBe(true);
  });

  it.each([
    ['leetspeak', 'b4dw0rd'],
    ['symbols for letters', 'b@dw0rd'],
    ['spaced out', 'B 4 D W 0 R D'],
    ['stretched letters', 'baaaddword'],
    ['mixed tricks', 'R U D 3'],
  ])('catches %s: %j', (_how, name) => {
    expect(blocked(name)).toBe(true);
  });

  it.each(['Quiz Whiz', 'Alice', 'Rudolph', 'Bad Wolf'])('lets %j through', (name) => {
    expect(blocked(name)).toBe(false);
  });

  it('accepts the Scunthorpe trade-off: a blocked word inside an innocent one is caught', () => {
    // Agreed in M4: substring matching catches disguised words, at the cost of rare false
    // positives like this, which a Player fixes by choosing another Nickname.
    expect(blocked('prudent')).toBe(true);
  });
});

describe('the real blocklist', () => {
  const real = createBlocklist(BLOCKED_WORDS);

  it.each([
    'Cassie',
    'Thomas',
    'Scott',
    'Hancock',
    'Arsenal fan',
    'Grape',
    'Dickson',
    'Matilda',
    'Shitij',
    'Penelope',
    'Sussex',
    'Quiz Whiz',
  ])('lets the ordinary name %j through', (name) => {
    expect(real(name)).toBe(false);
  });

  it('catches a disguised listed word', () => {
    expect(real('5LUT 4 U')).toBe(true);
  });
});
