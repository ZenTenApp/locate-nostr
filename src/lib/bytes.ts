/**
 * Byte helpers for the ported key-handling code.
 *
 * The React Native original leaned on Node's `Buffer`. Rather than polyfill it
 * — which costs bundle size and, worse, re-introduces `Buffer.slice()`'s
 * view-not-copy semantics that the wipe discipline silently depends on — every
 * use has a Web equivalent here.
 *
 * `.slice()` is banned by lint in this file and in `services/{ssh,crypto}`:
 * `Uint8Array.prototype.slice()` COPIES, so a copy taken off a buffer escapes
 * the `fill(0)` that wipes the parent. Take a view with `subarray()`, or say
 * you want a copy with {@link copyBytes}.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** UTF-8 encode. Note the byte length may exceed the string's `.length`. */
export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

/** UTF-8 decode, reusing one decoder rather than building one per call. */
export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/**
 * Read a big-endian uint32. OpenSSH's wire format is length-prefixed
 * big-endian throughout, which is what `Buffer.readUInt32BE` provided.
 */
export function readU32BE(bytes: Uint8Array, offset: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(offset, false);
}

/**
 * An explicit copy — the deliberate counterpart to the banned `.slice()`.
 * Reach for this only when the copy must outlive the source buffer's wipe.
 */
export function copyBytes(bytes: Uint8Array, start = 0, end = bytes.length): Uint8Array {
  return new Uint8Array(bytes.subarray(start, end));
}

/** Byte-wise equality. Not constant-time; used only on public framing bytes. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Zero every buffer given, ignoring nullish ones so it drops straight into a
 * `finally` where some locals may not have been assigned yet.
 */
export function wipe(...buffers: (Uint8Array | null | undefined)[]): void {
  for (const buffer of buffers) buffer?.fill(0);
}
