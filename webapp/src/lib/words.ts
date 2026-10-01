// Word counts the way essay limits count them: words and numbers, with
// hyphenated and apostrophe'd words as one. Formulas are not text, so they
// never count.

const WORD = /[\p{L}\p{N}]+(?:['’\-‐][\p{L}\p{N}]+)*/gu;

export const countWords = (text: string): number => text.match(WORD)?.length ?? 0;

export const formatCount = (n: number) => n.toLocaleString("en-GB");
