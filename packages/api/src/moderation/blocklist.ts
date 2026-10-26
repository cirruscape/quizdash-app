// The Nickname blocklist (FR-5.4): catches obvious words, including disguised ones, that the
// toxicity classifier might miss in very short text. Matching is deliberately broad: a listed
// word anywhere in the Nickname, after undoing common disguises (agreed in M4).

/** Common leetspeak and symbol substitutions, mapped back to letters. */
const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
  '!': 'i',
};

/** Lowercase, undisguised, letters only: "B 4 D W0RD" becomes "badword". */
function letters(text: string): string {
  return [...text.toLowerCase()]
    .map((ch) => LEET[ch] ?? ch)
    .join('')
    .replace(/[^a-z]/g, '');
}

/** The same, with stretched letters collapsed: "baaaddword" becomes "badword". */
function collapsed(text: string): string {
  return text.replace(/(.)\1+/g, '$1');
}

/** True if the Nickname contains a blocked word, however it's disguised. */
export function createBlocklist(words: readonly string[]): (nickname: string) => boolean {
  const blocked = words.map((w) => w.toLowerCase());
  return (nickname) => {
    const plain = letters(nickname);
    const squashed = collapsed(plain);
    // Compare against both forms, so words with doubled letters still match unstretched text.
    return blocked.some((word) => plain.includes(word) || squashed.includes(word));
  };
}
