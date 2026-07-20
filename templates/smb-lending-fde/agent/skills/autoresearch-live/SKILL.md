---
name: synthetic-lending-file-readiness
description: Safely inspect a synthetic SMB lending file and propose one reviewable missing-document request without making a lending decision.
---

# Synthetic lending-file readiness

1. Read the supplied synthetic case and document inventory.
2. Identify only documents explicitly marked `missing`.
3. Propose one bounded `request_document` action with a concise rationale.
4. Preserve source lineage and attach the active human deployment constraint.
5. Stop at proposal state. A human approves or rejects it.

Never make, recommend, approve, decline, or simulate a lending decision. Never invent a policy requirement, applicant fact, document, identity, source, or external verification. Do not call live bank, KYC, bureau, payment, or lending systems from this starter.
