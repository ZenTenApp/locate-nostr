/**
 * The five numbers that answer the question without scrolling.
 *
 * `carrying` is the headline: of every relay on the network, how many hold any
 * of this. The rest are there because a headline drawn from a partial or
 * misbehaving sweep would be a lie — unreachable relays are the part of the
 * network this run cannot speak for, and filter-ignoring relays are the part
 * whose numbers are inflated.
 */
import { absoluteTime, compactCount, duration } from '@/lib/format';
import type { SweepTotals } from '@/services/sweep/diff';
import { tooltipHandlers } from '@/components/ui/tooltip-handlers';

function Stat({
  value,
  label,
  tone = 'text-ink-primary',
  title,
}: {
  value: string;
  label: string;
  tone?: string;
  /** Explanation, shown in this app's own tooltip rather than the browser's. */
  title?: string;
}) {
  return (
    <div
      {...(title === undefined ? {} : tooltipHandlers({ title: label, lines: [title] }))}
      className="flex flex-col"
    >
      <span className={`font-mono text-xl ${tone}`}>{value}</span>
      <span className="text-xs uppercase tracking-wide text-ink-muted">{label}</span>
    </div>
  );
}

/** The one line in the corner that says what state the page is in. Early
 *  returns rather than a four-way ternary inside the JSX. */
function StatusLine({
  running,
  progress,
  percent,
  resultsFrom,
  resultsAt,
  elapsedMs,
  complete,
}: {
  running: boolean;
  progress: { done: number; total: number };
  percent: number;
  resultsFrom: 'cache' | 'live' | null;
  resultsAt: number | null;
  elapsedMs: number | null;
  complete: boolean | null;
}) {
  if (running) {
    return (
      <span>
        {progress.done} / {progress.total} · {percent}%
      </span>
    );
  }
  if (resultsFrom === 'cache' && resultsAt !== null) {
    return <span className="text-state-warning">saved · {absoluteTime(resultsAt)}</span>;
  }
  if (elapsedMs !== null && resultsAt !== null) {
    return (
      <span>
        {complete === false ? 'stopped early' : 'checked'} {absoluteTime(resultsAt)} · took{' '}
        {duration(elapsedMs)}
      </span>
    );
  }
  return <span>ready</span>;
}

export function SummaryBar({
  totals,
  progress,
  running,
  elapsedMs,
  resultsFrom,
  resultsAt,
  complete,
}: {
  totals: SweepTotals;
  progress: { done: number; total: number };
  running: boolean;
  elapsedMs: number | null;
  resultsFrom: 'cache' | 'live' | null;
  resultsAt: number | null;
  /** False when the run was stopped early — its numbers are a floor. */
  complete: boolean | null;
}) {
  const percent = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);

  return (
    <section className="border-b border-surface-border bg-surface-base px-lg py-md">
      <div className="grid grid-cols-3 gap-md md:flex md:flex-wrap md:items-end md:gap-xl">
        <Stat
          value={compactCount(totals.carrying)}
          label="relays with data"
          tone="text-brand-primary"
          title="Relays that hold at least one of the things you asked about"
        />
        <Stat
          value={compactCount(totals.events)}
          label="events found"
          title="Added up across relays, so something stored on five relays counts five times. This measures where data lives, not how many separate items exist."
        />
        <Stat
          value={compactCount(totals.answered)}
          label="replied"
          title="Relays that answered at all. Answering “nothing” still counts as replying."
        />
        <Stat
          value={compactCount(totals.unreachable)}
          label="no answer"
          tone={totals.unreachable > 0 ? 'text-ink-muted' : 'text-ink-primary'}
          title="Could not connect. These relays are the part of the network this check cannot speak for — not the same as a relay that answered “nothing”."
        />
        <Stat
          value={compactCount(totals.authGated)}
          label="want you signed in"
          tone={totals.authGated > 0 ? 'text-state-warning' : 'text-ink-primary'}
          title="These relays will not answer unless you prove who you are. This app never signs in, so their numbers are a minimum, not a zero."
        />
        {totals.misbehaving > 0 && (
          <Stat
            value={compactCount(totals.misbehaving)}
            label="gave wrong answers"
            tone="text-state-error"
            title="Sent back things nobody asked for, so their numbers cannot be trusted"
          />
        )}

        <div className="col-span-full text-sm text-ink-muted md:ml-auto md:text-right">
          <StatusLine
            running={running}
            progress={progress}
            percent={percent}
            resultsFrom={resultsFrom}
            resultsAt={resultsAt}
            elapsedMs={elapsedMs}
            complete={complete}
          />
        </div>
      </div>

      {running && (
        <div className="mt-sm h-1 w-full overflow-hidden rounded-full bg-surface-card">
          <div
            className="h-full bg-brand-primary transition-[width] duration-200"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </section>
  );
}
