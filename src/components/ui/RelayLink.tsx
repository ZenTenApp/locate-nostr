/**
 * A relay URL, shown in full and openable.
 *
 * Two things a bare host string does not do: say the actual endpoint being
 * probed — scheme, port and path included, since `wss://host/inbox` and
 * `wss://host` are different relays — and let the reader go look at it.
 *
 * The link target is the relay's own HTTP address, which is where its NIP-11
 * document and usually a landing page live. Opening it is a request to a host
 * the user chose to click, carrying no referrer: the page sets
 * `referrer=no-referrer` globally and this repeats it per link, so the relay
 * operator learns an IP visited them and not which pubkey was being looked up.
 */
import { relayHttpUrl } from '@/services/relay/url';
import { tooltipHandlers } from '@/components/ui/tooltip-handlers';

export function RelayLink({
  url,
  className = '',
  title,
}: {
  url: string;
  className?: string;
  title?: string;
}) {
  return (
    <a
      href={relayHttpUrl(url)}
      target="_blank"
      rel="noreferrer noopener"
      // The row underneath is a button; without this the click both opens the
      // relay and toggles the row's detail panel.
      onClick={(event) => event.stopPropagation()}
      {...tooltipHandlers({
        title: title ?? 'Open this relay',
        lines: [relayHttpUrl(url)],
      })}
      className={`font-mono underline decoration-dotted underline-offset-2 hover:text-brand-primary ${className}`}
    >
      {url}
    </a>
  );
}
