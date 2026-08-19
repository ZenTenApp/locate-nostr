/**
 * The kinds this app sweeps for, and everything the UI needs to know about
 * each one.
 *
 * A single data-driven list rather than a switch anywhere: the grid columns,
 * the filter chips, the per-kind filter built for a relay query and the
 * cache key all iterate this, so adding the next kind is one entry here and
 * nothing else.
 *
 * The set is exactly what `chat` reads or writes (`chat/src/config/nostr.ts`,
 * `NOSTR_KINDS`) — the question this tool answers is "would that app find its
 * data on this relay", so the column list has to be that app's kind list.
 */

export interface KindSpec {
  readonly kind: number;
  /** Column header. Kept to a few characters — there are six of these across
   *  a table a thousand rows tall. */
  readonly label: string;
  readonly nip: string;
  /** One line, shown in the legend and the column tooltip. */
  readonly note: string;
  /**
   * Replaceable kinds hold at most one event per author (per `d` tag for the
   * addressable ones), so an author-scoped count above 1 means the relay is
   * serving superseded copies — worth flagging rather than summing.
   */
  readonly replaceable: boolean;
  /** NIP-01 addressable range: replacement is keyed on the `d` tag. */
  readonly addressable: boolean;
  /**
   * Set when the kind is only meaningful under one `d` value. The sweep adds
   * it as a `#d` filter so a relay's count is the count of *this* status
   * rather than of every status type it holds.
   */
  readonly dTag?: string;
  /**
   * AUTH-gated on every relay that implements the kind properly: a kind-4
   * event is served only to its author or its `p`-tagged recipient. An
   * unauthenticated sweep therefore reads a *lower bound* — and a relay that
   * hands them out freely is the finding, not a bug in the sweep.
   */
  readonly authGated: boolean;
}

/** NIP-38 status type. `general` is the free-text one; `music` carries
 *  now-playing conventions and would count a different thing entirely. */
export const USER_STATUS_D = 'general';

export const KIND_SPECS: readonly KindSpec[] = [
  {
    kind: 0,
    label: 'profile',
    nip: 'NIP-01',
    note: 'Your profile — name, picture, verified address.',
    replaceable: true,
    addressable: false,
    authGated: false,
  },
  {
    kind: 3,
    label: 'follows',
    nip: 'NIP-02',
    note: 'The list of everyone you follow.',
    replaceable: true,
    addressable: false,
    authGated: false,
  },
  {
    kind: 4,
    label: 'messages',
    nip: 'NIP-04',
    note: 'Private messages you sent or received. A relay behaving correctly hides these unless you sign in, so the number shown is a minimum.',
    replaceable: false,
    addressable: false,
    authGated: true,
  },
  {
    kind: 10002,
    label: 'relay list',
    nip: 'NIP-65',
    note: 'Where you tell other people to find you — the relays you say you read and post on.',
    replaceable: true,
    addressable: false,
    authGated: false,
  },
  {
    kind: 10050,
    label: 'inbox',
    nip: 'NIP-17',
    note: 'Where people should send you a private message.',
    replaceable: true,
    addressable: false,
    authGated: false,
  },
  {
    kind: 30315,
    label: 'status',
    nip: 'NIP-38',
    note: 'Your status — a line of text saying what you are up to.',
    replaceable: true,
    addressable: true,
    dTag: USER_STATUS_D,
    authGated: false,
  },
];

export const ALL_KINDS: readonly number[] = KIND_SPECS.map((spec) => spec.kind);

const SPEC_BY_KIND = new Map(KIND_SPECS.map((spec) => [spec.kind, spec]));

export function kindSpec(kind: number): KindSpec | undefined {
  return SPEC_BY_KIND.get(kind);
}

/** `30315` → `status`, for a header cell or an error line. */
export function kindLabel(kind: number): string {
  return SPEC_BY_KIND.get(kind)?.label ?? String(kind);
}
