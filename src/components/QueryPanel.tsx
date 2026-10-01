/**
 * Whose data to look for, and the button that goes looking.
 *
 * An identity is mandatory, and the four ways of supplying one sit together
 * because they answer the same question with different amounts of trust: a
 * pasted npub is a claim, a key or an extension is proof. Wording throughout
 * this screen is deliberately plain — "check", not "sweep"; "profile", not
 * "kind 0" — because the words that make the code precise made the interface
 * unreadable to anyone who does not already know the protocol. The precise
 * terms live in the tooltips.
 */
import { useEffect, useState } from 'react';

import { KIND_SPECS, kindCode, kindTag } from '@/config/kinds';
import { DISCOVERY_RELAYS, SAMPLE_LIMIT_CHOICES, SWEEP_CONCURRENCY_RANGE } from '@/config/sweep';
import { compactCount, since } from '@/lib/format';
import { shortIdentity } from '@/services/nostr/identity';
import { hasNostrExtension, pubkeyFromExtension } from '@/services/nostr/extension';
import { KEY_ERROR_TEXT, keyErrorCode } from '@/lib/errors';
import type { PublicIdentity } from '@/services/crypto/nip06';
import type { IdentitySource } from '@/services/nostr/key-import';
import { KeyImportDialog } from '@/components/identity/KeyImportDialog';
import { tooltipHandlers } from '@/components/ui/tooltip-handlers';
import type { KeyImportMode } from '@/components/identity/KeyImportDialog';
import type { Directory, RelaySource, SelectionBreakdown } from '@/services/discovery/directory';
import { DirectorySources } from '@/components/DirectorySources';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CheckLabel, Input, Select, TextArea } from '@/components/ui/Field';

export interface QueryPanelProps {
  author: string | null;
  authorNpub: string | null;
  authorSource: IdentitySource | null;
  identityText: string;
  identityError: string | null;
  kinds: number[];
  sampleLimit: number;
  concurrency: number;
  includeDarknet: boolean;
  includeStale: boolean;
  pastedRelays: string;
  relaySource: RelaySource;
  directory: Directory | null;
  breakdown: SelectionBreakdown;
  directoryLoading: boolean;
  running: boolean;
  onIdentityText: (text: string) => void;
  onIdentity: (identity: PublicIdentity, source: IdentitySource) => void;
  onClearIdentity: () => void;
  onChange: (patch: {
    kinds?: number[];
    sampleLimit?: number;
    concurrency?: number;
    includeDarknet?: boolean;
    includeStale?: boolean;
    pastedRelays?: string;
    relaySource?: RelaySource;
  }) => void;
  onStart: () => void;
  onCancel: () => void;
  onRefreshDirectory: () => void;
}

/**
 * The two things the pasted list can mean, as data.
 *
 * Pasting used to be additive only, which answers "where on the network is my
 * data" and cannot answer "is my data on these four relays" without sweeping
 * thirteen hundred others to find out. The second question is a different
 * question, not a smaller one, and it is answered in seconds.
 */
const SOURCE_CHOICES: { value: RelaySource; label: string; hint: string }[] = [
  {
    value: 'both',
    label: 'add to the tracker list',
    hint: 'Check every relay the trackers know about, plus the ones you paste.',
  },
  {
    value: 'pasted',
    label: 'check only these',
    hint: 'Ignore the tracker list entirely and check only the relays you paste. Seconds instead of minutes, and it answers a different question: is my data on these particular relays.',
  },
];

/** Buttons that share a row on a phone split it evenly; on a wide screen they
 *  size to their labels. */
const PHONE_FILL = 'flex-1 md:flex-none';

/** Where an identity came from, said in the one line under the box. */
const SOURCE_LABEL: Record<IdentitySource, string> = {
  text: 'pasted',
  extension: 'from your extension',
  seed: 'derived from your recovery phrase',
  ssh: 'derived from your SSH key',
};

