/**
 * "What you are looking at is old."
 *
 * A saved result is restored the moment an identity is recognised, which is
 * the right behaviour — a full check takes minutes and the previous answer is
 * usually the one wanted. It is also the most dangerous state in the app: the
 * grid looks exactly like a live result, so a user who reloads, pastes their
 * SSH key and reads the numbers has no way to tell they are reading yesterday.
 *
 * Hence a banner rather than a caption. It carries the wall-clock time as well
 * as "2h ago" — a relative age reads the same at 9am as it did at 7am, and the
 * question being answered is usually "is this from before or after the thing I
 * changed?", which only a clock time can settle.
 */
import { absoluteTime, since } from '@/lib/format';
import { Button } from '@/components/ui/Button';

export function CacheBanner({
  checkedAt,
  complete,
  relayCount,
  onRecheck,
  busy,
}: {
  checkedAt: number | null;
  /** False when the saved run was stopped before it finished. */
  complete: boolean | null;
  /** How many relays the saved run covered. */
  relayCount: number;
  onRecheck: () => void;
  busy: boolean;
}) {
  return (
    <section className="flex flex-wrap items-center gap-md border-b border-state-warning/40 bg-state-warning/10 px-lg py-sm">
      <span className="text-lg" aria-hidden>
        🕓
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-base text-ink-primary">
          Saved result — nothing has been checked just now.
        </p>
        <p className="mt-0.5 text-sm text-ink-secondary">
          {checkedAt === null ? (
            'Last checked at an unknown time.'
          ) : (
            <>
              Last checked{' '}
              <strong className="font-medium text-ink-primary">{absoluteTime(checkedAt)}</strong> (
              {since(checkedAt / 1000)}) across {relayCount.toLocaleString('en-US')} relays.
            </>
          )}
          {complete === false && ' That check was stopped before it finished, so it is partial.'}
        </p>
      </div>

      <Button onClick={onRecheck} disabled={busy}>
        Check again now
      </Button>
    </section>
  );
}
