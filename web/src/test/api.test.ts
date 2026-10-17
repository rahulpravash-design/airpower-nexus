import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, describeError } from "../services/api";

const mockFetch = (status: number, body: unknown) =>
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: status < 400, status, text: async () => (body === null ? "" : JSON.stringify(body)) }));

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("returns parsed JSON on success and uses the configured base URL", async () => {
    mockFetch(200, { status: "ok" });
    expect(await api.health()).toEqual({ status: "ok" });
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("/api/health");
  });

  it("maps the backend error envelope to ApiError", async () => {
    mockFetch(409, { error: { code: "PENDING_PROPOSAL", message: "plan-0002 is awaiting approval", details: null } });
    await expect(api.createPlan()).rejects.toMatchObject({ status: 409, code: "PENDING_PROPOSAL", message: "plan-0002 is awaiting approval" });
  });

  it("reports an unreachable backend as a network error, not as data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const err = await api.scenario().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.isNetwork).toBe(true);
  });

  it("describes validation details for the user", () => {
    const e = new ApiError(422, "INVALID_CONFIG", "configuration failed validation", [{ field: "crew_rest_hours", message: "must be >= 1" }]);
    expect(describeError(e)).toContain("crew_rest_hours must be >= 1");
  });

  it("POSTs events as JSON", async () => {
    mockFetch(200, { plan: {}, proposed_scenario: {} });
    await api.submitEvent({ type: "AIRCRAFT_UNAVAILABLE", aircraft_id: "AC-R1-01" });
    const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ type: "AIRCRAFT_UNAVAILABLE", aircraft_id: "AC-R1-01" });
  });
});
