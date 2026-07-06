// Word-boundary brand/competitor matching, shared by every frontend surface
// that scans response text for names. Substring matching is banned here:
// competitor "DAT" matched the "dat" inside "data"/"update"/"mandate" and
// lit up transcripts + "mentioned instead" lines everywhere. Mirrors the
// backend's word-boundary _mention_matches (services/rvi.py).

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive regex matching any of `names` as whole words (no
 *  alphanumeric neighbors). Names are alternated longest-first so longer
 *  names win over their own substrings. */
export function mentionRegex(names: string[], flags = "gi"): RegExp {
  const pattern = [...names]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join("|");
  return new RegExp(`(?<![A-Za-z0-9])(${pattern})(?![A-Za-z0-9])`, flags);
}

/** Whole-word, case-insensitive "does this text mention this name". */
export function containsMention(text: string, name: string): boolean {
  return mentionRegex([name], "i").test(text);
}
