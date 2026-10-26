import { BigQuery } from '@google-cloud/bigquery';
import type { QueryRunner } from '@keepalive/core';
import { explainBigQueryError } from './errors.js';

/** Each query may bill at most this many bytes. BigQuery fails it for free beyond that. */
export const DEFAULT_MAX_BYTES_BILLED = 2_000_000_000; // 2 GB

/**
 * Plugs Google BigQuery into the QueryRunner that HubbleSource expects.
 * Logs in through Application Default Credentials: no key file in the project.
 */
export function createBigQueryRunner(
  projectId: string,
  maxBytesBilled: number = DEFAULT_MAX_BYTES_BILLED,
): QueryRunner {
  const client = new BigQuery({ projectId });

  return {
    async query(sql, params) {
      const types: Record<string, string> = {};
      for (const [name, value] of Object.entries(params)) {
        types[name] = typeof value === 'number' ? 'INT64' : 'STRING';
      }
      try {
        const [rows] = await client.query({
          query: sql,
          params,
          types,
          maximumBytesBilled: String(maxBytesBilled),
        });
        return rows as Array<Record<string, unknown>>;
      } catch (error) {
        throw explainBigQueryError(error, maxBytesBilled);
      }
    },
  };
}