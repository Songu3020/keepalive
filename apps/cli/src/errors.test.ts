import { describe, expect, it } from 'vitest';
import { explainBigQueryError } from './errors.js';

describe('explainBigQueryError', () => {
  it('explains a bytes-billed refusal in gigabytes', () => {
    const raw = new Error(
      'Query exceeded limit for bytes billed: 2000000000. 175386918912 or higher required.',
    );
    const message = explainBigQueryError(raw, 2_000_000_000).message;
    expect(message).toContain('175.4 GB');
    expect(message).toContain('2.0 GB');
    expect(message).toContain('Nothing was charged');
  });

  it('passes other errors through unchanged', () => {
    const raw = new Error('Could not load the default credentials');
    expect(explainBigQueryError(raw, 2_000_000_000)).toBe(raw);
  });

  it('wraps a thrown non-error value', () => {
    expect(explainBigQueryError('boom', 1).message).toBe('boom');
  });
});