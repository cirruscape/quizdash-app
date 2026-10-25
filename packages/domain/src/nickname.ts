// Nickname rules (FR-5.1, FR-5.2). The toxicity check lives in the API layer (FR-5.3).

export type NicknameResult =
  { ok: true; display: string; key: string } | { ok: false; error: 'NICKNAME_FORMAT' };

/** 2–16 characters of ASCII letters, digits and spaces (PLAN §7). */
const VALID = /^[A-Za-z0-9 ]{2,16}$/;

export function normaliseNickname(raw: string): NicknameResult {
  const display = raw.trim();
  if (!VALID.test(display)) return { ok: false, error: 'NICKNAME_FORMAT' };
  return { ok: true, display, key: display.toLowerCase().replace(/ {2,}/g, ' ') };
}
