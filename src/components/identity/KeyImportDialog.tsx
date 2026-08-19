/**
 * Deriving an identity from a recovery phrase or an SSH key.
 *
 * **Secrets never enter React state.** They live in the DOM nodes and in refs,
 * are read once at submit time, and are cleared immediately after. React state
 * is retained across renders, captured in the Fiber tree, and printed happily
 * by devtools; only booleans — "is this field non-empty" — are tracked here.
 * The same discipline as `chat/src/pages/LoginPage.tsx`, for the same reason.
 *
 * What the user gets back is a pubkey. The private key is derived inside the
 * key worker, used once, and zeroed before the call returns; the worker is
 * then terminated to drop the passphrase and phrase strings, which are
 * immutable and cannot be wiped in place. Nothing is written to disk.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { KEY_ERROR_TEXT, keyErrorCode } from '@/lib/errors';
import type { PublicIdentity } from '@/services/crypto/nip06';
import {
  cancelKeyWork,
  estimateSshSeconds,
  inspectSshKey,
  prepareKeyWorker,
  pubkeyFromSeed,
  pubkeyFromSshKey,
} from '@/services/nostr/key-import';
import type { IdentitySource, SshKeyInfo } from '@/services/nostr/key-import';
import { Button } from '@/components/ui/Button';
import { SecretInput, SecretTextArea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';

export type KeyImportMode = Extract<IdentitySource, 'seed' | 'ssh'>;

/** Below this the estimate is noise and the spinner alone reads as
 *  responsive. */
const ESTIMATE_FLOOR_SECONDS = 3;

function formatEstimate(seconds: number): string {
  return seconds >= 60 ? `~${Math.ceil(seconds / 60)} min` : `~${Math.round(seconds)}s`;
}

const COPY: Record<KeyImportMode, { title: string; subtitle: string; placeholder: string }> = {
  seed: {
    title: 'Recovery phrase',
    subtitle:
      'Twelve or twenty-four BIP39 words, or an nsec. Used once to derive your public key, then wiped.',
    placeholder: 'leader monkey parrot ring guide accident before fence cannon height naive bean',
  },
  ssh: {
    title: 'SSH key',
    subtitle:
      'An encrypted OpenSSH Ed25519 key — the same key `chat` signs in with, so it yields the same identity.',
    placeholder: '-----BEGIN OPENSSH PRIVATE KEY-----',
  },
};

