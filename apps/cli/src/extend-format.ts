import type { BatchOutcome, PreparedExtension, RestorePlan } from '@keepalive/core';

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

/** What `restore` found: how many archived entries, and why the others were left alone. */
export function formatRestorePlan(contractId: string, plan: RestorePlan): string {
  const toRestore = plan.batches.reduce((sum, batch) => sum + batch.entries.length, 0);
  const lines = [
    `Contract ${contractId}: ${toRestore} archived entries to restore, in ${plan.batches.length} transaction(s).`,
  ];
  const counts = { not_archived: 0, deleted: 0, not_found: 0 };
  for (const { reason } of plan.skipped) counts[reason] += 1;
  const labels: Array<[keyof typeof counts, string]> = [
    ['not_archived', 'not archived (nothing to restore)'],
    ['deleted', 'deleted for good (expired temporary entries cannot be restored)'],
    ['not_found', 'not found'],
  ];
  for (const [reason, label] of labels) {
    if (counts[reason] > 0) lines.push(`  skipped ${counts[reason]}: ${label}`);
  }
  return lines.join('\n');
}

/** What `restore` is about to do. Shown before anything is sent. */
export function formatRestorePrepared(prepared: PreparedExtension, ceiling: number): string {
  return [
    `Will send ${prepared.transactions.length} transaction(s) to restore ${prepared.entryCount} entries.`,
    `Most it can cost: ${prepared.totalMaxFeeStroops} stroops (${formatXlm(prepared.totalMaxFeeStroops)}),`,
    `under your ceiling of ${ceiling} stroops. The real charge is usually lower.`,
  ].join('\n');
}
