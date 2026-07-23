# NodeKit base agentic UI QA

Mode: SANDBOX DOGFOOD

Target: a fresh domain-blank application generated from the current NodeKit source.

## Journey results

| Journey | Result | Evidence |
|---|---|---|
| A0 smoke | PASS | Six light/dark desktop/tablet/mobile PNGs; UTF-8, zero console errors, zero horizontal overflow |
| A1 private core creation | PASS | `proposal-desktop.png`; canonical artifact remains v1 while proposal is pending |
| A2 live AI | SKIPPED | The neutral base deliberately has no live provider or egress claim |
| A3 provenance | PASS | Pending proposal shows base version; completion shows artifact v2 and receipt digest |
| A4 output/share | PARTIAL | Content-addressed receipt exists; export/deployment are intentionally not implemented |
| A5 themes/access | PASS | Six viewport/theme artifacts, semantic landmarks, skip link, focus-visible rules, reduced-motion rule |
| A6 adversarial | PASS | Second proposal while one is pending returns HTTP 400; one approval advances v1 to v2 exactly once |

## Finding

FINDING 1 · P2 · dark-theme contrast

Symptom: the initial dark render made the hero description too faint. Root cause: `.lede` used a hard-coded light-theme gray instead of the shared muted token. Evidence: first `desktop-dark.png` visual inspection. Fix: bind `.lede` to `var(--muted)`. Re-verify: current `desktop-dark.png` and `mobile-dark.png`.

## Agentic UI Bar

| B1 | B2 | B3 | B4 | B5 | B6 | B7 | B8 | B9 | B10 | B11 |
|---|---|---|---|---|---|---|---|---|---|---|
| 2 | 1 | 2 | 2 | 1 | 2 | 1 | 2 | 2 | 1 | 2 |

The base is intentionally not a live AI product, so model/cost/token attribution is not fabricated. The next product-level targets are visible exception recovery, explicit restore/undo, richer receipt inspection, and domain-specific content quality after specialization.

## Gate artifacts

- `desktop-light.png`
- `desktop-dark.png`
- `tablet-light.png`
- `tablet-dark.png`
- `mobile-light.png`
- `mobile-dark.png`
- `proposal-desktop.png`
- `completed-desktop.png`
- `completed-mobile-dark.png`
- `pixels.json`

The structural factory receipt is `proof/factory-acceptance.json`; its candidate is separate from this rendered sandbox and is bound to its own compiled application hash.
