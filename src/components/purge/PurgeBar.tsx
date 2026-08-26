/**
 * The purge bar: what is ticked, what that means, and the way to the
 * confirmation screen.
 *
 * Only visible in purge mode, which is off by default and has to be turned on
 * deliberately — a grid where every row has a delete checkbox is a grid where
 * deleting is one misclick away.
 *
 * The include/exclude switch is the whole reason this bar exists. "Delete it
 * from these three relays" and "delete it from everywhere except my own" are
 * the two things people actually want, and expressing the second as the first
 * means ticking nine hundred boxes — so the ticks mean whichever the switch
 * says, and the count beside it always names the relays that will be written
 * to, never the ticks.
 */
import { KIND_SPECS, kindTag } from '@/config/kinds';
import { compactCount } from '@/lib/format';
import type { RelayDescriptor } from '@/services/discovery/nip66';
import type { TargetMode } from '@/services/purge/targets';
import { resolveTargets } from '@/services/purge/targets';
import { usePurgeStore } from '@/stores/purge-store';
import { Button } from '@/components/ui/Button';
import { tooltipHandlers } from '@/components/ui/tooltip-handlers';

/** The switch, as data: two buttons that differ only by what they say. */
const MODES: { mode: TargetMode; label: string; hint: string }[] = [
  {
    mode: 'only',
    label: 'only ticked',
    hint: 'Purge the relays you tick, and nowhere else.',
  },
  {
    mode: 'except',
    label: 'all except ticked',
    hint: 'Purge every relay in the list below except the ones you tick — for keeping your own relays and clearing the rest.',
  },
];

export function PurgeBar({
  relays,
  hiddenPicks,
  disabled,
  onReview,
}: {
  /** The relays the sweep covers — the list "all except ticked" is measured
   *  against, so the purge can never reach a relay the grid is not showing. */
  relays: readonly RelayDescriptor[];
  /** Ticked relays the filter bar is currently hiding. Shown, because a
   *  selection nobody can see is one nobody can check. */
  hiddenPicks: number;
  /** No identity, or a sweep in flight. */
  disabled: boolean;
  onReview: () => void;
}) {
  const mode = usePurgeStore((state) => state.mode);
  const picked = usePurgeStore((state) => state.picked);
  const kinds = usePurgeStore((state) => state.kinds);
  const setMode = usePurgeStore((state) => state.setMode);
  const toggleKind = usePurgeStore((state) => state.toggleKind);
  const clearPicks = usePurgeStore((state) => state.clearPicks);
  const setPicking = usePurgeStore((state) => state.setPicking);
  // Derived here rather than through a selector: a selector returning a fresh
  // array on every call has no stable snapshot for React to compare, which is
  // an infinite render, not a slow one.
  const targets = resolveTargets(relays, mode, picked);

  return (
    <div className="flex flex-wrap items-center gap-md border-b border-state-error/40 bg-state-error/10 px-lg py-sm">
      <span className="text-sm font-medium text-state-error">Purging</span>

      <div className="flex items-center gap-xs">
        {MODES.map((entry) => (
          <button
            key={entry.mode}
            type="button"
            onClick={() => setMode(entry.mode)}
            {...tooltipHandlers({ title: entry.label, lines: [entry.hint] })}
            className={`rounded-sm border px-sm py-0.5 text-sm transition ${
              mode === entry.mode
                ? 'border-state-error bg-state-error/20 text-ink-primary'
                : 'border-surface-border text-ink-muted hover:text-ink-secondary'
            }`}
          >
            {entry.label}
          </button>
        ))}
        <span className="text-sm text-ink-muted">
          {picked.size} ticked
          {hiddenPicks > 0 && (
            <span
              className="ml-xs text-state-warning"
              {...tooltipHandlers({
                title: 'ticked but not shown',
                lines: [
                  'These relays stay ticked while the filters hide them — ticking is a selection, not a view.',
                  'Clear the filters above to see them, or use clear to start the selection over.',
                ],
              })}
            >
              · {hiddenPicks} hidden by filters
            </span>
          )}
          {picked.size > 0 && (
            <Button variant="ghost" className="px-sm py-0" onClick={clearPicks}>
              clear
            </Button>
          )}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-xs">
        {KIND_SPECS.map((spec) => {
          const on = kinds.includes(spec.kind);
          return (
            <button
              key={spec.kind}
              type="button"
              onClick={() => toggleKind(spec.kind)}
              {...tooltipHandlers({
                title: `purge ${spec.label}`,
                lines: [spec.note, kindTag(spec)],
              })}
              className={`rounded-sm border px-sm py-0.5 text-sm transition ${
                on
                  ? 'border-state-error bg-state-error/20 text-ink-primary'
                  : 'border-surface-border text-ink-muted hover:text-ink-secondary'
              }`}
            >
              {spec.label}
            </button>
          );
        })}
      </div>

      <span className="text-sm text-ink-secondary">
        {compactCount(targets.length)} relay{targets.length === 1 ? '' : 's'} targeted
      </span>

      <div className="ml-auto flex items-center gap-xs">
        <Button
          variant="danger"
          disabled={disabled || targets.length === 0 || kinds.length === 0}
          onClick={onReview}
        >
          Review purge…
        </Button>
        <Button variant="ghost" onClick={() => setPicking(false)}>
          Done
        </Button>
      </div>
    </div>
  );
}
