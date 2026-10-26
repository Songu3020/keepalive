import type { EntryBand, EntryTtl, ExtendPlan } from '@keepalive/core';

/** About 5 seconds per ledger. The network can change this, so it is only for display. */
export const LEDGERS_PER_DAY = 17_280;

function remainingLedgers(entry: EntryTtl): number | null {
  return entry.liveUntilLedger === null ? null : entry.liveUntilLedger - entry.latestLedger;
}

/** Human text for how long an entry has left: "12.3 days", "5.2 hours", "expired". */
export function formatRemaining(entry: EntryTtl): string {
  const remaining = remainingLedgers(entry);
  if (remaining === null) return 'not found';
  if (remaining < 0) return 'expired';
  const days = remaining / LEDGERS_PER_DAY;
  if (days >= 1) return `${days.toFixed(1)} days`;
  return `${(days * 24).toFixed(1)} hours`;
}

const BAND_ORDER: EntryBand[] = [
  'critical',
  'expiring_soon',
  'archived',
  'deleted',
  'not_found',
  'healthy',
];

export function countByBand(entries: readonly EntryTtl[]): Record<EntryBand, number> {
  const counts: Record<EntryBand, number> = {
    healthy: 0,
    expiring_soon: 0,
    critical: 0,
    archived: 0,
    deleted: 0,
    not_found: 0,
  };
  for (const entry of entries) counts[entry.band] += 1;
  return counts;
}

/** Entries with the least time left come first. Entries with no expiry go last. */
function soonestFirst(a: EntryTtl, b: EntryTtl): number {
  const ra = remainingLedgers(a);
  const rb = remainingLedgers(b);
  if (ra === null && rb === null) return 0;
  if (ra === null) return 1;
  if (rb === null) return -1;
  return ra - rb;
}

export function formatReport(contractId: string, entries: readonly EntryTtl[], show: number): string {
  const lines: string[] = [];
  lines.push(`Contract ${contractId}: ${entries.length} entries`);

  const counts = countByBand(entries);
  for (const band of BAND_ORDER) {
    if (counts[band] > 0) lines.push(`  ${band.padEnd(14)} ${counts[band]}`);
  }
  if (entries.length === 0) return lines.join('\n');

  const latest = entries[0]?.latestLedger;
  lines.push('');
  lines.push(`Soonest to expire (ledger ${latest}):`);
  const rows = [...entries].sort(soonestFirst).slice(0, show);
  for (const entry of rows) {
    lines.push(
      `  ${entry.band.padEnd(14)} ${entry.kind.padEnd(11)} ${formatRemaining(entry).padEnd(12)} ${entry.keyHash.slice(0, 12)}`,
    );
  }
  if (entries.length > rows.length) {
    lines.push(`  ... and ${entries.length - rows.length} more (use --show to see more)`);
  }
  return lines.join('\n');
}


function days(ledgers: number): string {
  return `${(ledgers / LEDGERS_PER_DAY).toFixed(1)} days`;
}

/** Text for `keepalive plan`: what would be extended, and what is left alone. */
export function formatPlan(contractId: string, plan: ExtendPlan, maxEntryTtl: number): string {
  const lines: string[] = [];
  lines.push(`Plan for ${contractId} (dry run: nothing is sent or signed)`);
  lines.push(`Extend to ${plan.extendTo} ledgers (${days(plan.extendTo)}).`);
  if (plan.clamped) {
    lines.push(`  Lowered to fit the network maximum of ${maxEntryTtl} ledgers (${days(maxEntryTtl)}).`);
  }

  const total = plan.batches.reduce((sum, batch) => sum + batch.entries.length, 0);
  if (total === 0) {
    lines.push('Nothing to extend.');
  } else {
    lines.push(`${total} entries to extend, in ${plan.batches.length} transaction(s):`);
    plan.batches.forEach((batch, index) => {
      lines.push(`  transaction ${index + 1}: ${batch.entries.length} entries`);
    });
  }

  const reasons = new Map<string, number>();
  for (const item of plan.skipped) reasons.set(item.reason, (reasons.get(item.reason) ?? 0) + 1);
  if (reasons.size > 0) {
    lines.push('Left alone:');
    for (const [reason, count] of reasons) lines.push(`  ${reason.padEnd(20)} ${count}`);
  }
  if ((reasons.get('needs_restore') ?? 0) > 0) {
    lines.push('Archived entries need a restore before they can be extended.');
  }
  return lines.join('\n');
}