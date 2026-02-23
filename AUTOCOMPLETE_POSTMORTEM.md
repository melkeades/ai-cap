# Autocomplete Postmortem

## What went wrong

1. Request path was slow by design.
- The app used non-streaming Ollama calls and waited for full completion before showing anything.
- This made trigger time feel random and sometimes very slow.

2. Prompt + token budget were mismatched.
- The prompt asked for strict behavior, but `num_predict` in word mode was too small for stable structured output.
- Small models (especially Qwen 4B) often returned empty/invalid output under those constraints.

3. Repetition and nonsense were not filtered enough.
- Model output could include reasoning artifacts or repeated content.
- Validation did not block all “repeat previous word” cases.

4. Local fallback sometimes reinforced bad suggestions.
- In cursor-join cases (for example `f<cursor>to`), local scoring could suggest the wrong remainder.
- Previous-word repetition could still win locally.

5. Existing saved settings preserved old bad prompt templates.
- Even after code updates, users with persisted legacy templates kept old behavior.

## How it was fixed

1. Switched to streaming + early accept.
- Ollama calls now stream.
- The app parses chunks incrementally and accepts the first valid completion, then cancels the stream.

2. Improved prompt contract for Qwen behavior.
- Prompt now requests a full completed word with few-shot examples.
- System instruction enforces strict JSON output shape (`{"completion":"..."}`).

3. Increased word-mode generation budget.
- `num_predict` default and runtime budget were increased so models can reliably emit valid JSON + word content.

4. Hardened sanitization/validation.
- Strips/ignores think artifacts.
- Rejects malformed output and rejects completion that repeats the previous full word.
- Keeps suffix-aware checks for mid-text edits.

5. Fixed local fallback ranking.
- Local candidate selection now rejects direct previous-word repetition.
- Cursor-join edge cases are filtered more aggressively.

6. Added settings migration safety.
- Legacy persisted prompt templates are detected and auto-migrated to the new default prompt.

7. Verified with tests and live model runs.
- Unit/integration tests updated and passing.
- Manual sentence batch checks with `qwen3:4b` and `qwen3:8b` now return valid completions with low latency.

## Bare minimum autocomplete solution

If we strip this feature to essentials, this is enough:

1. On textarea input (caret only, no selection), debounce ~80-120ms.
2. Call Ollama `/api/chat` with `stream: true` and `format` JSON containing one `completion` field.
3. Parse stream lines; as soon as the buffer yields a valid completion that:
- starts with the typed partial prefix,
- is not identical to the previous full word,
- and is word-safe (`[A-Za-z'-]`),
accept it and cancel the stream.
4. Render as ghost text.
5. `Tab` inserts completion at cursor; `Esc` dismisses.
6. On any cursor move/blur/item switch, clear suggestion.
7. Keep a local fallback (optional) only if it passes the same validator.
