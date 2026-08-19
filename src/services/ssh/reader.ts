/**
 * Sequential reader for the OpenSSH binary key format: a stream of big-endian
 * uint32s and length-prefixed blobs.
 *
 * Ported from `usdt-pay/services/ssh-reader.ts`, with `Buffer` replaced by
 * `Uint8Array` + `DataView`. {@link SSHReader.readBlob} returns a **view** into
 * the source, matching `Buffer.slice()`'s semantics — so wiping the decrypted
 * block also wipes everything read out of it.
 */
import { fromUtf8, readU32BE } from '@/lib/bytes';
import { KeyError } from '@/lib/errors';

export class SSHReader {
  private readonly bytes: Uint8Array;
  private offset = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  /** Read a 32-bit unsigned integer (big-endian). */
  readUInt32(): number {
    if (this.offset + 4 > this.bytes.length) {
      // Reaching the end mid-field means the bytes are short or misaligned, not
      // that this was never a key — the caller already established that.
      throw new KeyError('damaged-key', 'Unexpected end of SSH key data');
    }
    const value = readU32BE(this.bytes, this.offset);
    this.offset += 4;
    return value;
  }

  /**
   * Read a length-prefixed blob: a 4-byte length followed by that many bytes.
   * The result aliases the source buffer.
   */
  readBlob(): Uint8Array {
    const length = this.readUInt32();
    if (this.offset + length > this.bytes.length) {
      // Reaching the end mid-field means the bytes are short or misaligned, not
      // that this was never a key — the caller already established that.
      throw new KeyError('damaged-key', 'Unexpected end of SSH key data');
    }
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  /** Read a length-prefixed blob and decode it as UTF-8 (algorithm names). */
  readString(): string {
    return fromUtf8(this.readBlob());
  }

  /** Advance past a length-prefixed blob whose contents we do not need. */
  skipBlob(): void {
    this.readBlob();
  }
}
