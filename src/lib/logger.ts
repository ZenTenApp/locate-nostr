/**
 * Namespaced console logging, off unless `?debug` is in the URL.
 *
 * A sweep touches a thousand relays and each one can produce several lines;
 * left on by default that is a console nobody can read and a measurable cost
 * in the render loop. The flag is read once at module load.
 */
const enabled =
  typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');

function make(namespace: string) {
  return (message: string, detail?: Record<string, unknown>): void => {
    if (!enabled) return;
    console.debug(`[${namespace}] ${message}`, detail ?? '');
  };
}

export const logger = {
  relay: make('relay'),
  sweep: make('sweep'),
  directory: make('directory'),
  cache: make('cache'),
  key: make('key'),
};
