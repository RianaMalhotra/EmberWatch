
import { useEffect, useState } from "react";
import { fetchFireHistory } from "../services/detectionApi";
import {
  formatConfidence,
  formatCoordinates,
  formatDetectionTime,
} from "../utils/detectionFormat";

const REGION_LABELS = {
  canada: "Canada (bounding box)",
  west: "Western Canada (approximate)",
  central: "Central Canada (approximate)",
  east: "Eastern Canada (approximate)",
  custom: "Selected report vicinity",
};

const REGIONS = {
  canada: { south: 42, north: 83, west: -141, east: -52 },
  west: { south: 48, north: 60, west: -140, east: -110 },
  central: { south: 49, north: 60, west: -110, east: -80 },
  east: { south: 42, north: 60, west: -80, east: -52 },
};

// The historical endpoint requires explicit UTC instants.
// The end instant is exclusive.
function utcDay(day) {
  return `${day}T00:00:00.000Z`;
}

function formatHistoryTime(value) {
  if (!value) return "—";
  return formatDetectionTime(value, "UTC");
}

function formatEventType(eventType) {
  return eventType === "community_report"
    ? "Community report"
    : "Satellite detection";
}

function formatStatus(status) {
  if (!status) return "—";

  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, character => character.toUpperCase());
}

