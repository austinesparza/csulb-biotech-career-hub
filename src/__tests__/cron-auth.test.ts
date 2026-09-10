import { describe, expect, it } from "vitest";

import { authorizeCronRequest } from "../lib/cron/auth";

const SECRET = "a-secure-cron-secret-that-is-longer-than-32-characters";

describe("authorizeCronRequest", () => {
  it("accepts the exact bearer secret", () => {
    expect(authorizeCronRequest(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects missing, short, and mismatched secrets", () => {
    expect(authorizeCronRequest(null, SECRET)).toBe(false);
    expect(authorizeCronRequest(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(authorizeCronRequest("Basic abc", SECRET)).toBe(false);
    expect(authorizeCronRequest("Bearer short", "short")).toBe(false);
  });
});
