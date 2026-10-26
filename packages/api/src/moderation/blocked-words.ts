// The maintained blocklist (FR-5.4, D12): changing it means a deploy. Matching is by substring
// after undoing disguises (blocklist.ts), so each word must be one that doesn't turn up inside
// ordinary names. That's why some obvious words are missing ("ass" is in "Cassie", "cock" in
// "Hancock", "arse" in "Arsenal", "rape" in "grape", "shit" in the given name "Shitij");
// Comprehend's toxicity check covers those.
// blocklist.test.ts checks this list against common names.
export const BLOCKED_WORDS: readonly string[] = [
  'fuck',
  'cunt',
  'bitch',
  'whore',
  'slut',
  'wank',
  'twat',
  'bollock',
  'bastard',
  'dildo',
  'pussy',
  'porn',
  'penis',
  'vagina',
  'nigger',
  'nigga',
  'faggot',
  'retard',
  'nazi',
  'hitler',
];
