Most coding agents stop when the code compiles.

We spent today testing what happens when the agent has to carry the work all the way to proof.

NodeKit v0.2.0 now turns an empty directory into a complete, inspectable agent application. In its deterministic acceptance run, it generated two different apps, installed them, compiled each definition twice, ran the workflows and evaluations, and verified their receipts in 37.2 seconds.

Then we pushed the contract into harder products:

• A synthetic small-business lending deployment lab passed a bounded live-provider call, adversarial browser tests, reload recovery, proposal review, and export/reopen. It is local-ready, not production-proven.

• An Agentic RL research lab exported protected trajectories and a blind heldout evaluation. Its strict privacy-preserving live route returned 404, so the system stopped: no fallback, no retry, no tokens, no cost. That failure is part of the proof.

• Founder Quest Graph is now live as a read-only synthetic product: a source-backed map that explains what applies, what blocks progress, who has authority, and what evidence proves completion. All 15 hosted checks passed across four isolated desktop/mobile light/dark contexts, with zero browser, network, or cross-origin errors. Its unified release receipt is production-certified, release-ready, and hosted-deployment-certified. The suite passed 18/18 tests; a fresh Windows worktree verified all 25 artifact hashes byte-for-byte; and the final independent re-audit found zero remaining issues. It performs no durable writes or remote Neo4j writes, and it proves no external approval.

Anthropic's rare-disease research grant announcement gave us a live external scenario: could NodeKit help a researcher map current work, find the real novelty gap, design an executable benchmark, and prepare the application without pretending synthesis proves biology?

The architecture increasingly looks like Carlos E. Perez's “graph of loops”: research, build, evaluation, proof, presentation, distribution, feedback, and memory watching one another. But the graph is only honest when it stays anchored to sources, commits, executed tests, public URLs, exports, and real user outcomes.

This deck and walkthrough are themselves part of the benchmark. NodeKit has directed the research and product proofs; the regenerated media and browser-assisted publication receipts remain separate gates.

NodeKit is independent and is not affiliated with or endorsed by Anthropic or Casca.

Bring one consequential workflow. Then inspect the proof instead of trusting the pitch.

Demo: https://founder-quest-graph.vercel.app/
Founder Quest release and proof: https://github.com/HomenShum/founder-quest-graph/releases/tag/v0.1.1-production-certified
NodeKit source release: https://github.com/HomenShum/node-platform/releases/tag/v0.2.0

#AgentEngineering #RareDiseaseResearch
