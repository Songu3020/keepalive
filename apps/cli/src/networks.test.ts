import { Networks } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { networkFor, requireTestnetForSending } from './networks.js';

describe('networkFor', () => {
  it('knows testnet and mainnet', () => {
    expect(networkFor('testnet').passphrase).toBe(Networks.TESTNET);
    expect(networkFor('mainnet').passphrase).toBe(Networks.PUBLIC);
  });

  it('rejects anything else', () => {
    expect(() => networkFor('futurenet')).toThrow('testnet or mainnet');
  });
});

describe('requireTestnetForSending', () => {
  it('allows testnet', () => {
    expect(() => requireTestnetForSending(networkFor('testnet'))).not.toThrow();
  });

  it('refuses mainnet with a clear message', () => {
    expect(() => requireTestnetForSending(networkFor('mainnet'))).toThrow('not supported yet');
  });
});
