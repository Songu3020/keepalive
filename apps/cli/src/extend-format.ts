import type { BatchOutcome, PreparedExtension } from '@keepalive/core';

const STROOPS_PER_XLM = 10_000_000;

export function formatXlm(stroops: number): string {
  return `${(stroops / STROOPS_PER_XLM).toFixed(7)} XLM`;
}

/** What `extend` is about to do. Shown before anything is sent. */
export function formatPrepared(prepared: PreparedExtension, extendTo: number, ceiling: number): string {
  const lines = [
    `Will send ${prepared.transactions.length} transaction(s) to extend ${prepared.entryCount} entries,`,
    `each to at least ${extendTo} ledgers of life.`,
    `Most it can cost: ${prepared.totalMaxFeeStroops} stroops (${formatXlm(prepared.totalMaxFeeStroops)}),`,
    `under your ceiling of ${ceiling} stroops. The real charge is usually lower.`,
  ];
  return lines.join('\n');
}

export function formatOutcomes(outcomes: readonly BatchOutcome[]): string {
  const lines = outcomes.map(
    (o) =>
      `  transaction ${o.index + 1}: ${o.entryCount} entries, charged ${o.feeChargedStroops} stroops, tx ${o.hash}`,
  );
  const total = outcomes.reduce((sum, o) => sum + o.feeChargedStroops, 0);
  return [...lines, `Total charged: ${total} stroops (${formatXlm(total)}).`].join('\n');
}
