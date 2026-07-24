# Builder Journey J1 finish — a real build boundary and a themeable design language

J1 landed the Decide → Build compiler as a pure function. Two gaps kept it from being the seam a
real builder would cross: the compiler's output was never materialized into the files the Build
stage consumes, and the base template a build agent specializes shipped a designed neo-brutalist
stylesheet whose token surface was one line of eight color variables — so the design intent the
compiler emits had nothing to map onto.

## What changed

### 1. The seam is runnable

`materializeBuildPacket({ repoRoot, opportunity, packetName })` compiles an approved
`OpportunityContract` and writes the two files the Build stage reads: a
`nodekit.product-design-contract/v1` packet under `harness/frontend/product-packets/<name>.yaml`,
and the Atlas reuse query beside it. The OpportunityContract stops being an inert record and becomes
the boundary the Build stage compiles against. The packet name is validated as a short kebab slug so
it cannot escape the packet directory.

### 2. The template design language is a token vocabulary

`templates/base/apps/web/public/styles.css` shipped a coherent neo-brutalist system — hard offset
shadows, high-contrast lime/violet, tight tracking, semantic status and feedback colors — but only
eight color tokens; everything else was hardcoded and duplicated across the light and dark blocks,
so a build agent could not express or retheme the design intent through tokens. The stylesheet is
refactored into a structured 30-token vocabulary: base palette, semantic status
(idle/active/blocked/completed, theme-fixed), feedback surfaces (danger/warn/ok lines and fills, the
error box), accent surfaces, elevation (`--shadow-brand` / `--shadow-float`), and a type scale plus
radius. The dark block collapses to token reassignments plus the genuinely theme-specific
on-surface text tweaks.

## Evidence

- `test/opportunity-build-packet.test.mjs` passes 2/2: the salon owner's read-only OpportunityContract
  is compiled, written as a packet, and accepted by `compileFrontendPlan`, which carries the protected
  decisions (primaryUser, primaryJob, permissionBoundaries = nodekit; finalVerdict = nodeproof) and the
  read-only Atlas query forward; and a malicious packet name is rejected before any write.
  `test/opportunity-compiler.test.mjs` still passes 4/4. `typecheck:public` and `typecheck:component`
  are clean.
- The token refactor was verified output-identical by a computed-style harness: a fixture instancing
  54 themed selectors was rendered before and after, and `getComputedStyle`
  (backgroundColor, color, all four border colors, boxShadow, outlineColor, fontWeight, fontSize,
  fontFamily, borderWidth, borderRadius, letterSpacing) was compared in both light and dark. The final
  refactor reports 0 diffs in both themes. The harness also surfaced and corrected a latent
  inconsistency: the completed status dot was hardcoded and silently did not flip, unlike the accent;
  it is now a theme-fixed status token like the other three.

## Known limitations

- The token-preservation check was a manual computed-style audit, not a committed automated test; it
  proves this refactor preserved output but does not stand as a permanent regression guard.
- `materializeBuildPacket` produces the Build stage's inputs. It does not run the frontend tournament,
  render three directions, or generate the salon application; carrying a contract through to a rendered,
  independently certified surface remains the next step.
- No real builder has yet carried the salon case from Decide through a certified Build. The EASE verdict
  remains EASE_NOT_CERTIFIED.
