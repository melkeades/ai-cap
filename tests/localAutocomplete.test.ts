import { describe, expect, it } from 'vitest';
import { suggestLocalCompletion } from '../src/lib/localAutocomplete';

describe('suggestLocalCompletion', () => {
  it('completes a partial word from local corpus', () => {
    const completion = suggestLocalCompletion({
      texts: ['man went too far', 'too fast to fail', 'run far away'],
      text: 'man went too f',
      cursorIndex: 'man went too f'.length,
      mode: 'word'
    });

    expect(completion).toBe('ar');
  });

  it('returns empty for phrase mode local fallback', () => {
    const completion = suggestLocalCompletion({
      texts: ['man went too far'],
      text: 'man went too f',
      cursorIndex: 'man went too f'.length,
      mode: 'phrase'
    });

    expect(completion).toBe('');
  });

  it('returns empty in word mode when no partial word exists', () => {
    const completion = suggestLocalCompletion({
      texts: ['man went too far'],
      text: 'man went too ',
      cursorIndex: 'man went too '.length,
      mode: 'word'
    });

    expect(completion).toBe('');
  });

  it('does not suggest the immediate right-side join token remainder', () => {
    const completion = suggestLocalCompletion({
      texts: ['Man went too fto go too far'],
      text: 'Man went too fto go too far',
      cursorIndex: 'Man went too f'.length,
      mode: 'word'
    });

    expect(completion).not.toBe('to');
  });

  it('does not suggest exact previous word repetition', () => {
    const completion = suggestLocalCompletion({
      texts: ['very very fast'],
      text: 'very v',
      cursorIndex: 'very v'.length,
      mode: 'word'
    });

    expect(completion).not.toBe('ery');
  });
});
