import { describe, expect, it } from 'vitest';
import {
  buildAutocompletePrompt,
  extractWordContext,
  sanitizeAndValidateCompletion,
  setAutocompleteSettings
} from '../electron/autocomplete';
import { DEFAULT_AUTOCOMPLETE_SETTINGS } from '../electron/autocompleteSettings';

describe('buildAutocompletePrompt', () => {
  it('injects left, partial, and right context', () => {
    setAutocompleteSettings(DEFAULT_AUTOCOMPLETE_SETTINGS);
    const prompt = buildAutocompletePrompt('Man went too fto go too far', 14);
    expect(prompt).toContain('Current partial word: f');
    expect(prompt).toContain('Right context: to go too far');
  });
});

describe('extractWordContext', () => {
  it('extracts partial word and right remainder around cursor', () => {
    const context = extractWordContext('hello wor|ld'.replace('|', ''), 9);
    expect(context.partialWord).toBe('wor');
    expect(context.rightWordRemainder).toBe('ld');
  });
});

describe('sanitizeAndValidateCompletion', () => {
  it('keeps only valid word remainder in word mode', () => {
    const context = extractWordContext('Man went too f', 14);
    const completion = sanitizeAndValidateCompletion('far away', context, 'word');
    expect(completion).toBe('ar');
  });

  it('rejects mismatched nonsense in word mode', () => {
    const context = extractWordContext('Man went too f', 14);
    const completion = sanitizeAndValidateCompletion('to go too soon', context, 'word');
    expect(completion).toBe('');
  });

  it('finds a later valid token when first token is partial echo', () => {
    const context = extractWordContext('Man went too fto go too far', 14);
    const completion = sanitizeAndValidateCompletion('f to go too far', context, 'word');
    expect(completion).toBe('ar');
  });

  it('rejects completions that repeat the previous full word', () => {
    const context = extractWordContext('very v', 6);
    const completion = sanitizeAndValidateCompletion('very', context, 'word');
    expect(completion).toBe('');
  });
});