export function QueryPanel(props: QueryPanelProps) {
  const [advanced, setAdvanced] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [keyDialog, setKeyDialog] = useState<KeyImportMode | null>(null);
  const [extensionBusy, setExtensionBusy] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  /**
   * Whether an extension is installed, checked once after mount. Extensions
   * inject `window.nostr` asynchronously, so a check during the first render
   * reports "none" for every user who has one.
   */
  const [extensionPresent, setExtensionPresent] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setExtensionPresent(hasNostrExtension()), 300);
    return () => clearTimeout(timer);
  }, []);

  // A run starting folds the set-up away, whichever button started it — the
  // Check button here, or Re-check on the cache banner, which cannot reach
  // this component's state. Adjusted during render off the run itself rather
  // than from each handler, so the two paths cannot drift and no extra pass
  // is committed to the DOM first.
  const [wasRunning, setWasRunning] = useState(props.running);
  if (props.running !== wasRunning) {
    setWasRunning(props.running);
    if (props.running) {
      setAdvanced(false);
      setSourcesOpen(false);
    }
  }

  /** The relay-list line, as a sentence rather than a ternary in an
   *  attribute. */
  const directoryLabel = (): string => {
    // In "check only these" mode the trackers are not the source of the
    // number on screen, and saying they are would attribute the user's own
    // list to somebody else.
    if (props.relaySource === 'pasted') {
      return `${compactCount(props.breakdown.selected)} relays from your own list`;
    }
    if (props.directoryLoading) return 'finding relays…';
    if (props.directory === null) return 'no relays found yet';
    const answered =
      props.directory.sources.filter((source) => source.error === null).length ||
      DISCOVERY_RELAYS.length;
    return `${compactCount(props.breakdown.selected)} relays found by ${answered} relay trackers, ${since(
      props.directory.fetchedAt / 1000,
    )}`;
  };

  const askExtension = async () => {
    setExtensionBusy(true);
    setKeyError(null);
    try {
      props.onIdentity(await pubkeyFromExtension(), 'extension');
    } catch (err) {
      setKeyError(KEY_ERROR_TEXT[keyErrorCode(err)]);
    } finally {
      setExtensionBusy(false);
    }
  };

  const toggleKind = (kind: number) => {
    const next = props.kinds.includes(kind)
      ? props.kinds.filter((entry) => entry !== kind)
      : [...props.kinds, kind];
    if (next.length > 0) props.onChange({ kinds: next });
  };

  // What is actually being looked for, read off the chips rather than written
  // out. The sentence used to name four kinds in prose while the chips below
  // it toggled seven — untick messages and it still claimed to be searching
  // them, and `other` never appeared at all.
  const lookingFor = KIND_SPECS.filter((spec) => props.kinds.includes(spec.kind))
    .map((spec) => spec.label)
    .join(', ');

  // No identity, no run. There is nothing sensible to look for "for nobody",
  // and an empty box used to mean "everything on every relay" — three minutes
  // of work answering a question the user had not asked.
  const blocked = props.author === null;

  return (
    <section className="border-b border-surface-border bg-surface-panel px-lg py-md">
      <div className="flex flex-wrap items-center gap-md">
        <div className="w-full md:w-auto md:min-w-[320px] md:flex-1">
          <Input
            value={props.identityText}
            onChange={(event) => props.onIdentityText(event.target.value)}
            placeholder="Whose data are you looking for? Paste an npub"
            aria-label="Identity to locate"
          />
        </div>

        <div className="flex w-full items-center gap-xs md:w-auto">
          <Button
            variant="secondary"
            className={PHONE_FILL}
            onClick={() => void askExtension()}
            disabled={extensionBusy || props.running}
            {...tooltipHandlers({
              title: 'Use your browser extension',
              lines: [
                extensionPresent
                  ? 'Asks your Nostr extension for your public key. It never reveals your private key, and nothing is signed.'
                  : 'No Nostr extension found. Install one (Alby, nos2x), or paste an npub instead.',
              ],
            })}
          >
            {extensionBusy ? 'Asking…' : 'Extension'}
          </Button>
          <Button
            variant="secondary"
            className={PHONE_FILL}
            onClick={() => setKeyDialog('seed')}
            disabled={props.running}
            {...tooltipHandlers({
              title: 'Use your recovery phrase',
              lines: [
                'Works out your public key from your BIP39 words or an nsec.',
                'The secret is used once, in a background worker, then erased. Nothing is stored and nothing is signed.',
              ],
            })}
          >
            Seed
          </Button>
          <Button
            variant="secondary"
            className={PHONE_FILL}
            onClick={() => setKeyDialog('ssh')}
            disabled={props.running}
            {...tooltipHandlers({
              title: 'Use your SSH key',
              lines: [
                'Works out your Nostr public key from an OpenSSH Ed25519 key.',
                'The key is used once, in a background worker, then erased. Nothing is stored and nothing is signed.',
              ],
            })}
          >
            SSH key
          </Button>
        </div>

        {props.running ? (
          <Button variant="danger" className={PHONE_FILL} onClick={props.onCancel}>
            Stop
          </Button>
        ) : (
          <Button
            className={PHONE_FILL}
            onClick={props.onStart}
            disabled={blocked || props.breakdown.selected === 0}
          >
            {blocked
              ? 'Enter an npub first'
              : `Check ${compactCount(props.breakdown.selected)} relays`}
          </Button>
        )}

        <Button variant="ghost" onClick={() => setAdvanced((open) => !open)}>
          {advanced ? 'Hide options' : 'Options'}
        </Button>
      </div>

      <div className="relative mt-sm flex flex-wrap items-center gap-sm text-sm text-ink-muted">
        {props.identityError !== null && (
          <span className="text-state-error">{props.identityError}</span>
        )}
        {keyError !== null && <span className="text-state-error">{keyError}</span>}
        {props.author !== null && props.authorNpub !== null && (
          <>
            <span>
              Looking for {shortIdentity(props.authorNpub)}&rsquo;s {lookingFor}
              {props.authorSource !== null && ` · ${SOURCE_LABEL[props.authorSource]}`}
            </span>
            <Button variant="ghost" className="px-sm py-0" onClick={props.onClearIdentity}>
              clear
            </Button>
          </>
        )}
        {props.author === null && props.identityError === null && (
          <span>
            Paste an npub above, or use your extension, recovery phrase or SSH key to fill it in.
          </span>
        )}
        <span aria-hidden>·</span>
        {/* The relay count is the number every result is read against, so its
            provenance is one click away rather than buried in a README. On a
            phone the link sits mid-line, so the panel anchors to the whole
            row instead and takes its width; from md up it hangs off the link. */}
        <span className="md:relative">
          <button
            type="button"
            onClick={() => setSourcesOpen((open) => !open)}
            className="underline decoration-dotted underline-offset-2 hover:text-ink-secondary"
            {...tooltipHandlers({
              title: 'Where these relays come from',
              lines: ['Click to see which trackers found them, and why some are left out.'],
            })}
          >
            {directoryLabel()}
          </button>
          {sourcesOpen && (
            <span className="absolute inset-x-0 top-full z-40 mt-xs block md:inset-x-auto md:left-0 md:top-6 md:mt-0">
              <DirectorySources
                directory={props.directory}
                breakdown={props.breakdown}
                loading={props.directoryLoading}
              />
            </span>
          )}
        </span>
        <Button variant="ghost" className="px-sm py-0" onClick={props.onRefreshDirectory}>
          refresh
        </Button>
      </div>

      <div className="mt-md flex flex-wrap gap-xs">
        {KIND_SPECS.map((spec) => {
          const on = props.kinds.includes(spec.kind);
          return (
            <button
              key={spec.kind}
              type="button"
              onClick={() => toggleKind(spec.kind)}
              {...tooltipHandlers({
                title: spec.label,
                lines: [spec.note, kindTag(spec)],
              })}
              className={`rounded-sm border px-sm py-0.5 text-sm transition ${
                on
                  ? 'border-brand-primary bg-brand-primaryDim text-ink-primary'
                  : 'border-surface-border text-ink-muted hover:text-ink-secondary'
              }`}
            >
              {spec.label}
              <span className="ml-xs font-mono text-xs text-ink-secondary">{kindCode(spec)}</span>
            </button>
          );
        })}
      </div>

      {advanced && (
        <div className="mt-md grid gap-md md:grid-cols-2">
          <div className="flex flex-col gap-sm">
            <label className="text-sm text-ink-secondary">
              How many events to fetch from a relay that can&rsquo;t give a total
              <Select
                className="mt-xs"
                value={props.sampleLimit}
                onChange={(event) => props.onChange({ sampleLimit: Number(event.target.value) })}
              >
                {SAMPLE_LIMIT_CHOICES.map((choice) => (
                  <option key={choice} value={choice}>
                    up to {choice} per column
                  </option>
                ))}
              </Select>
            </label>

            <label className="text-sm text-ink-secondary">
              Relays to check at once: <span className="font-mono">{props.concurrency}</span>
              <input
                type="range"
                min={SWEEP_CONCURRENCY_RANGE.min}
                max={SWEEP_CONCURRENCY_RANGE.max}
                value={props.concurrency}
                onChange={(event) => props.onChange({ concurrency: Number(event.target.value) })}
                className="mt-xs w-full accent-brand-primary"
              />
            </label>

            <CheckLabel
              label="Include hidden-network relays"
              hint="Tor and i2p — only reachable in a browser set up for them"
              checked={props.includeDarknet}
              onChange={(event) => props.onChange({ includeDarknet: event.target.checked })}
            />
            <CheckLabel
              label="Include relays that looked dead in the last 24h"
              hint="no tracker has seen them"
              checked={props.includeStale}
              onChange={(event) => props.onChange({ includeStale: event.target.checked })}
            />
          </div>

          <label className="flex flex-col text-sm text-ink-secondary">
            Your own relay list
            <TextArea
              rows={5}
              className="mt-xs"
              value={props.pastedRelays}
              onChange={(event) => props.onChange({ pastedRelays: event.target.value })}
              placeholder={'wss://dm1.zentext.me\nwss://dm2.nostr.box'}
            />
            <span className="mt-xs text-xs text-ink-muted">
              One per line. If the trackers already know a relay it keeps its details; the rest are
              checked with everything about them unknown <Badge tone="info">yours</Badge>. A relay
              you list here is never skipped for looking dead — you asked about it by name.
            </span>
            <div className="mt-sm flex flex-wrap gap-xs">
              {SOURCE_CHOICES.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  onClick={() => props.onChange({ relaySource: choice.value })}
                  {...tooltipHandlers({ title: choice.label, lines: [choice.hint] })}
                  className={`rounded-sm border px-sm py-0.5 text-sm transition ${
                    props.relaySource === choice.value
                      ? 'border-brand-primary bg-brand-primaryDim text-ink-primary'
                      : 'border-surface-border text-ink-muted hover:text-ink-secondary'
                  }`}
                >
                  {choice.label}
                </button>
              ))}
            </div>
            {props.relaySource === 'pasted' && props.pastedRelays.trim() === '' && (
              <span className="mt-xs text-xs text-state-warning">
                Nothing to check — paste at least one relay, or switch back to the tracker list.
              </span>
            )}
          </label>
        </div>
      )}

      {keyDialog !== null && (
        <KeyImportDialog
          mode={keyDialog}
          onClose={() => setKeyDialog(null)}
          onDone={(identity, source) => {
            props.onIdentity(identity, source);
            setKeyDialog(null);
            setKeyError(null);
          }}
        />
      )}
    </section>
  );
}
