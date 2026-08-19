/**
 * Run a real key through the import pipeline from the command line.
 *
 *   npx vite-node scripts/key-check.ts -- <path-to-key> [passphrase]
 *
 * Not part of the test suite: it takes a key off disk. It exists because the
 * dialog runs the same code in a Worker, where a failure surfaces as one line
 * of red text with no stack.
 */
import { readFileSync } from 'node:fs';

import { keyErrorCode } from '../src/lib/errors';
import { pubkeyFromMnemonic } from '../src/services/crypto/nip06';
import { convertOpenSSHEd25519ToMnemonic, parseOpenSSHPrivateKey } from '../src/services/ssh';

const [path, passphrase = ''] = process.argv.slice(2);
if (path === undefined) throw new Error('usage: key-check.ts -- <path> [passphrase]');

const pem = readFileSync(path, 'utf8');

const parsed = parseOpenSSHPrivateKey(pem);
console.log('parsed:', {
  kdf: parsed.kdfName,
  cipher: parsed.cipherName,
  rounds: parsed.kdfName === 'bcrypt' ? parsed.kdfRounds : 0,
  encryptedBytes: parsed.encrypted.length,
});

const started = Date.now();
try {
  const mnemonic = convertOpenSSHEd25519ToMnemonic(pem, passphrase);
  const identity = pubkeyFromMnemonic(mnemonic);
  console.log(`derived in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log('words:', mnemonic.split(' ').length);
  console.log('npub:', identity.npub);
} catch (err) {
  console.log('FAILED after', ((Date.now() - started) / 1000).toFixed(1) + 's');
  console.log('code:', keyErrorCode(err), '·', err instanceof Error ? err.message : err);
}
process.exit(0);
