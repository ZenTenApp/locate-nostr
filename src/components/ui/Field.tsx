import type { ComponentProps } from 'react';

import { tooltipHandlers } from '@/components/ui/tooltip-handlers';

const FIELD_CLASS =
  'w-full rounded-md border border-surface-border bg-surface-card px-md py-sm ' +
  'text-base text-ink-primary placeholder:text-ink-muted transition ' +
  'focus:border-brand-primary focus:outline-none';

/**
 * Search fields, not credential fields. Nothing typed into this app is a
 * secret — an npub is public by construction — so autofill is left alone and
 * only spellcheck is off, since a browser correcting `wss://` mid-paste is a
 * real and confusing failure.
 */
/**
 * Everything that stops a third party from reading a secret field.
 *
 * Autofill and password managers are the obvious half. The dangerous half is
 * the writing assistants: Grammarly attaches to any textarea it finds and
 * **uploads its contents** for analysis, which for a pasted SSH private key or
 * a recovery phrase is the whole identity, exfiltrated by a helpful feature.
 * It was observed doing exactly that on this dialog before these attributes
 * were added — its icons appeared inside the key field. Browser spellcheck has
 * the same property in some browsers.
 *
 * Opting out is per-vendor and attribute-based; there is no standard for it,
 * so each one is named explicitly.
 */
const SECRET_PROPS = {
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'off',
  spellCheck: false,
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
  'data-gramm': 'false',
  'data-gramm_editor': 'false',
  'data-enable-grammarly': 'false',
} as const;

export function Input({ className = '', ...rest }: ComponentProps<'input'>) {
  return <input spellCheck={false} className={`${FIELD_CLASS} ${className}`} {...rest} />;
}

export function TextArea({ className = '', ...rest }: ComponentProps<'textarea'>) {
  return (
    <textarea
      spellCheck={false}
      className={`${FIELD_CLASS} resize-y font-mono text-sm ${className}`}
      {...rest}
    />
  );
}

/**
 * A field for something secret, masked but deliberately **not**
 * `type="password"`.
 *
 * A password field is the one input browsers and password managers offer to
 * save and replay. Every secret this app accepts — an SSH passphrase, a
 * recovery phrase — exists for a single derivation and is then wiped, so an
 * offer to remember it is an offer to undo the entire security posture. The
 * masking is CSS over a plain text field: shoulder-surfing is covered, saving
 * is never offered.
 */
export function SecretInput({ className = '', ...rest }: ComponentProps<'input'>) {
  return <Input type="text" className={`mask-chars ${className}`} {...SECRET_PROPS} {...rest} />;
}

/** A textarea for a pasted key. Same reasoning as {@link SecretInput}; not
 *  masked, because a key too long to see is a key too long to check. */
export function SecretTextArea({ className = '', ...rest }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={`${FIELD_CLASS} resize-y font-mono text-sm ${className}`}
      {...SECRET_PROPS}
      {...rest}
    />
  );
}

export function Select({ className = '', ...rest }: ComponentProps<'select'>) {
  return <select className={`${FIELD_CLASS} cursor-pointer ${className}`} {...rest} />;
}

/** Native checkbox, sized to the fields. Native rather than a styled div so
 *  keyboard and screen-reader behaviour comes free. */
function Checkbox({ className = '', ...rest }: ComponentProps<'input'>) {
  return (
    <input
      type="checkbox"
      className={`h-4 w-4 shrink-0 accent-brand-primary ${className}`}
      {...rest}
    />
  );
}

/** A checkbox with its label, which is how all of them are used here. */
export function CheckLabel({
  label,
  hint,
  title,
  ...rest
}: ComponentProps<'input'> & { label: string; hint?: string }) {
  return (
    <label
      {...(title === undefined ? {} : tooltipHandlers({ title: label, lines: [title] }))}
      className="flex cursor-pointer items-center gap-sm text-base text-ink-secondary"
    >
      <Checkbox {...rest} />
      <span>{label}</span>
      {hint !== undefined && <span className="text-sm text-ink-muted">{hint}</span>}
    </label>
  );
}
