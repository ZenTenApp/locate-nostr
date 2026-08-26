/**
 * What a count cell says when you hover it.
 *
 * Every cell in the grid is a number or a single glyph, and the glyphs are the
 * ones that matter most: `🔒` and `⏱` and `0` mean three very different things
 * and look equally like "nothing here". This is where that difference is
 * spelled out, kept apart from the rendering so the wording can be tested and
 * so the same text can be handed to a screen reader.
 */
import type { KindSpec } from '@/config/kinds';
import type { KindDelta } from '@/services/sweep/diff';
import type { KindResult, KindStatus } from '@/services/sweep/types';
import type { TooltipContent, TooltipTone } from '@/stores/tooltip-store';

/**
 * A refusal, as this app names them: every `KindStatus` that is not `ok`, plus
 * `rejected` — a relay that was reachable and turned the request down, which
 * arrives as `error` with a reason attached and means something quite
 * different from a dropped connection.
 */
export type RefusalKind = Exclude<KindStatus, 'ok'> | 'rejected';

/** Every non-`ok` outcome, said plainly and without blaming the user.
 *
 *  Keyed on the union rather than `string`, so adding a `KindStatus` is a type
 *  error here instead of a cell that silently renders with no explanation. */
const STATUS_COPY: Record<
  RefusalKind,
  { title: (label: string) => string; line: string; tone: TooltipTone }
> = {
  auth: {
    title: (label) => `Won't say — sign-in required (${label})`,
    line: 'This relay only answers people who prove who they are. This app never signs in, so it may well hold your data and simply refuse to admit it.',
    tone: 'warning',
  },
  payment: {
    title: (label) => `Won't say — paid relay (${label})`,
    line: 'This relay only serves paying users. It may hold your data; it will not confirm it to an unpaid reader.',
    tone: 'warning',
  },
  restricted: {
    title: (label) => `Refused the request (${label})`,
    line: 'The relay turned the request down under its own policy.',
    tone: 'warning',
  },
  timeout: {
    title: (label) => `No answer in time (${label})`,
    line: 'The relay went quiet before answering. This is not the same as "nothing here" — the question was never answered at all.',
    tone: 'default',
  },
  error: {
    title: (label) => `Something went wrong (${label})`,
    line: 'The connection broke while asking this relay.',
    tone: 'error',
  },
  /**
   * The relay was there and said no in its own words — measured on the live
   * network: `ERROR: bad req: filter validation failed: kind not allowed`.
   * Reporting that as a broken connection blames the network for a decision
   * the relay made, so it gets its own wording whenever a reason came back.
   */
  rejected: {
    title: (label) => `Relay rejected the question (${label})`,
    line: 'It was reachable and refused to answer this particular request — often because it does not accept this type of event at all.',
    tone: 'error',
  },
};

function plural(count: number, word: string): string {
  return `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * Is this cell a refusal, and which one?
 *
 * The single decision behind both halves of a refusal cell: the glyph the grid
 * draws and the sentence explaining it. They used to be decided independently
 * in two files, so a new case would have shown a number under refusal copy, or
 * a lock with no explanation.
 *
 * A refusal that still produced matching events is not a refusal — whatever
 * the relay said, it answered, and the count wins.
 */
export function refusalOf(result: KindResult): RefusalKind | null {
  if ((result.count ?? 0) > 0) return null;
  if (result.status === 'ok') return null;
  // Reachable and said no in its own words, versus the connection dropping.
  return result.status === 'error' && result.note !== null ? 'rejected' : result.status;
}

/** The cell has not been reached yet in this run. */
export function pendingTooltip(spec: KindSpec): TooltipContent {
  return { title: spec.label, lines: ['Not checked yet.'] };
}

/** The relay never answered at all, so no kind of its own has a result. */
export function unreachableTooltip(spec: KindSpec): TooltipContent {
  return {
    title: `${spec.label} — unknown`,
    lines: ['Could not connect to this relay, so nothing can be said about what it holds.'],
  };
}

export function cellTooltip(
  spec: KindSpec,
  result: KindResult,
  delta: KindDelta | undefined,
): TooltipContent {
  const refusal = refusalOf(result);
  const status = refusal === null ? null : STATUS_COPY[refusal];

  if (status) {
    return {
      title: status.title(spec.label),
      lines: [status.line, ...(result.note !== null ? [`Relay said: "${result.note}"`] : [])],
      tone: status.tone,
    };
  }

  // Answered, not refused, and still no number: the catch-all's sample filled
  // up with kinds that have their own columns, so what is behind them is
  // genuinely unknown. Distinct from zero, and said so.
  if (result.count === null) {
    return {
      title: `${spec.label} — unknown`,
      lines: [
        'The relay answered, but the sample filled up with kinds that have their own columns, so how much else it holds cannot be told from it.',
        'Raise the fetch limit under Options, or open the raw view for this relay to look directly.',
      ],
      tone: 'warning',
    };
  }

  const count = result.count;
  const lines: string[] = [];

  if (count === 0) {
    lines.push(`This relay answered, and holds no ${spec.label.toLowerCase()} for this person.`);
  } else if (result.approx) {
    lines.push(
      `At least ${plural(count, 'item')} — the fetch limit was reached, so there may be more.`,
    );
  } else {
    lines.push(plural(count, 'item'));
  }

  lines.push(
    result.method === 'count'
      ? 'Exact: the relay reported a total.'
      : 'Counted one by one from what the relay sent.',
  );

  if (result.newest) {
    lines.push(
      result.newest.verified === false
        ? 'Warning: the newest one is signed with the wrong key — it is not genuinely from this person.'
        : 'The newest one carries a valid signature.',
    );
  }

  if (result.mismatched > 0) {
    lines.push(
      `${plural(result.mismatched, 'item')} sent back were not what was asked for, so this relay's numbers cannot be trusted.`,
    );
  }

  // The comparison always names the previous value. "+10" alone was read as
  // "ten new items" when the total was ten — true, but only because the last
  // check found none, which is the fact worth stating.
  if (delta?.delta !== undefined && delta.delta !== null && delta.delta !== 0) {
    const before = delta.before ?? 0;
    lines.push(
      before === 0
        ? `The last check found none here — all ${plural(count, 'item')} are new since then.`
        : `${delta.delta > 0 ? '+' : ''}${delta.delta.toLocaleString('en-US')} since the last check (was ${before.toLocaleString('en-US')}).`,
    );
  }

  return {
    title: spec.label,
    lines,
    tone:
      result.mismatched > 0 || result.newest?.verified === false
        ? 'error'
        : result.approx
          ? 'warning'
          : 'default',
  };
}
