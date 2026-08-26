/**
 * What each purge outcome is called, in one table.
 *
 * The wording *is* the claim. `OK true` means a relay **accepted** a delete
 * request; NIP-09 does not oblige it to honour one, and no screen here says
 * "deleted". Accepted, refused and never-answered are three different things,
 * and the third is not a failure — it is the absence of an answer, which is
 * the distinction the whole purge design is built to preserve.
 *
 * Shared because there are two screens that delete — the bulk purge and the
 * ticked-events one — and they must say the same words about the same
 * outcome. The second used to rebuild the verdict from the accepted/refused
 * counters and got three of the six wrong: a partly-accepted relay read as
 * "accepted", and both an unreachable one and a failed one read as "never
 * answered", which is precisely the loose claim this app refuses to make.
 */
import type { PurgeRelayStatus } from '@/services/purge/engine';
import type { BadgeTone } from '@/components/ui/Badge';

export interface ReportStatusCopy {
  tone: BadgeTone;
  /** Two words, for a badge beside a relay's URL. */
  label: string;
  /** The sentence behind the badge. */
  title: string;
  /** How the same outcome reads in running prose: "The relay …". */
  sentence: string;
}

export const REPORT_STATUS: Record<PurgeRelayStatus, ReportStatusCopy> = {
  accepted: {
    tone: 'success',
    label: 'accepted',
    title:
      'The relay accepted the delete request. Whether it actually drops the events is up to it — nothing in the protocol forces it to.',
    sentence: 'accepted the request',
  },
  partial: {
    tone: 'warning',
    label: 'partly accepted',
    title:
      'Some requests were accepted and some were not. The relay may hold more than was cleared.',
    sentence: 'accepted some of the request and turned the rest down',
  },
  refused: {
    tone: 'error',
    label: 'refused',
    title: 'The relay rejected the delete request outright — its own message is shown beside it.',
    sentence: 'refused the request',
  },
  unanswered: {
    tone: 'warning',
    label: 'no answer',
    title:
      'The request was sent and the relay never acknowledged it. It may have applied it; nobody knows.',
    sentence: 'never acknowledged the request, so nothing is known either way',
  },
  unreachable: {
    tone: 'neutral',
    label: 'unreachable',
    title: 'The socket never opened, so nothing was sent to this relay at all.',
    sentence: 'could not be reached, so nothing was sent to it',
  },
  error: {
    tone: 'error',
    label: 'failed',
    title: 'Something went wrong before the relay could answer.',
    sentence: 'could not be asked — something went wrong before it answered',
  },
};
