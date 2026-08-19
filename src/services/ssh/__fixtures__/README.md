# Test fixtures

Throwaway Ed25519 keys generated solely for the test suite. They are committed
on purpose and protect nothing — never reuse them, and never point a real
identity at them.

| File                            | Passphrase           | Why it exists                                                                                                                                                                                             |
| ------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `encrypted-ed25519.pem`         | `test-passphrase`    | The equivalence vector. usdt-pay's original React Native `ssh-service.ts` derives the same mnemonic from this key, so a green test means the Buffer-free browser port is faithful.                        |
| `encrypted-unicode-ed25519.pem` | `pässwörd-ünïcode-✓` | Regression guard for the `passlen` fix. The reference implementation **fails** on this key with `Invalid checkints - wrong passphrase`, because it passed a UTF-16 code-unit count alongside UTF-8 bytes. |
| `unencrypted-ed25519.pem`       | _(none)_             | Must be refused at import.                                                                                                                                                                                |

Regenerated with:

```sh
ssh-keygen -t ed25519 -a 4 -N '<passphrase>' -C '<comment>' -f <out>
```

`-a 4` keeps bcrypt rounds low so the suite stays fast; real keys use far more.
