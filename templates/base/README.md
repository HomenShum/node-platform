# __APP_TITLE__

__BRIEF_TEXT__

This is NodeKit's domain-blank base application. Its domain is intentionally unspecified; its product behavior is already figured out.

```text
Case -> Run -> Stage -> Artifact -> Proposal -> Approval -> Receipt
```

## Quickstart

```bash
npm install
npm run compile
npm run demo
npm run check
npm run dev
```

Open `http://127.0.0.1:4173`. The deterministic demonstration requires no account, provider key, database, or network connection.

## Specialize the application

Start with `docs/FIGURED_OUT.md` and the files in `product/`. Replace the neutral copy, artifact renderer, guided stages, domain tools, validators, and fixtures only after researching the real user journey. Do not replace the proposal, approval, version-conflict, safe-failure, or receipt semantics.

Convex is the preferred first managed backend. The browser consumes NodeKit view models, not Convex documents, so another conforming backend can implement the same observable lifecycle later.
