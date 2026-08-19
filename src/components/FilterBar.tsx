/** Narrowing the grid. Pure controls over {@link GridFilters}; the filtering
 *  itself lives in `use-grid-rows.ts`. */
import { KIND_SPECS } from '@/config/kinds';
import type { GridFilters, SortKey } from '@/hooks/use-grid-rows';
import { CheckLabel, Input, Select } from '@/components/ui/Field';

const SORT_LABELS: Record<SortKey, string> = {
  // "most complete" said nothing about what was being counted: it is how many
  // of the columns hold anything, not how much they hold.
  hits: 'most types covered',
  events: 'most events',
  latency: 'fastest',
  url: 'name',
  change: 'changed first',
};

export function FilterBar({
  filters,
  onChange,
  matched,
  total,
  hasBaseline,
}: {
  filters: GridFilters;
  onChange: (patch: Partial<GridFilters>) => void;
  matched: number;
  total: number;
  /** Only offer the change filter when there is a previous run to compare to. */
  hasBaseline: boolean;
}) {
  return (
    <section className="flex flex-wrap items-center gap-md border-b border-surface-border bg-surface-panel px-lg py-sm">
      <div className="w-64">
        <Input
          value={filters.text}
          onChange={(event) => onChange({ text: event.target.value })}
          placeholder="search relays by name"
          aria-label="Filter relays"
        />
      </div>

      <div className="w-44">
        <Select
          value={filters.kind ?? ''}
          onChange={(event) =>
            onChange({ kind: event.target.value === '' ? null : Number(event.target.value) })
          }
          aria-label="Holding kind"
        >
          <option value="">has anything</option>
          {KIND_SPECS.map((spec) => (
            <option key={spec.kind} value={spec.kind}>
              has {spec.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="w-48">
        <Select
          value={filters.sort}
          onChange={(event) => onChange({ sort: event.target.value as SortKey })}
          aria-label="Sort by"
        >
          {Object.entries(SORT_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              sort: {label}
            </option>
          ))}
        </Select>
      </div>

      {/* These two read as synonyms until you know the difference, so each one
          states its own rule rather than naming a category. Answering and
          holding something are separate facts: most relays that answer hold
          nothing at all. */}
      <CheckLabel
        label="holds something"
        hint="≥1 event"
        title="Hides relays that answered with nothing, leaving only those holding at least one of the things you asked about."
        checked={filters.carryingOnly}
        onChange={(event) => onChange({ carryingOnly: event.target.checked })}
      />
      <CheckLabel
        label="replied"
        hint="answered at all"
        title="Hides relays that never answered at all. A relay that answered “nothing” stays — that is a real answer."
        checked={filters.answeredOnly}
        onChange={(event) => onChange({ answeredOnly: event.target.checked })}
      />
      <CheckLabel
        label="hide locked"
        hint="sign-in or payment"
        title="Hides relays that want you signed in or paid up before they will answer. Their numbers are a minimum, not a zero."
        checked={filters.hideGated}
        onChange={(event) => onChange({ hideGated: event.target.checked })}
      />
      {hasBaseline && (
        <CheckLabel
          label="changed only"
          hint="vs last sweep"
          title="Only relays whose numbers changed since the last time you asked this same question."
          checked={filters.changedOnly}
          onChange={(event) => onChange({ changedOnly: event.target.checked })}
        />
      )}

      <span className="ml-auto text-sm text-ink-muted">
        showing {matched} of {total} relays
      </span>
    </section>
  );
}