export default function DetectionHistoryExplorer({
  onExplore,
  searchRequest,
  onUseCaseStudy,
}) {
  const [region, setRegion] = useState("canada");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [state, setState] = useState("idle");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState(null);
  const [revision, setRevision] = useState(0);
  const [customBounds, setCustomBounds] = useState(null);
  const [selectedRecordId, setSelectedRecordId] = useState(null);

  useEffect(() => {
    if (!query) return;

    let active = true;

    setState("loading");
    setResult(null);
    setError("");

    fetchFireHistory({
      south: query.south,
      north: query.north,
      west: query.west,
      east: query.east,
      start: query.start,
      end: query.end,
      limit: query.limit,
    })
      .then(data => {
        if (!active) return;
        setResult(data);
        setState("ready");
      })
      .catch(err => {
        if (!active) return;
        setError(err.message || "Historical fire records could not be loaded.");
        setState("error");
      });

    return () => {
      active = false;
    };
  }, [query, revision]);

  useEffect(() => {
    if (!searchRequest) return;

    const latitude = Number(searchRequest.latitude);
    const longitude = Number(searchRequest.longitude);
    const observed = new Date(searchRequest.observedAt);

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Number.isNaN(observed.getTime())
    ) {
      return;
    }

    const day = observed.toISOString().slice(0, 10);
    const bounds = {
      south: Math.max(-90, latitude - 0.25),
      north: Math.min(90, latitude + 0.25),
      west: Math.max(-180, longitude - 0.25),
      east: Math.min(180, longitude + 0.25),
    };

    setCustomBounds(bounds);
    setRegion("custom");
    setStart(day);
    setEnd(day);
    setSelectedRecordId(String(searchRequest.reportId));

    setQuery({
      ...bounds,
      region: "custom",
      start: utcDay(day),
      end: new Date(
        Date.parse(utcDay(day)) + 86400000
      ).toISOString(),
      limit: 200,
    });

    setRevision(n => n + 1);
  }, [searchRequest]);

  useEffect(() => {
    if (state !== "ready" || !selectedRecordId) return;

    const element = document.getElementById(
      `history-community_report-${selectedRecordId}`
    );

    element?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [state, result, selectedRecordId]);

  const invalid =
    !start ||
    !end ||
    !Number.isFinite(Date.parse(utcDay(start))) ||
    !Number.isFinite(Date.parse(utcDay(end))) ||
    start > end;

  const records = result?.data ?? [];

  return (
    <section
      className="ew-analytics-panel ew-history"
      aria-label="Historical fire records"
    >
      <h2>Historical fire records</h2>

      <p>
        Search historical NASA FIRMS satellite detections and confirmed
        community-reported fires by region and UTC date. Satellite hotspots
        are observations, not necessarily confirmed fires.
      </p>

      <form
        onSubmit={event => {
          event.preventDefault();

          if (!invalid) {
            setQuery({
              ...(region === "custom" && customBounds
                  ? customBounds
                  : REGIONS[region]),
              region,
              start: utcDay(start),
              end: new Date(
                Date.parse(utcDay(end)) + 86400000
              ).toISOString(),
              limit: 200,
            });

            setRevision(n => n + 1);
          }
        }}
      >
        <div className="ew-analytics-controls">
          <label>
            Region
            <select
              value={region}
              onChange={event => setRegion(event.target.value)}
            >
              {region === "custom" && (
                <option value="custom">Selected report vicinity</option>
              )}

              <option value="canada">Canada (bounding box)</option>
              <option value="west">Western Canada (approximate)</option>
              <option value="central">Central Canada (approximate)</option>
              <option value="east">Eastern Canada (approximate)</option>
            </select>
          </label>

          <label>
            From (UTC date)
            <input
              aria-label="History start date"
              type="date"
              value={start}
              onChange={event => setStart(event.target.value)}
              required
            />
          </label>

          <label>
            Through (UTC date)
            <input
              aria-label="History end date"
              type="date"
              value={end}
              min={start || undefined}
              onChange={event => setEnd(event.target.value)}
              required
            />
          </label>
        </div>

        {start && end && start > end && (
          <p role="alert">
            The end date must be on or after the start date.
          </p>
        )}

        <div className="ew-analytics-actions">
          <button type="submit" disabled={invalid || state === "loading"}>
            {state === "loading" ? "Searching history…" : "Search history"}
          </button>

          <button type="button" onClick={onExplore}>
            Open current map
          </button>
        </div>
      </form>
      
      {state === "idle" && (
        <p>
          Select a region and date range to search historical fire records.
        </p>
      )}

      {state === "loading" && (
        <p role="status">Loading historical fire records…</p>
      )}

      {state === "error" && (
        <p role="alert">
          History unavailable: {error} Existing map and risk information
          remain accessible.
        </p>
      )}

      {state === "ready" && result && (
        <>
          <p>
            Results for {REGION_LABELS[query.region]} ·{" "}
            {query.start.slice(0, 10)} through{" "}
            {new Date(
              Date.parse(query.end) - 86400000
            ).toISOString().slice(0, 10)}{" "}
            (UTC).
          </p>

          <p role="status">
            {records.length} historical records returned.
            {result.truncated
              ? " The result limit was reached: narrow your region or date range to see more."
              : ""}
          </p>

          {records.length === 0 ? (
            <p>
              No historical records matched this region and date range.
              This does not establish that no fires occurred.
            </p>
          ) : (
            <div className="ew-analytics-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Observed</th>
                    <th>Location</th>
                    <th>Type</th>
                    <th>Source</th>
                    <th>Confidence</th>
                    <th>Status</th>
                    <th>End time</th>
                    <th>Lifecycle</th>
                    <th>Investigation</th>
                  </tr>
                </thead>

                <tbody>
                  {records.map((record, index) => {
                    const isReport =
                      record.event_type === "community_report";

                    const statusHistory = Array.isArray(record.status_history)
                      ? record.status_history
                      : [];

                    return (
                      <tr
                        id={`history-${record.event_type}-${record.id}`}
                        key={`${record.event_type}-${record.id ?? index}`}
                        className={
                          isReport && String(record.id) === selectedRecordId
                            ? "ew-history-selected"
                            : undefined
                        }
                      >
                        <td>{formatHistoryTime(record.event_at)}</td>

                        <td>
                          {formatCoordinates(
                            record.latitude,
                            record.longitude
                          )}
                          {isReport && (
                            <small>Approximate location</small>
                          )}
                        </td>

                        <td>{formatEventType(record.event_type)}</td>

                        <td>
                          {record.source || (
                            isReport ? "Community" : "NASA FIRMS"
                          )}
                        </td>

                        <td>
                          {record.confidence != null
                            ? formatConfidence(record.confidence)
                            : "—"}
                          {record.confidence_class && (
                            <small>
                              {formatStatus(record.confidence_class)}
                            </small>
                          )}
                        </td>

                        <td>
                          {isReport
                            ? formatStatus(record.review_status)
                            : "—"}
                        </td>

                        <td>
                          {isReport
                            ? formatHistoryTime(record.ended_at)
                            : "—"}
                        </td>

                        <td>
                          {isReport && statusHistory.length > 0 ? (
                            <details>
                              <summary>
                                View timeline ({statusHistory.length})
                              </summary>

                              <ol>
                                {statusHistory.map((entry, timelineIndex) => (
                                  <li key={`${record.id}-${timelineIndex}`}>
                                    <strong>
                                      {formatStatus(entry.old_status)}
                                      {" → "}
                                      {formatStatus(entry.new_status)}
                                    </strong>
                                    <small>
                                      {formatHistoryTime(entry.changed_at)}
                                    </small>
                                  </li>
                                ))}
                              </ol>
                            </details>
                          ) : isReport ? (
                            "No status changes recorded"
                          ) : (
                            "—"
                          )}

                          {isReport &&
                            (record.linked_report_id ||
                              record.linked_detection_id) && (
                              <small>
                                {record.linked_report_id &&
                                  `Linked report: ${record.linked_report_id}`}
                                {record.linked_report_id &&
                                  record.linked_detection_id &&
                                  " · "}
                                {record.linked_detection_id &&
                                  `Linked detection: ${record.linked_detection_id}`}
                              </small>
                            )}
                        </td>

                        <td>
                          <button
                            type="button"
                            onClick={() => onUseCaseStudy?.(record)}
                          >
                            Use as case study →
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p>
            Satellite confidence describes the observation, not the modeled
            environmental risk score. Community report locations are
            approximate to protect reporter privacy.
          </p>
        </>
      )}
    </section>
  );
}
