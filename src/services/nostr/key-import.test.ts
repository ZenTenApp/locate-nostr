import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { KeyError } from '@/lib/errors';

import { inspectSshKey } from './key-import';

function fixture(name: string): string {
  return readFileSync(new URL(`../ssh/__fixtures__/${name}`, import.meta.url), 'utf8');
}

describe('inspectSshKey', () => {
  it('reports an encrypted key and its round count', () => {
    // Drives the passphrase field and the time estimate in the dialog.
    expect(inspectSshKey(fixture('encrypted-ed25519.pem'))).toEqual({
      encrypted: true,
      rounds: 4,
    });
  });

  it('reports an unencrypted key as needing nothing', () => {
    // The dialog reads this to stop demanding a passphrase that does not
    // exist — it used to say "required" for every key, encrypted or not.
    expect(inspectSshKey(fixture('unencrypted-ed25519.pem'))).toEqual({
      encrypted: false,
      rounds: 0,
    });
  });

  it('still refuses text that is not a key at all', () => {
    expect(() => inspectSshKey('hello')).toThrow(KeyError);
  });
});
