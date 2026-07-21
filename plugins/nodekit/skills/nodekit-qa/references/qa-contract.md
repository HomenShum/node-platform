# NodeKit QA contract

Every QA run records:

- repository, commit, config hash, environment, and deployment identity;
- the user journey and acceptance criteria;
- exact fixtures, account/workspace class, viewport, and browser;
- deterministic checks and their exit status;
- runtime run IDs, tool/agent events, policies, artifacts, versions, and receipts;
- console and network health;
- screenshots or video tied to the tested revision;
- export/reopen and independent validation results when applicable;
- discovered issues, repairs, reruns, and remaining limitations.

The browser surface, runtime event stream, durable state, and exported artifact
must describe the same run. Fail closed when those identities diverge.

Risky writes, production deployments, paid resource activation, publication,
and destructive cleanup still require the authority defined by the host project.
