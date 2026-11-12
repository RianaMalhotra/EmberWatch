import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReportFire from "./ReportFire";
import { submitReport } from "../services/reportApi";

vi.mock("../services/reportApi", () => ({ submitReport: vi.fn(), REPORTS_ENABLED: false }));

// Leaflet needs a real browser; a fake map lets tests "tap" a location.
const mapClick = vi.hoisted(() => ({ handler: null }));
vi.mock("react-leaflet", async () => {
  const React = await import("react");
  return {
    MapContainer: ({ children }) => React.createElement("div", null,
      React.createElement("button", {
        type: "button",
        onClick: () => mapClick.handler?.({ latlng: { lat: 48.38, lng: -89.25 } }),
      }, "Tap map"),
      children),
    TileLayer: () => null,
    CircleMarker: () => React.createElement("span", { "data-testid": "pin" }),
    useMap: () => ({ setView: () => {} }),
    useMapEvents: (handlers) => { mapClick.handler = handlers.click; return null; },
  };
});

function mockGeolocation(success) {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (ok, fail) => (success
        ? ok({ coords: { latitude: 49.888, longitude: -119.496 } })
        : fail(new Error("denied"))),
    },
  });
}

beforeEach(() => mockGeolocation(true));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function fillToReview(user) {
  await user.click(screen.getByRole("button", { name: "Use my current location" }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("button", { name: "Smoke" }));
  await user.type(screen.getByLabelText(/Anything else/), "Grey smoke near the highway");
  await user.click(screen.getByRole("button", { name: "Next" }));
}

describe("Report a Fire (#51)", () => {
  it("shows the emergency disclaimer and blocks Next until a location is set", async () => {
    render(<ReportFire onClose={() => {}} />);
    expect(screen.getByText(/not an emergency service/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("lets the user tap the map when location is denied", async () => {
    mockGeolocation(false);
    const user = userEvent.setup();
    render(<ReportFire onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Use my current location" }));
    expect(screen.getByRole("status")).toHaveTextContent("Location isn't available");

    await user.click(screen.getByRole("button", { name: "Tap map" }));
    expect(screen.getByText(/Point on map \(48\.3800° N, 89\.2500° W\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("requires a valid time for 'Earlier today'", async () => {
    const user = userEvent.setup();
    render(<ReportFire onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Use my current location" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Flames" }));
    await user.click(screen.getByRole("button", { name: "Earlier today" }));

    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await user.type(screen.getByLabelText("Hour"), "25");
    await user.type(screen.getByLabelText("Minutes"), "00");
    expect(screen.getByRole("alert")).toHaveTextContent("Hour must be 0–23");
  });

  it("reviews, submits once, and says the report is awaiting review", async () => {
    submitReport.mockResolvedValue({ id: 42, reviewStatus: "unverified" });
    const user = userEvent.setup();
    render(<ReportFire onClose={() => {}} enabled />);
    await fillToReview(user);

    expect(screen.getByText(/Your current location \(49\.8880° N, 119\.4960° W\)/)).toBeInTheDocument();
    expect(screen.getByText("Smoke")).toBeInTheDocument();
    expect(screen.getByText("Just now")).toBeInTheDocument();
    expect(screen.getByText(/not sent to 911/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Submit report" }));

    expect(submitReport).toHaveBeenCalledTimes(1);
    expect(submitReport.mock.calls[0][0]).toMatchObject({
      latitude: 49.888, longitude: -119.496, location_source: "gps",
      observed_type: "smoke", description: "Grey smoke near the highway",
    });
    expect(screen.getByRole("heading", { name: "Report received" })).toBeInTheDocument();
    expect(screen.getByText("awaiting review")).toBeInTheDocument();
    expect(screen.queryByText(/on the map/i)).not.toBeInTheDocument(); // map display is not built yet
    expect(screen.getByText("Report ID: 42")).toBeInTheDocument();
  });

  it("keeps the answers and shows an error if saving fails", async () => {
    submitReport.mockRejectedValue(new Error("The report could not be saved (error 503). Please try again."));
    const user = userEvent.setup();
    render(<ReportFire onClose={() => {}} enabled />);
    await fillToReview(user);

    await user.click(screen.getByRole("button", { name: "Submit report" }));

    expect(screen.getByRole("alert")).toHaveTextContent("error 503");
    expect(screen.getByRole("heading", { name: "Check your report" })).toBeInTheDocument();
    expect(screen.getByText("Smoke")).toBeInTheDocument();
  });

  it("runs as a preview until reporting is enabled: nothing is sent", async () => {
    const user = userEvent.setup();
    render(<ReportFire onClose={() => {}} />); // VITE_ENABLE_REPORTS not set
    expect(screen.getByText(/reports can't be sent yet/)).toBeInTheDocument();

    await fillToReview(user);
    const send = screen.getByRole("button", { name: "Sending not available yet" });
    expect(send).toBeDisabled();
    await user.click(send);

    expect(submitReport).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Submit report" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Report received" })).not.toBeInTheDocument();
  });

  it("shows no preview note when reporting is enabled", () => {
    render(<ReportFire onClose={() => {}} enabled />);
    expect(screen.queryByText(/reports can't be sent yet/)).not.toBeInTheDocument();
  });
});
