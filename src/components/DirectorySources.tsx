/**
 * Where the relay list came from, and why the sweep is smaller than it.
 *
 * The relay count is the number this whole tool rests on: "970 relays carry
 * your data" means nothing without "out of how many, found how". Left
 * unattributed it is a number the user has to take on faith, and the two
 * questions that follow — *which* monitors, and where did the other three
 * hundred relays go — have concrete answers that were already being collected
 * and thrown away.
 *
 * So this panel says all of it: every monitor queried, what each returned,
 * which ones failed, and each exclusion counted by the reason that excluded
 * it.
 */
import {
  DISCOVERY_LIMIT,
  DISCOVERY_MAX_PAGES,
  DISCOVERY_RELAYS,
  DISCOVERY_STALE_AFTER_S,
  RELAY_DISCOVERY_KIND,
} from '@/config/sweep';
import { since } from '@/lib/format';
import type { Directory, SelectionBreakdown } from '@/services/discovery/directory';
import { Badge } from '@/components/ui/Badge';
import { tooltipHandlers } from '@/components/ui/tooltip-handlers';
import { RelayLink } from '@/components/ui/RelayLink';

/**
 * Exact, not abbreviated. Everywhere else `1.6k` is right — a thousand rows
 * are read as a shape. Here the whole job is making two numbers reconcile, and
 * `1.6k − 29 − 212 = 1.3k` does not.
 */
function exact(value: number): string {
  return value.toLocaleString('en-US');
}

function Row({ label, value, tone }: { label: React.ReactNode; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-md py-0.5">
      <span className="min-w-0 truncate text-sm text-ink-secondary">{label}</span>
      <span className={`shrink-0 font-mono text-sm ${tone ?? 'text-ink-primary'}`}>{value}</span>
    </div>
  );
}

export function DirectorySources({
  directory,
  breakdown,
  loading,
}: {
  directory: Directory | null;
  breakdown: SelectionBreakdown;
  loading: boolean;
}) {
  const staleHours = Math.round(DISCOVERY_STALE_AFTER_S / 3600);

  return (
    <div className="w-full rounded-lg border border-surface-border bg-surface-card p-lg shadow-2xl md:w-[420px]">
      <h3 className="text-base font-semibold text-ink-primary">Where these relays come from</h3>
      <p className="mt-xs text-sm text-ink-secondary">
        Nobody keeps an official list of Nostr relays. Volunteers run{' '}
        <span
          className="underline decoration-dotted underline-offset-2"
          {...tooltipHandlers({
            title: 'trackers',
            lines: ['Known in the protocol as NIP-66 relay monitors, publishing event kind 30166.'],
          })}
        >
          trackers
        </span>{' '}
        that constantly test relays and publish what they find — each relay&rsquo;s address, whether
        it wants you signed in or paid, and how quickly it responded. This app reads those reports
        from the trackers below and merges them.
      </p>

      <h4 className="mt-lg text-xs uppercase tracking-wide text-ink-muted">Trackers asked</h4>
      <div className="mt-xs">
        {(directory?.sources.length ?? 0) === 0
          ? DISCOVERY_RELAYS.map((relay) => (
              <Row
                key={relay}
                label={<RelayLink url={relay} className="text-sm" />}
                value={loading ? 'asking…' : '—'}
                tone="text-ink-muted"
              />
            ))
          : directory?.sources.map((source) => (
              <Row
                key={source.relay}
                label={<RelayLink url={source.relay} className="text-sm" />}
                value={
                  source.error === null
                    ? `${exact(source.events)} reports`
                    : `failed: ${source.error}`
                }
                tone={source.error === null ? 'text-ink-primary' : 'text-state-error'}
              />
            ))}
      </div>
      <p className="mt-xs text-xs text-ink-muted">
        These are reports, not relays: around thirty trackers each publish one report per relay, so
        the numbers overlap heavily. That is deliberate — one tracker going quiet must not empty the
        list.
      </p>

      <h4 className="mt-lg text-xs uppercase tracking-wide text-ink-muted">
        Exactly what is asked
      </h4>
      <pre className="mt-xs overflow-x-auto rounded-md bg-surface-base p-sm font-mono text-xs text-ink-secondary">
        {`["REQ","d",{"kinds":[${RELAY_DISCOVERY_KIND}],"limit":${DISCOVERY_LIMIT}}]`}
      </pre>
      <p className="mt-xs text-xs text-ink-muted">
        Asked in up to {DISCOVERY_MAX_PAGES} batches per tracker, working backwards in time: a
        single request comes back full and silently short by hundreds of relays.
      </p>

      <h4 className="mt-lg text-xs uppercase tracking-wide text-ink-muted">What that adds up to</h4>
      <div className="mt-xs">
        <Row label="relays found in total" value={exact(breakdown.total)} />
        {breakdown.pasted > 0 && <Row label="added by you" value={exact(breakdown.pasted)} />}
        {breakdown.darknet > 0 && (
          <Row
            label="skipped — hidden network (Tor, i2p)"
            value={`−${exact(breakdown.darknet)}`}
            tone="text-ink-muted"
          />
        )}
        {breakdown.stale > 0 && (
          <Row
            label={`skipped — looked dead for ${staleHours}h`}
            value={`−${exact(breakdown.stale)}`}
            tone="text-ink-muted"
          />
        )}
        <div className="mt-xs border-t border-surface-border pt-xs">
          <Row
            label="will be checked"
            value={exact(breakdown.selected)}
            tone="text-brand-primary"
          />
        </div>
      </div>

      <p className="mt-lg text-xs text-ink-muted">
        {directory === null
          ? 'Nothing fetched yet.'
          : directory.fromCache
            ? 'No tracker answered, so this is the last saved copy.'
            : `Fetched ${since(directory.fetchedAt / 1000)}.`}{' '}
        Both skips can be switched off under Options.
      </p>

      {directory?.fromCache === true && (
        <p className="mt-sm">
          <Badge tone="warning">cached</Badge>
        </p>
      )}
    </div>
  );
}
