# Production boundary

This generated lab is intentionally **local-only**. It has no workspace identity,
authentication, authorization, CSRF protection, or tenant isolation, so it must not
be deployed as a public web service.

The server fails closed for every `POST` request unless it is bound to a loopback
host. The optional Pi route additionally requires both loopback binding and
`NODEKIT_ENABLE_LOCAL_LIVE_PI=true`. A provider key alone is never enough.

To turn this clean-room FDE demonstration into a networked product, first replace
the filesystem session store with an authenticated workspace backend and bind every
proposal, consent, approval, artifact, and receipt to an authorized actor. That is a
separate production-hardening arc, not an unchecked deployment toggle.