export function KeyImportDialog({
  mode,
  onDone,
  onClose,
}: {
  mode: KeyImportMode;
  onDone: (identity: PublicIdentity, source: IdentitySource) => void;
  onClose: () => void;
}) {
  const secretRef = useRef<HTMLTextAreaElement>(null);
  const passphraseRef = useRef<HTMLInputElement>(null);

  const [filled, setFilled] = useState(false);
  /** Whether the passphrase box has anything in it — a boolean, never the
   *  value: React state is retained in the Fiber tree and printed by devtools. */
  const [passphraseFilled, setPassphraseFilled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Public metadata read off the pasted key — safe to hold in state. */
  const [keyInfo, setKeyInfo] = useState<SshKeyInfo | null>(null);
  const [estimate, setEstimate] = useState<string | null>(null);

  const clearFields = useCallback(() => {
    if (secretRef.current) secretRef.current.value = '';
    if (passphraseRef.current) passphraseRef.current.value = '';
    setPassphraseFilled(false);
  }, []);

  // On unmount: clear the fields, and terminate any worker. A dialog closed
  // mid-derivation must not leave `bcrypt_pbkdf` grinding in a heap that still
  // holds the passphrase.
  useEffect(
    () => () => {
      clearFields();
      cancelKeyWork();
    },
    [clearFields],
  );

  useEffect(() => {
    secretRef.current?.focus();
    if (mode === 'ssh') prepareKeyWorker();
  }, [mode]);

  /**
   * Inspect a pasted SSH key as it arrives: is it really a key, is it
   * encrypted, and how many bcrypt rounds will the wait be? All of it is
   * base64 and framing on the main thread, so a bad key is refused before the
   * user types a passphrase for it.
   */
  const onSecretChange = () => {
    const value = secretRef.current?.value ?? '';
    setFilled(value.trim() !== '');
    if (mode !== 'ssh') return;

    setError(null);
    setKeyInfo(null);
    setEstimate(null);
    if (!value.includes('OPENSSH PRIVATE KEY') && value.trim().length < 100) return;

    try {
      const info = inspectSshKey(value);
      setKeyInfo(info);
      // No KDF, no wait worth predicting.
      if (!info.encrypted) return;
      void estimateSshSeconds(info.rounds)
        .then((seconds) =>
          setEstimate(seconds >= ESTIMATE_FLOOR_SECONDS ? formatEstimate(seconds) : null),
        )
        .catch(() => setEstimate(null));
    } catch (err) {
      setError(KEY_ERROR_TEXT[keyErrorCode(err)]);
    }
  };

  const submit = async () => {
    const secret = secretRef.current?.value ?? '';
    const passphrase = passphraseRef.current?.value ?? '';

    setBusy(true);
    setError(null);
    try {
      const identity =
        mode === 'ssh'
          ? await pubkeyFromSshKey(secret, passphrase)
          : await pubkeyFromSeed(secret, passphrase);
      clearFields();
      onDone(identity, mode);
    } catch (err) {
      setError(KEY_ERROR_TEXT[keyErrorCode(err)]);
    } finally {
      setBusy(false);
    }
  };

  const copy = COPY[mode];
  // For an SSH key the paste has to parse first, and an encrypted one needs
  // its passphrase before the button does anything useful. Checked here rather
  // than left to fail in the worker: `bcrypt_pbkdf` rejects an empty
  // passphrase as invalid parameters, which is indistinguishable from a
  // malformed key and used to be reported as one.
  /**
   * Three states, not two. Until a key parses, whether it needs a passphrase
   * is **unknown** — and saying "required" for unknown told users with an
   * unencrypted key that they had to produce a passphrase that does not
   * exist. The field stays usable while unknown; it is only disabled once a
   * key has actually said it has no passphrase.
   */
  const passphraseNeed: 'unknown' | 'required' | 'none' =
    mode === 'seed'
      ? 'unknown'
      : keyInfo === null
        ? 'unknown'
        : keyInfo.encrypted
          ? 'required'
          : 'none';
  const needsPassphrase = passphraseNeed !== 'none';
  /**
   * Only two things stop the button: nothing pasted, and work already running.
   *
   * Not a missing passphrase, and not a key that failed to parse. Both used to
   * disable it, which left the user staring at a dead control with no way to
   * find out what it wanted — and the reasoning was wrong anyway: the check
   * belongs where the answer is exact. `pubkeyFromSshKey` reports
   * `passphrase-required` before bcrypt runs, and a bad paste reports
   * `bad-format`, both as a sentence under the field. Letting the click
   * through costs a parse and returns a real explanation.
   */
  const blocked = !filled || busy;

  return (
    <Modal title={copy.title} subtitle={copy.subtitle} onClose={onClose}>
      <div className="flex flex-col gap-md">
        <SecretTextArea
          ref={secretRef}
          rows={mode === 'ssh' ? 8 : 3}
          onChange={onSecretChange}
          placeholder={copy.placeholder}
          aria-label={copy.title}
        />

        <label className="flex flex-col gap-xs text-sm text-ink-secondary">
          {mode === 'seed'
            ? 'BIP39 passphrase (optional — the 25th word)'
            : passphraseNeed === 'none'
              ? 'Key passphrase — not needed, this key has none'
              : 'Key passphrase'}
          <SecretInput
            ref={passphraseRef}
            disabled={!needsPassphrase}
            onChange={(event) => setPassphraseFilled(event.target.value !== '')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !blocked) void submit();
            }}
            placeholder={
              mode === 'seed'
                ? 'leave empty unless you set one'
                : passphraseNeed === 'required'
                  ? 'required for this key'
                  : passphraseNeed === 'none'
                    ? 'not needed — this key is unencrypted'
                    : 'only if your key has one'
            }
            aria-label="Passphrase"
          />
          {mode === 'seed' && (
            <span className="text-xs text-ink-muted">
              A different value here is a different wallet, not a wrong password — leave it empty if
              you did not deliberately set one.
            </span>
          )}
        </label>

        {keyInfo?.encrypted === true && (
          <p className="text-xs text-ink-muted">
            Encrypted with {keyInfo.rounds} bcrypt rounds
            {estimate !== null && ` — unlocking will take about ${estimate}`}.
            {!passphraseFilled && ' This key needs its passphrase.'}
          </p>
        )}
        {keyInfo?.encrypted === false && (
          <p className="text-xs text-state-warning">
            This key has no passphrase. It is read the same way and nothing is stored — but a key
            kept unencrypted on disk protects nothing if that file is ever read by anyone else.
          </p>
        )}

        {error !== null && (
          <p className="rounded-md bg-state-error/15 px-md py-sm text-sm text-state-error">
            {error}
          </p>
        )}

        <p className="text-xs text-ink-muted">
          The key is used once, in a worker, to compute your public key — then every buffer holding
          it is zeroed and the worker is destroyed. Nothing is stored, and this app never signs
          anything.
        </p>

        <div className="flex justify-end gap-sm">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={blocked}>
            {busy ? 'Deriving…' : 'Use this identity'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
