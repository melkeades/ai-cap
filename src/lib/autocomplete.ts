export interface CompletionInsertion {
  nextText: string;
  nextCursorIndex: number;
}

export function insertCompletionAtCursor(text: string, cursorIndex: number, completion: string): CompletionInsertion {
  const safeCursor = Number.isFinite(cursorIndex) ? Math.max(0, Math.min(text.length, Math.trunc(cursorIndex))) : text.length;
  const nextText = `${text.slice(0, safeCursor)}${completion}${text.slice(safeCursor)}`;
  return {
    nextText,
    nextCursorIndex: safeCursor + completion.length
  };
}
