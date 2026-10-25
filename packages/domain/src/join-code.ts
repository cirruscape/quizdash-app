// Join Codes (FR-4.3). Uniqueness among unfinished Games is enforced by the API's storage.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LENGTH = 6;

/** `random` returns a number in [0, 1), like Math.random; injected so callers control it. */
export function generateJoinCode(random: () => number): string {
  let code = '';
  for (let i = 0; i < LENGTH; i++) {
    code += ALPHABET[Math.floor(random() * ALPHABET.length)];
  }
  return code;
}
