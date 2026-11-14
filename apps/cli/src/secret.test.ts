import { Keypair } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { SECRET_ENV, readKeypair } from './secret.js';

describe('readKeypair', () => {
  it('reads a valid secret key from the environment', () => {
    const pair = Keypair.random();
    const read = readKeypair({ [SECRET_ENV]: pair.secret() });
    expect(read.publicKey()).toBe(pair.publicKey());
  });

  it('ignores spaces around the key', () => {
    const pair = Keypair.random();
    expect(readKeypair({ [SECRET_ENV]: `  ${pair.secret()}\n` }).publicKey()).toBe(pair.publicKey());
  });

  it('explains what to do when the variable is missing or empty', () => {
    expect(() => readKeypair({})).toThrow(SECRET_ENV);
    expect(() => readKeypair({ [SECRET_ENV]: '   ' })).toThrow(SECRET_ENV);
  });

  it('never shows the value of a bad key', () => {
    const typo = `${Keypair.random().secret().slice(0, 30)}XXXX`;
    let message = '';
    try {
      readKeypair({ [SECRET_ENV]: typo });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('not a valid secret key');
    expect(message).not.toContain(typo.slice(0, 12));
  });
});
