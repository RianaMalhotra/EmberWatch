import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AshDetective from "./AshDetective.jsx";

const areas = [
  { name: "Kelowna", latitude: 49.89, longitude: -119.49, risk_score: 72, risk_level: "HIGH", is_complete: true, observed_at: "2026-11-01T00:00:00Z" },
  { name: "Toronto", latitude: 43.65, longitude: -79.38, risk_score: 24, risk_level: "LOW", is_complete: true, observed_at: "2026-11-01T00:00:00Z" },
];
const originalFetch = globalThis.fetch;

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
function openChat() {
  fireEvent.click(screen.getByRole("button", { name: /chat with ash detective/i }));
}
function send(question) {
  fireEvent.change(screen.getByRole("textbox", { name: /ask ash detective/i }), { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: /send message/i }));
}
function mockResponse(answer) {
  return { ok: true, json: async () => ({ answer }) };
}

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => mockResponse("Verified only against the supplied map snapshot."));
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("Ask Ash detection evidence", () => {
  it("sends only a bounded observation sample with provenance fields", async () => {
    const detections = Array.from({ length: 25 }, (_, index) => ({
      latitude: 49.8, longitude: -119.4, confidence: 82,
      classification: "potential_wildfire", timestamp: "2026-11-01T00:00:00Z", id: index,
    }));
    render(<AshDetective areas={areas} detections={detections} />);
    openChat();
    send("Explain these satellite detections");
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    const context = JSON.parse(globalThis.fetch.mock.calls[0][1].body).context;
    expect(context.detection_count).toBe(25);
    expect(context.detections).toHaveLength(20);
    expect(context.detections[0]).toEqual({
      latitude: 49.8, longitude: -119.4, confidence: 82,
      classification: "potential_wildfire", timestamp: "2026-11-01T00:00:00Z",
    });
  });
});

describe("Ask Ash session security", () => {
  it("remembers area context for a follow-up and clears it on new chat", async () => {
    render(<AshDetective areas={areas} />);
    openChat();
    send("What is the risk in Kelowna?");
    await screen.findByText("Verified only against the supplied map snapshot.");
    send("What about its risk?");
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
    const followUp = JSON.parse(globalThis.fetch.mock.calls[1][1].body);
    expect(followUp.context.selected_area).toBe("Kelowna");
    expect(followUp.history).toHaveLength(2);

    await screen.findAllByText("Verified only against the supplied map snapshot.");
    fireEvent.click(screen.getByRole("button", { name: /start new conversation/i }));
    send("How current is the data?");
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(3));
    const fresh = JSON.parse(globalThis.fetch.mock.calls[2][1].body);
    expect(fresh.context.selected_area).toBeNull();
    expect(fresh.history).toEqual([]);
  });

  it("clears history and area on logout", async () => {
    render(<AshDetective areas={areas} />);
    openChat();
    send("What's the risk in Kelowna?");
    await screen.findByText("Verified only against the supplied map snapshot.");
    act(() => { window.dispatchEvent(new Event("emberwatch:logout")); });
    expect(screen.getByRole("log").querySelector(".ash-message.ash-user")).toBeNull();
    send("How current is the data?");
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
    const request = JSON.parse(globalThis.fetch.mock.calls[1][1].body);
    expect(request.history).toEqual([]);
    expect(request.context.selected_area).toBeNull();
  });

  it("discards an in-flight response after logout and accepts a new session response", async () => {
    const old = deferred();
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => old.promise)
      .mockImplementationOnce(async () => mockResponse("Fresh session reply"));
    render(<AshDetective areas={areas} />);
    openChat();
    send("What's the risk in Kelowna?");
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    act(() => { window.dispatchEvent(new Event("emberwatch:logout")); });
    send("What is the risk in Toronto?");
    await screen.findByText("Fresh session reply");
    old.resolve(mockResponse("Stale private reply"));
    await waitFor(() => expect(screen.queryByText("Stale private reply")).toBeNull());
    expect(screen.getByText("Fresh session reply")).toBeTruthy();
    const transcript = screen.getByRole("log");
    const userMessages = [...transcript.querySelectorAll(".ash-message.ash-user")].map((node) => node.textContent);
    expect(userMessages).toEqual(["What is the risk in Toronto?"]);
    expect(transcript.textContent).not.toContain("What\'s the risk in Kelowna?");
  });
});
