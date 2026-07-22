# Supabase managed profile

Supabase implements NodeKit's PostgreSQL semantics with Auth identity, Row Level Security, Storage, Realtime Broadcast/Presence, Queues, and Cron. `001_profile.sql` refuses anonymous cross-tenant reads and writes; application RPC wrappers must set `owner_id` from the authenticated principal rather than accept it as untrusted client authority.

This profile declares the intended managed mapping. Live Auth, Storage, Realtime, Queue, and Cron conformance still requires a provisioned Supabase project and deployment-bound receipts.
