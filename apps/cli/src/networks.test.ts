import type { DiscoverySource, EntryRef, EntryTtl } from '@keepalive/core';
import { Networks, StrKey, type rpc } from '@stellar/stellar-sdk';
import { describe, expect, it, vi } from 'vitest';
import { load } from './index.js';
import {
  networkFor,
  requireTestnetForSending,
  verifyRpcNetwork,
  type RpcNetworkSource,
} from './networks.js';

const TEST_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 7));

function fakeServer(passphrase: string): RpcNetworkSource {
  return {
    getNetwork: vi.fn(async () => ({ passphrase })),
  };
}

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

describe('verifyRpcNetwork', () => {
  it('accepts an RPC server whose passphrase matches --network', async () => {
    await expect(
      verifyRpcNetwork(fakeServer(Networks.TESTNET), networkFor('testnet')),
    ).resolves.toBeUndefined();
    await expect(
      verifyRpcNetwork(fakeServer(Networks.PUBLIC), networkFor('mainnet')),
    ).resolves.toBeUndefined();
  });

  it('refuses a mainnet RPC server when --network is testnet and names both networks', async () => {
    await expect(
      verifyRpcNetwork(fakeServer(Networks.PUBLIC), networkFor('testnet')),
    ).rejects.toThrow('--network is testnet, but the RPC server is on mainnet.');
  });

  it('refuses a testnet RPC server when --network is mainnet and names both networks', async () => {
    await expect(
      verifyRpcNetwork(fakeServer(Networks.TESTNET), networkFor('mainnet')),
    ).rejects.toThrow('--network is mainnet, but the RPC server is on testnet.');
  });

  it('quotes an unrecognized network passphrase clearly on mismatch', async () => {
    await expect(
      verifyRpcNetwork(fakeServer('Standalone Network ; February 2017'), networkFor('testnet')),
    ).rejects.toThrow(
      '--network is testnet, but the RPC server is on "Standalone Network ; February 2017".',
    );
  });
});

describe('load (shared by check and plan)', () => {
  it('stops before discovering or reading any entries when the RPC server is on another network', async () => {
    const discover = vi.fn(async function* (): AsyncIterable<EntryRef> {
      yield { keyXdr: 'AAAA' };
    });
    const createSource = vi.fn((): DiscoverySource => ({ discover }));
    const readEntryTtls = vi.fn(async (): Promise<EntryTtl[]> => []);

    await expect(
      load(
        [TEST_CONTRACT_ID, '--network', 'testnet', '--rpc', 'https://mainnet.example.invalid', '--keys-file', 'keys.txt'],
        {
          createServer: () => fakeServer(Networks.PUBLIC) as unknown as rpc.Server,
          createSource,
          readEntryTtls,
        },
      ),
    ).rejects.toThrow('--network is testnet, but the RPC server is on mainnet.');

    expect(createSource).not.toHaveBeenCalled();
    expect(discover).not.toHaveBeenCalled();
    expect(readEntryTtls).not.toHaveBeenCalled();
  });

  it('discovers and reads entries normally when the RPC server matches --network', async () => {
    const sampleRef: EntryRef = { keyXdr: 'AAAA' };
    const sampleEntry = {
      keyXdr: 'AAAA',
      liveUntilLedger: 50_000,
      ledgersRemaining: 10_000,
      status: 'expiring_soon',
    } as unknown as EntryTtl;

    const discover = vi.fn(async function* (): AsyncIterable<EntryRef> {
      yield sampleRef;
    });
    const createSource = vi.fn((): DiscoverySource => ({ discover }));
    const readEntryTtls = vi.fn(async (): Promise<EntryTtl[]> => [sampleEntry]);
    const server = fakeServer(Networks.TESTNET) as unknown as rpc.Server;

    const loaded = await load(
      [TEST_CONTRACT_ID, '--network', 'testnet', '--keys-file', 'keys.txt'],
      {
        createServer: () => server,
        createSource,
        readEntryTtls,
      },
    );

    expect(loaded.network.name).toBe('testnet');
    expect(loaded.contractId).toBe(TEST_CONTRACT_ID);
    expect(loaded.entries).toEqual([sampleEntry]);
    expect(createSource).toHaveBeenCalledOnce();
    expect(discover).toHaveBeenCalledWith(TEST_CONTRACT_ID);
    expect(readEntryTtls).toHaveBeenCalledOnce();
  });
});
