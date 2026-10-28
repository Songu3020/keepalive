import { describe, expect, it } from 'vitest';
import { getVersion } from './version.js';

describe('getVersion', () => {
  it('reads package.json version dynamically', () => {
    const version = getVersion();
    expect(typeof version).toBe('string');
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
