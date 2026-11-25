import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function client() {
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "public-key");
  vi.resetModules();
  return import("./staffAuth");
}

describe("Supabase staff authentication (#53)", () => {
  it("sends email/password to the Supabase token endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ access_token: "access", refresh_token: "refresh" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { signInStaff } = await client();
    await expect(signInStaff("staff@example.com", "secret")).resolves.toMatchObject({ access_token: "access" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.supabase.co/auth/v1/token?grant_type=password",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ apikey: "public-key" }),
        body: JSON.stringify({ email: "staff@example.com", password: "secret" }),
      }),
    );
  });

  it("does not disclose provider error details on failed login", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ message: "private backend detail" }),
    }));
    const { signInStaff } = await client();
    await expect(signInStaff("staff@example.com", "wrong")).rejects.toThrow("Invalid email, password, or session.");
  });

  it("refreshes using a refresh token and signs out with the access token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const { refreshStaff, signOutStaff } = await client();
    await refreshStaff("refresh-secret");
    await signOutStaff("access-secret");
    expect(fetchMock).toHaveBeenNthCalledWith(1,
      "https://example.supabase.co/auth/v1/token?grant_type=refresh_token",
      expect.objectContaining({ body: JSON.stringify({ refresh_token: "refresh-secret" }) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2,
      "https://example.supabase.co/auth/v1/logout",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer access-secret" }) }),
    );
  });

  it("fails closed when public Supabase configuration is absent", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    vi.resetModules();
    const { signInStaff, staffAuthConfigured } = await import("./staffAuth");
    expect(staffAuthConfigured).toBe(false);
    await expect(signInStaff("a@b.com", "password")).rejects.toThrow("not configured");
  });
});
