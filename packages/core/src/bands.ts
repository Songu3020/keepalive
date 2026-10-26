import type { EntryBand, EntryKind } from './types.js';

export interface Thresholds {
  /** below this many ledgers remaining, the entry is 'expiring_soon' */
  expiringSoon: number;
  /** below this many ledgers remaining, the entry is 'critical' */
  critical: number;
}

export interface ClassifyInput {
  kind: EntryKind;
  liveUntilLedger: number | null;
  latestLedger: number;
  thresholds: Thresholds;
}

/**
 * Stellar docs: an entry is no longer live when current_ledger > liveUntilLedger.
 * Expired temporary entries are deleted. Expired persistent and instance
 * entries are archived and can be restored.
 *
 * Experiment E5 (mainnet): the RPC returned archived persistent entries with a
 * past liveUntilLedger, and left out expired temporary entries, which are
 * deleted for good. So a temporary entry the RPC does not return is 'deleted'.
 * A persistent or instance entry the RPC does not return stays 'not_found',
 * because we cannot tell why it is missing.
 */
export function classifyBand(input: ClassifyInput): EntryBand {
  const { kind, liveUntilLedger, latestLedger, thresholds } = input;

  if (thresholds.critical > thresholds.expiringSoon) {
    throw new RangeError('critical threshold must not exceed expiringSoon');
  }
  if (liveUntilLedger === null) {
    return kind === 'temporary' ? 'deleted' : 'not_found';
  }

  if (latestLedger > liveUntilLedger) {
    return kind === 'temporary' ? 'deleted' : 'archived';
  }

  const remaining = liveUntilLedger - latestLedger;
  if (remaining < thresholds.critical) return 'critical';
  if (remaining < thresholds.expiringSoon) return 'expiring_soon';
  return 'healthy';
}