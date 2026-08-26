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
  /** The nostr kind number — or {@link OTHER_KIND} for the catch-all, which is
   *  not a kind at all. */
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
  /**
   * Not a kind: everything that is not one of the others.
   *
   * NIP-01 filters can say `kinds: [...]` and cannot say "anything but these",
   * so this one is asked for as an author-only query and sorted client-side.
   * That has consequences the rest of the code has to respect — the relay's
   * own `COUNT` cannot answer it, and a sample that fills up with named kinds
   * says nothing about how many others exist — so it is a flag rather than a
   * special case buried in each caller. See `sweep/filters.ts`.
   */
  readonly catchAll: boolean;
}

/**
 * The kind number of the catch-all column.
 *
 * Negative on purpose: kinds are non-negative in NIP-01, so this can never
 * collide with a real one, and any code that leaks it into a filter or a tag
 * produces something obviously wrong rather than something plausible.
 */
export const OTHER_KIND = -1;

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
    catchAll: false,
  },
  {
    kind: 3,
    label: 'follows',
    nip: 'NIP-02',
    note: 'The list of everyone you follow.',
    replaceable: true,
    addressable: false,
    authGated: false,
    catchAll: false,
  },
  {
    kind: 4,
    label: 'messages',
    nip: 'NIP-04',
    note: 'Private messages you sent or received. A relay behaving correctly hides these unless you sign in, so the number shown is a minimum.',
    replaceable: false,
    addressable: false,
    authGated: true,
    catchAll: false,
  },
  {
    kind: 10002,
    label: 'relay list',
    nip: 'NIP-65',
    note: 'Where you tell other people to find you — the relays you say you read and post on.',
    replaceable: true,
    addressable: false,
    authGated: false,
    catchAll: false,
  },
  {
    kind: 10050,
    label: 'inbox',
    nip: 'NIP-17',
    note: 'Where people should send you a private message.',
    replaceable: true,
    addressable: false,
    authGated: false,
    catchAll: false,
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
    catchAll: false,
  },
  {
    kind: OTHER_KIND,
    label: 'other',
    nip: 'any kind',
    note: 'Everything else this person has on the relay — notes, reactions, lists, anything without a column of its own.',
    replaceable: false,
    addressable: false,
    authGated: false,
    catchAll: true,
  },
];

/**
 * Everything a sweep asks by default, catch-all included.
 *
 * The catch-all costs a seventh subscription per relay and drops the `kinds`
 * filter on it, which is the heaviest question here — but leaving it off by
 * default made it invisible: the column was absent, the chip was one dim
 * button at the end of a row, and the honest answer to "where is my data"
 * silently excluded everything that is not one of six kinds. A tool that
 * answers that question has to count the notes too, and switching it off is
 * one click for anyone who wants the faster sweep.
 */
export const ALL_KINDS: readonly number[] = KIND_SPECS.map((spec) => spec.kind);

/** The kinds that have a column of their own — everything the catch-all is
 *  *not*, and the set it is defined by subtracting. Derived from the specs
 *  rather than from the default selection: what the user has switched on must
 *  never change what `other` means. */
const NAMED_KINDS = new Set(KIND_SPECS.filter((spec) => !spec.catchAll).map((spec) => spec.kind));

/** Does this kind have a column of its own? The one question the catch-all is
 *  defined by, asked in the filters, the sweep and the purge. */
export function isNamedKind(kind: number): boolean {
  return NAMED_KINDS.has(kind);
}

const SPEC_BY_KIND = new Map(KIND_SPECS.map((spec) => [spec.kind, spec]));

export function kindSpec(kind: number): KindSpec | undefined {
  return SPEC_BY_KIND.get(kind);
}

/** What a chip prints beside the label: the kind number, or a mark for the
 *  catch-all, which has no number to print and must not borrow `-1`. */
export function kindCode(spec: KindSpec): string {
  return spec.catchAll ? '···' : String(spec.kind);
}

/**
 * The protocol name for a kind, said one way everywhere: `kind 4 · NIP-04`.
 *
 * The plain label answers "what is this", this answers "what do I search for
 * to check it" — and it lives here because four screens show it and four
 * hand-written formats of the same two facts is how they drift apart.
 */
export function kindTag(spec: KindSpec): string {
  return spec.catchAll ? 'any kind without a column of its own' : `kind ${spec.kind} · ${spec.nip}`;
}
