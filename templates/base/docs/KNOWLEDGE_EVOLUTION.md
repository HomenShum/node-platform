# Knowledge evolution

This domain-blank application can add persistent project knowledge without changing its Caseflow
authority model.

```bash
npx nodekit graph init --repo-root .
npx nodekit graph inspect --repo-root .
```

The graph is optional until the researched workflow requires cross-run knowledge. Once enabled,
agents retrieve before broad search, represent missing knowledge as typed gaps, anchor durable
claims to immutable sources, and submit graph patches for validation and explicit approval.

The graph never writes directly to application artifacts, Caseflow state, source code, benchmarks,
or proof receipts. `DEPRECATE` preserves history; destructive deletion is not supported.
