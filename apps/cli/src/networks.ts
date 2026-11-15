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

export interface RpcNetworkSource {
  getNetwork(): Promise<{ passphrase: string }>;
}

export function networkNameForPassphrase(passphrase: string): string {
  if (passphrase === Networks.TESTNET) return 'testnet';
  if (passphrase === Networks.PUBLIC) return 'mainnet';
  return JSON.stringify(passphrase);
}

/**
 * Asks the RPC server which Stellar network it is on and refuses to proceed
 * when that differs from `--network`.
 */
export async function verifyRpcNetwork(
  server: RpcNetworkSource,
  expected: NetworkConfig,
): Promise<void> {
  const { passphrase } = await server.getNetwork();
  if (passphrase !== expected.passphrase) {
    const actual = networkNameForPassphrase(passphrase);
    throw new Error(
      `--network is ${expected.name}, but the RPC server is on ${actual}.`,
    );
  }
}
