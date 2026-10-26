import { ledgerKeyFromContractDataXdr } from './ledger-key.js';
import type { DiscoverySource, EntryRef } from './types.js';

/**
 * Runs one SQL query and returns its rows. The real implementation will wrap
 * the BigQuery client; the tests use a fake. Parameters are named (@name in the SQL)
 * so values never get pasted into the query text.
 */
export interface QueryRunner {
  query(sql: string, params: Record<string, string | number>): Promise<Array<Record<string, unknown>>>;
}

/**
 * Experiment E6: this table is clustered by contract_id, so a lookup for one
 * contract reads about 200 MB. The raw history tables and the TTL join are
 * hundreds of GB. Do not change the table without re-checking the cost.
 */
export const HUBBLE_CONTRACT_DATA_SQL = `
SELECT contract_data_xdr
FROM \`crypto-stellar.crypto_stellar_dbt.contract_data_current\`
WHERE contract_id = @contractId
LIMIT @limit
`.trim();

/** A guard against huge contracts, such as the XLM token with millions of balances. */
export const DEFAULT_ENTRY_LIMIT = 10_000;

export class HubbleSource implements DiscoverySource {
  readonly name = 'hubble' as const;

  constructor(
    private readonly runner: QueryRunner,
    private readonly limit: number = DEFAULT_ENTRY_LIMIT,
  ) {}

  async *discover(contractId: string): AsyncIterable<EntryRef> {
    const rows = await this.runner.query(HUBBLE_CONTRACT_DATA_SQL, {
      contractId,
      limit: this.limit,
    });

    for (const row of rows) {
      const entryXdr = row['contract_data_xdr'];
      if (typeof entryXdr !== 'string') {
        throw new Error(`Hubble row for ${contractId} has no contract_data_xdr`);
      }
      const rebuilt = ledgerKeyFromContractDataXdr(entryXdr);
      yield {
        contractId: rebuilt.contractId,
        kind: rebuilt.kind,
        ledgerKeyXdr: rebuilt.ledgerKeyXdr,
        keyHash: rebuilt.keyHash,
        source: 'hubble',
      };
    }
  }
}