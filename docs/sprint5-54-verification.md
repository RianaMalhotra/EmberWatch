# Sprint 5 #54 — Historical Fire Records Verification

This guide describes how to manually verify the unified historical fire records feature, including its API, Explore interface, staff navigation, and Investigation Lab case studies.

## 1. Prerequisites

Before testing, confirm that:

- The backend is running with its required database and Supabase environment configuration.
- The frontend is running and configured to communicate with the backend.
- The database migration `20261126000000_add_fire_report_ended_at.sql` has been applied.
- The database contains at least one NASA FIRMS detection in the selected date and geographic range.
- The database contains an eligible community report in the selected date and geographic range.
- For staff-only checks, a staff account is configured and authorized.

Do not include passwords, API keys, access tokens, or other secrets in test evidence.

## 2. Backend API verification

Endpoint:

`GET /api/fires/history`

Example request:

```bash
curl -G http://localhost:5000/api/fires/history \
  --data-urlencode 'south=45' \
  --data-urlencode 'north=55' \
  --data-urlencode 'west=-125' \
  --data-urlencode 'east=-110' \
  --data-urlencode 'start=2025-07-01T00:00:00Z' \
  --data-urlencode 'end=2025-08-01T00:00:00Z' \
  --data-urlencode 'limit=200'
```

Verify that:

- [ ] A valid request returns HTTP 200.
- [ ] The response contains `status`, `filters`, `truncated`, and `data`.
- [ ] Results can include both `satellite_detection` and `community_report` records when both sources have matching data.
- [ ] Results are ordered newest first.
- [ ] Spatial and date filters restrict the returned records as expected.
- [ ] Community report records include their current review status and `ended_at` timestamp where available, without exposing internal moderation audit history.
- [ ] Satellite records include available observation metadata, such as confidence, satellite, instrument, and FRP.
- [ ] Missing source-specific metadata is returned as unavailable rather than fabricated.
- [ ] Community report coordinates are rounded to two decimal places in the public response.

### Invalid request checks

- [ ] Omitting a required spatial or time parameter returns HTTP 400.
- [ ] Supplying invalid coordinates or timestamps returns HTTP 400.
- [ ] Supplying timestamps without timezone information returns HTTP 400.
- [ ] A database/query failure returns HTTP 503.

### Result limit check

Use `limit=1` when the selected range contains multiple matching records.

- [ ] The response contains no more than one record.
- [ ] `truncated` indicates whether additional matching records exist.

## 3. Historical Fire Records explorer

Open the application and navigate to **Explore → Historical Fire Records**.

- [ ] The historical records section loads.
- [ ] Selecting a region and date range retrieves matching records.
- [ ] Satellite detections and eligible community reports are distinguishable by event type or source.
- [ ] The table displays available event time, location, source, confidence, status, and end-time information.
- [ ] Missing values are displayed gracefully, such as `—` or `Not provided`.
- [ ] Community report locations are approximate, consistent with the public coordinate-rounding policy.
- [ ] Records marked `out` remain available in historical records.
- [ ] Unverified, verified, and rejected community reports are not shown in the public historical records.

## 4. Staff navigation to historical records

Sign in using an authorized staff account and open the staff report queue.

For a report with status `out`:

- [ ] The staff queue displays the report and its current status.
- [ ] Selecting **View in historical records** navigates to Explore.
- [ ] The historical explorer applies the report's approximate geographic area and observation date.
- [ ] The corresponding historical record is highlighted or selected.
- [ ] Returning to the staff section does not unexpectedly remove the staff interface.

## 5. Investigation Lab case studies

In the Historical Fire Records explorer, select an eligible record using **Use as case study**.

- [ ] The application navigates to the Investigation Lab.
- [ ] The Case study tab is selected automatically.
- [ ] The selected event's available date, coordinates, source, and metadata are displayed.
- [ ] Missing metadata does not cause rendering errors.

For a community report:

- [ ] The case study identifies the event as a community report.
- [ ] The current review status is displayed; internal moderation status transitions and staff identifiers are not displayed.
- [ ] The recorded end time is displayed when available.
- [ ] The location privacy explanation is visible.

For a satellite detection:

- [ ] The case study identifies the event as a satellite observation.
- [ ] Available satellite, instrument, confidence, confidence class, and FRP metadata are displayed.
- [ ] The interface explains that satellite confidence describes the observation and does not independently confirm a wildfire.

- [ ] The **Open Explore map** action returns to the Explore map.

The case study is an educational historical-event view. It does not simulate wildfire spread or predict fire development.

## 6. Access-control checks

- [ ] Public historical records do not expose unverified, verified, or rejected community reports.
- [ ] Staff report queue and moderation endpoints reject requests without valid staff authorization.
- [ ] Staff-only report audit information (including status-transition history and staff identifiers) is not exposed through public endpoints.

## 7. Automated verification

Run the backend test suite from the repository root:

```powershell
pytest backend/tests -q
```

Build the frontend from the `frontend` directory:

```powershell
npm run build
```

Record the results below after running the commands on the branch being reviewed.

| Check | Result |
|---|---|
| Backend test suite | Pending |
| Frontend production build | Pending |
| Manual API verification | Pending |
| Historical explorer verification | Pending |
| Staff navigation verification | Pending |
| Investigation Lab case-study verification | Pending |

## 8. Scope and known limitations

- Historical records combine stored NASA FIRMS detections and eligible community reports; they do not represent every fire in an area.
- Community report coordinates are rounded in public historical responses.
- Satellite confidence is observation confidence, not a wildfire probability or risk score.
- Confirmed community reports are not automatically incorporated into the wildfire risk model. That work is tracked separately under issue #57.
- Investigation Lab case studies provide historical context and provenance, not wildfire-spread simulation.