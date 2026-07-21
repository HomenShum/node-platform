# Convex managed profile

Convex is NodeKit's preferred first managed backend, but the neutral demo stays on memory so it works without an account.

Before enabling Convex:

1. research the real workflow and owner/auth boundary;
2. install only the required Convex features and Components;
3. keep authentication in application-owned wrapper functions;
4. map NodeKit Caseflow semantics to transactional mutations and reactive queries;
5. run the same adapter conformance suite;
6. collect browser and deployment proof from the exact tested commit.

Do not create a parallel conversation, workflow, workpool, RAG, presence, or streaming subsystem when the corresponding Convex Component satisfies the requirement.
