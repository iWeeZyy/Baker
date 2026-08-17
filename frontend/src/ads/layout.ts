/**
 * Where ad slots fall inside a list. Pure, so the placement rule lives in the
 * ads module rather than being re-derived by each screen that shows a list.
 */

export type ListRow<T> =
  | { type: 'pair'; key: string; items: T[] }
  | { type: 'ad'; key: string };

export type AdCadence = { first: number; interval: number };

/**
 * Lay a list out as explicit rows of two, with ad rows in between.
 *
 * `numColumns` on a FlatList gives every cell the same width, which a
 * full-width ad cannot use — hence rows built by hand. With `cadence` null the
 * result is the plain two-column grid, unchanged.
 *
 * A slot falls after the `first`-th card, then every `interval` cards, and
 * never after the last row: an ad closing a list separates nothing.
 */
export function buildListRows<T extends { id: string }>(
  items: T[],
  cadence: AdCadence | null,
): ListRow<T>[] {
  const rows: ListRow<T>[] = [];
  // A cadence of 0 would wedge an ad between every card; the server floors
  // these too, but a client-side guard costs nothing and cannot loop.
  const first = cadence ? Math.max(1, Math.floor(cadence.first)) : 0;
  const interval = cadence ? Math.max(1, Math.floor(cadence.interval)) : 0;

  let pair: T[] = [];
  let placed = 0;

  items.forEach((item, i) => {
    pair.push(item);
    const isLastCard = i === items.length - 1;
    if (pair.length < 2 && !isLastCard) return;

    rows.push({ type: 'pair', key: pair.map(p => p.id).join('+'), items: pair });
    pair = [];

    if (!cadence || isLastCard) return;
    if (i + 1 >= first + placed * interval) {
      rows.push({ type: 'ad', key: `ad-${placed}` });
      placed += 1;
    }
  });

  return rows;
}
