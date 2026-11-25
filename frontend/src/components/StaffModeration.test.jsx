import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StaffModeration from "./StaffModeration";
import { fetchStaffReports, fetchReportAudit, moderatePublicReport } from "../services/reportApi";
import { signInStaff, signOutStaff } from "../services/staffAuth";

// All identities, reports and API calls are mocked. These tests never contact Supabase.
vi.mock("../services/reportApi", () => ({
  fetchStaffReports: vi.fn(),
  fetchReportAudit: vi.fn(),
  moderatePublicReport: vi.fn(),
}));
vi.mock("../services/staffAuth", () => ({
  signInStaff: vi.fn(),
  signOutStaff: vi.fn(),
  refreshStaff: vi.fn(),
  staffAuthConfigured: true,
}));

const account = (token, email) => ({
  access_token: token,
  refresh_token: "mock-refresh",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { email },
});
const testReport = {
  id: 7, review_status: "unverified", observed_type: "smoke",
  description: "Test fixture only", latitude: 49, longitude: -119,
};

beforeEach(() => {
  vi.clearAllMocks();
  signOutStaff.mockResolvedValue({});
  fetchReportAudit.mockResolvedValue([]);
  moderatePublicReport.mockResolvedValue({});
});
afterEach(() => cleanup());

async function login(user, email = "staff@example.test") {
  await user.type(screen.getByRole("textbox", { name: "Staff email" }), email);
  await user.type(screen.getByLabelText("Staff password"), "mock-password");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("Staff and non-staff moderation views (mocked, no database writes)", () => {
  it("does not fetch private reports or show moderation controls before authentication", () => {
    render(<StaffModeration />);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(fetchStaffReports).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Save status" })).not.toBeInTheDocument();
  });

  it("keeps non-staff users out when the server rejects their token", async () => {
    signInStaff.mockResolvedValue(account("nonstaff-token", "viewer@example.test"));
    fetchStaffReports.mockRejectedValue(new Error("Staff reports unavailable (403)"));
    const user = userEvent.setup();
    render(<StaffModeration />);
    await login(user, "viewer@example.test");

    expect(await screen.findByRole("alert")).toHaveTextContent("403");
    expect(fetchStaffReports).toHaveBeenCalledWith("nonstaff-token");
    expect(screen.queryByRole("button", { name: "Save status" })).not.toBeInTheDocument();
    expect(moderatePublicReport).not.toHaveBeenCalled();
  });

  it("shows an authorized staff report and passes the staff token to moderation and audit actions", async () => {
    signInStaff.mockResolvedValue(account("staff-token", "staff@example.test"));
    fetchStaffReports.mockResolvedValue([testReport]);
    const onUpdated = vi.fn();
    const user = userEvent.setup();
    render(<StaffModeration onUpdated={onUpdated} />);
    await login(user);

    expect(await screen.findByText(/Report #7/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View audit history" }));
    await waitFor(() => expect(fetchReportAudit).toHaveBeenCalledWith(7, "staff-token"));
    await user.click(screen.getByRole("button", { name: "Save status" }));
    await waitFor(() => expect(moderatePublicReport).toHaveBeenCalledWith(7, "confirmed", "staff-token"));
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it("clears staff reports and moderation controls on sign-out", async () => {
    signInStaff.mockResolvedValue(account("staff-token", "staff@example.test"));
    fetchStaffReports.mockResolvedValue([testReport]);
    const user = userEvent.setup();
    render(<StaffModeration />);
    await login(user);
    expect(await screen.findByText(/Report #7/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByText(/Report #7/)).not.toBeInTheDocument();
    expect(signOutStaff).toHaveBeenCalledWith("staff-token");
  });
});
