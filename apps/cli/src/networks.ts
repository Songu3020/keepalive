import { Networks } from '@stellar/stellar-sdk';

export type NetworkName = 'testnet' | 'mainnet';

export interface NetworkConfig {
  name: NetworkName;
  passphrase: string;
  /** a public RPC from the Stellar docs; --rpc overrides it */
  rpcUrl: string;
}

const NETWORKS: Record<NetworkName, NetworkConfig> = {
  testnet: {
    name: 'testnet',
    passphrase: Networks.TESTNET,
    rpcUrl: 'https://soroban-testnet.stellar.org',
  },
  mainnet: {
    name: 'mainnet',
    passphrase: Networks.PUBLIC,
    rpcUrl: 'https://mainnet.sorobanrpc.com',
  },
};

export function networkFor(name: string): NetworkConfig {
  if (name === 'testnet' || name === 'mainnet') return NETWORKS[name];
  throw new Error(`--network must be testnet or mainnet, got "${name}"`);
}

/** Sending is only allowed on testnet for now. Mainnet needs its own safety review first. */
export function requireTestnetForSending(network: NetworkConfig): void {
  if (network.name !== 'testnet') {
    throw new Error(
      'Sending transactions on mainnet is not supported yet. Use --network testnet. ' +
        '`check` and `plan` still work on mainnet and send nothing.',
    );
  }
}
