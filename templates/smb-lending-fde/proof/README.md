# Generated proof artifacts

Gate receipts are intentionally ignored by Git. Run `npm run demo`, `npm run eval`,
`npm run benchmark`, and `npm run proof` from a clean committed candidate to recreate
hash-bound local proof. `npm run proof` invokes the receipt verifier and fails closed
when a gate receipt, fixture hash, compiled identity, or candidate commit diverges.
