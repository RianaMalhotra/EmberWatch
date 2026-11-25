# Sprint 5 report moderation authentication

Moderation requires a valid Supabase Auth user access token (not the Supabase anon key or service-role key). The Flask server calls Supabase Auth `/auth/v1/user` to verify the token, then checks the returned user UUID against an explicit server-side allowlist. It rejects missing configuration, expired or invalid tokens, non-staff users, and Auth service failures.

Set these **backend-only** environment variables on Render:

- `SUPABASE_URL`: HTTPS URL for your Supabase project.
- `SUPABASE_ANON_KEY`: public/publishable API key accepted by the Supabase Auth endpoint.
- `REPORTS_STAFF_USER_IDS`: comma-separated UUIDs of authorized Supabase Auth users.

Never configure `REPORTS_STAFF_USER_IDS` or a service-role key in Vite/frontend environment variables. Do not use the removed `REPORTS_STAFF_TOKEN` static shared-secret approach.

The staff moderation UI now supports Supabase email/password sign-in, session refresh and sign-out. Set **frontend** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (public key only) in Vercel; do not expose the staff UUID allowlist or service-role key. Tokens are held in React component memory only, so a page reload requires sign-in again. Supabase Auth must have email/password login enabled. Signing in does not grant moderation access unless the verified user UUID is allowlisted on the backend. The server records the verified Supabase user UUID in the audit history.

**Manual verification after #52:** apply a compatible reports migration in staging; create two Supabase Auth users and allowlist only one; obtain fresh access tokens; confirm unauthorized, expired and non-allowlisted tokens receive HTTP 403; confirm authorized updates create an audit record attributed to that UUID; confirm rejected/out reports disappear from public map; confirm Auth downtime fails closed; verify rollback and CI. Never merge solely on mocked unit tests.


## Status semantics and transitions

`verified` means staff reviewed the submission and consider it credible, but have not confirmed the fire. `confirmed` means staff have corroborated the fire. Neither implies an official agency alert. Staff may reject an unverified or reviewed report; operational statuses describe active fire conditions and may change as conditions evolve. Closed reports must be reopened deliberately: rejected → verified; out → confirmed. Same-status requests are no-ops. Invalid changes return HTTP 409 without updating the report or audit history.

| Current status | Allowed next statuses |
| --- | --- |
| unverified | verified, confirmed, rejected |
| verified | confirmed, rejected |
| confirmed | out_of_control, being_held, under_control, out, rejected |
| out_of_control | being_held, under_control, out, rejected |
| being_held | out_of_control, under_control, out, rejected |
| under_control | out_of_control, being_held, out, rejected |
| out | confirmed |
| rejected | verified |
