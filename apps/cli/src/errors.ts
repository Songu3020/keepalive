function gb(bytes: number): string {
  return (bytes / 1e9).toFixed(1);
}

/**
 * Turns BigQuery's "bytes billed" refusal into a message a person can act on.
 * Any other error is passed through unchanged.
 */
export function explainBigQueryError(error: unknown, maxBytesBilled: number): Error {
  const message = error instanceof Error ? error.message : String(error);
  const match = /Query exceeded limit for bytes billed: \d+\. (\d+) or higher required/.exec(message);
  if (match?.[1] !== undefined) {
    return new Error(
      `Hubble query refused: it needs about ${gb(Number(match[1]))} GB but the limit is ` +
        `${gb(maxBytesBilled)} GB (--max-gb). Nothing was charged. ` +
        'This can happen briefly when Hubble rebuilds a table. Try again later, ' +
        'and only raise --max-gb if you accept spending that much of your monthly allowance.',
    );
  }
  return error instanceof Error ? error : new Error(message);
}