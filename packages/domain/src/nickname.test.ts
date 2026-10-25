import { describe, expect, it } from 'vitest';
import { normaliseNickname } from './nickname.js';

describe('normaliseNickname', () => {
  it('keeps the Nickname as typed for display, trimmed', () => {
    expect(normaliseNickname('  Quiz Whiz ')).toEqual({
      ok: true,
      display: 'Quiz Whiz',
      key: 'quiz whiz',
    });
  });

  it('gives Nicknames differing only in case or repeated spaces the same key', () => {
    const a = normaliseNickname('Sam  Smith');
    const b = normaliseNickname('sam smith');
    expect(a).toMatchObject({ ok: true, display: 'Sam  Smith', key: 'sam smith' });
    expect(b).toMatchObject({ ok: true, key: 'sam smith' });
  });

  it.each(['Al', 'Sixteen Chars 16', '  Al  '])(
    'accepts %j (2–16 characters once trimmed)',
    (raw) => {
      expect(normaliseNickname(raw).ok).toBe(true);
    },
  );

  it.each([
    ['too short', 'A'],
    ['only spaces', '    '],
    ['too long', 'Seventeen chars!!'.replace(/!/g, 'x')],
    ['punctuation', 'Sam!'],
    ['an emoji', 'Sam 😀'],
    ['non-Latin letters', 'Zoë'],
    ['a tab', 'Sam\tSmith'],
  ])('rejects a Nickname with %s', (_why, raw) => {
    expect(normaliseNickname(raw)).toEqual({ ok: false, error: 'NICKNAME_FORMAT' });
  });
});
