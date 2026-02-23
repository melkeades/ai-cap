import type { AutocompleteMode } from '../types';

interface LocalAutocompleteRequest {
  texts: string[];
  text: string;
  cursorIndex: number;
  mode: AutocompleteMode;
}

interface WordStats {
  frequency: Map<string, number>;
  bigrams: Map<string, Map<string, number>>;
}

function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z][a-z'-]*/g);
  return matches ?? [];
}

function isWordChar(char: string): boolean {
  return /[A-Za-z'-]/.test(char);
}

function extractPartial(
  text: string,
  cursorIndex: number
): { partialWord: string; previousWord: string; rightWordRemainder: string } {
  const safeCursor = Number.isFinite(cursorIndex) ? Math.max(0, Math.min(text.length, Math.trunc(cursorIndex))) : text.length;

  let start = safeCursor;
  while (start > 0 && isWordChar(text[start - 1] ?? '')) {
    start -= 1;
  }

  const partialWord = text.slice(start, safeCursor);
  const leftSide = text.slice(0, start);
  const previousWord = tokenize(leftSide).at(-1) ?? '';

  let end = safeCursor;
  while (end < text.length && isWordChar(text[end] ?? '')) {
    end += 1;
  }

  return {
    partialWord,
    previousWord,
    rightWordRemainder: text.slice(safeCursor, end)
  };
}

function buildWordStats(texts: string[]): WordStats {
  const frequency = new Map<string, number>();
  const bigrams = new Map<string, Map<string, number>>();

  for (const text of texts) {
    const words = tokenize(text);

    for (let index = 0; index < words.length; index += 1) {
      const word = words[index] as string;
      frequency.set(word, (frequency.get(word) ?? 0) + 1);

      if (index === 0) {
        continue;
      }

      const previous = words[index - 1] as string;
      const transitions = bigrams.get(previous) ?? new Map<string, number>();
      transitions.set(word, (transitions.get(word) ?? 0) + 1);
      bigrams.set(previous, transitions);
    }
  }

  return { frequency, bigrams };
}

export function suggestLocalCompletion(request: LocalAutocompleteRequest): string {
  if (request.mode !== 'word') {
    return '';
  }

  const { partialWord, previousWord, rightWordRemainder } = extractPartial(request.text, request.cursorIndex);
  if (!partialWord) {
    return '';
  }
  const stats = buildWordStats(request.texts);

  const candidates = new Set<string>();

  const bigramCandidates = stats.bigrams.get(previousWord.toLowerCase());
  if (bigramCandidates) {
    for (const word of bigramCandidates.keys()) {
      candidates.add(word);
    }
  }

  for (const word of stats.frequency.keys()) {
    candidates.add(word);
  }

  const normalizedPartial = partialWord.toLowerCase();
  const ranked = Array.from(candidates)
    .filter((word) => {
      if (!normalizedPartial) {
        return true;
      }

      return word.startsWith(normalizedPartial) && word !== normalizedPartial;
    })
    .filter((word) => word !== previousWord.toLowerCase())
    .filter((word) => {
      const remainder = word.slice(normalizedPartial.length);
      if (!rightWordRemainder) {
        return true;
      }

      return remainder.toLowerCase() !== rightWordRemainder.toLowerCase();
    })
    .map((word) => {
      const freq = stats.frequency.get(word) ?? 0;
      const transition = stats.bigrams.get(previousWord.toLowerCase())?.get(word) ?? 0;
      const repeatPenalty = word === previousWord.toLowerCase() ? 8 : 0;
      return {
        word,
        score: transition * 5 + freq - repeatPenalty
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return a.word.localeCompare(b.word);
    });

  const best = ranked[0]?.word;
  if (!best) {
    return '';
  }

  return best.slice(normalizedPartial.length);
}
