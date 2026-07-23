# __APP_TITLE__ coding-agent entrypoint

Read these files in order before changing the product:

1. `docs/FIGURED_OUT.md`
2. `docs/KNOWLEDGE_EVOLUTION.md`
3. `docs/EVOLUTION.md`
4. `product/BRIEF.md`
5. `product/USER_JOURNEY.md`
6. `product/SERVICE_BLUEPRINT.md`
7. `product/EXPERIENCE.yaml`
8. `nodeagent.yaml`

Keep the application blank in domain until the real user workflow is researched. Preserve the universal `Case -> Run -> Stage -> Artifact -> Proposal -> Approval -> Receipt` behavior and the in-memory deterministic demonstration.

- Do not let generated work overwrite a canonical artifact without a base-version check and decision.
- Keep the primary artifact above chat, tools, and traces in the information hierarchy.
- Make the current stage, next action, and next-action owner visible.
- Preserve valid state through cancellation, conflicts, and failures.
- Never put secrets in source, manifests, browser bundles, logs, or receipts.
- Ask before paid activation, production writes, deployment, or publication.
- Run `npm run compile`, `npm run check`, `npm run eval`, and `npm run proof` after lifecycle changes.

## Canonical artifact interoperability

Keep this contract backend-neutral. A generated application that can complete a case must make its canonical result independently inspectable without requiring a Convex, Supabase, SQL, or in-memory client:

- Render the canonical artifact at `#artifact` and keep these attributes synchronized with the accepted version: `data-nodekit-artifact-type`, `data-nodekit-artifact-id`, `data-nodekit-artifact-version`, and `data-nodekit-artifact-content-sha256`.
- Use a stable domain artifact type, a stable NodeKit-owned artifact ID, a positive canonical version, and the lowercase SHA-256 of the normalized canonical content. Do not derive this metadata from presentation copy.
- Preserve the user's exact submitted outcome in the canonical artifact content. A summary, task label, or chat transcript alone is not an input-to-result binding.
- Export a JSON `nodekit.portable-proof-bundle/v1` after completion. Its artifact record must contain the same type, ID, canonical version, content hash, and canonical content exposed by `#artifact`.
- Include a `nodekit.receipt/v2` whose artifact binding names that same artifact ID, version, and content hash. The downloadable bundle, rendered artifact, and receipt must describe one canonical result.
- Treat reload, reopen in a fresh browser context, download, and independent hash verification as required completion behavior. Provider-specific storage mechanics may differ; these observable guarantees may not.

When the real workflow needs durable cross-run knowledge, initialize the NodeKit Knowledge Evolution Plane rather than accumulating scattered prompt notes:

- Retrieve existing graph knowledge before broad external research.
- Research only typed gaps or contradictions.
- Anchor every durable claim to immutable source evidence.
- Propose INSERT, UPDATE, or DEPRECATE operations; never mutate the canonical graph directly.
- Require validation and explicit approval before a graph version advances.
- Use `ABSTAIN` when required evidence is missing.

Material product, architecture, or harness changes require a reviewed Evolution Ledger record with immutable evidence and scoped adoption. A generating or frontend model cannot define its own judge, proof threshold, or completion verdict.
