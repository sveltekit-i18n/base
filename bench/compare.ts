// How `run.ts` reads a row of this tree against the same row of its base,
// apart from the run so the suite can pin it. Node runs it as it is.
import type { Kind } from './collect.js';

export type Flag = '' | 'grew, fails' | 'grew, review' | 'shrank' | 'slower, review' | 'faster';

// A time counts as changed only beyond the spread of both sides and by more
// than this share of master's median.
export const THRESHOLD = 0.05;

const sorted = (values: number[]) => [...values].sort((a, b) => a - b);

export const median = (values: number[]) => {
  const ordered = sorted(values);
  const middle = ordered.length >> 1;

  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};

/**
 * The spread of a time's samples: their range once a quarter of them, rounded
 * down, is dropped at each end. A process that shared the machine with a busy
 * neighbour lands at an end, so it cannot widen the spread and hide a change.
 */
export const spreadOf = (values: number[]): [number, number] => {
  const ordered = sorted(values);
  const dropped = ordered.length >> 2;

  return [ordered[dropped], ordered[ordered.length - 1 - dropped]];
};

/** The change from `from` to `to`, as a share of `from`. */
export const change = (from: number, to: number) => (from === 0 ? (to === 0 ? 0 : Infinity) : (to - from) / Math.abs(from));

/** How a row reads, from the samples of both sides. */
export const flagOf = (kind: Kind, master: number[], head: number[]): Flag => {
  const [from, to] = [median(master), median(head)];

  if (kind !== 'time') {
    if (to > from) return kind === 'count' ? 'grew, fails' : 'grew, review';

    return to < from ? 'shrank' : '';
  }

  const share = change(from, to);
  const [[masterLow, masterHigh], [headLow, headHigh]] = [spreadOf(master), spreadOf(head)];

  if (headLow > masterHigh && share >= THRESHOLD) return 'slower, review';

  return headHigh < masterLow && share <= -THRESHOLD ? 'faster' : '';
};
