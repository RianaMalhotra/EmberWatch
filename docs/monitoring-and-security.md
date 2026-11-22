# Security, monitoring and Ask Ash

The security workflow runs on pull requests to main and audits Python packages,
production npm dependencies, secrets, and unauthenticated access to common staff
routes. The staff regression guard does not prove role-based authorization.
When PR #104 is merged, add tests for each actual staff endpoint using staff,
ordinary-user, expired, and absent tokens.

The scheduled refresh watchdog checks for a successful FIRMS refresh workflow
within seven hours. A failing watchdog job can generate GitHub Actions failure
notifications for maintainers who have enabled them. It monitors successful
workflow completion, not the number of fires detected. NASA FIRMS upstream errors
already fail the refresh workflow and appear in its logs.

GET /api/health/freshness reports latest_detection_at and latest_insert_at
separately, with a stale-ingestion flag. An absence of new detections is not
proof of a failed refresh, so interpret this flag alongside the watchdog.

Ask Ash remembers the last named or selected area within the mounted browser
component to resolve follow-up questions. New chat clears the context; the
emberwatch:logout browser event also clears it when the authentication UI
dispatches that event. The assistant must never treat conversation history as
verified fire data. No conversation history is stored server-side.

PRA6: risk scoring, malformed detection and freshness behavior have regression
tests in backend/tests. PRA4 usability testing remains assigned to the other
team member; this work does not substitute for observations from two real users.
