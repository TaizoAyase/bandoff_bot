import { describe, expect, it } from "vitest";
import {
  EVENT_FAILURE_LIMIT,
  IP_FAILURE_LIMIT,
  isRateLimited,
} from "../../src/domain/rate-limit";

describe("isRateLimited", () => {
  it("is not limited with zero failures", () => {
    expect(isRateLimited({ eventFailures: 0, ipFailures: 0 })).toBe(false);
  });

  it("is not limited just below the event threshold", () => {
    expect(
      isRateLimited({ eventFailures: EVENT_FAILURE_LIMIT - 1, ipFailures: 0 }),
    ).toBe(false);
  });

  it("is limited at the event threshold", () => {
    expect(isRateLimited({ eventFailures: EVENT_FAILURE_LIMIT, ipFailures: 0 })).toBe(
      true,
    );
  });

  it("is not limited just below the IP threshold", () => {
    expect(isRateLimited({ eventFailures: 0, ipFailures: IP_FAILURE_LIMIT - 1 })).toBe(
      false,
    );
  });

  it("is limited at the IP threshold even if event failures are low", () => {
    expect(isRateLimited({ eventFailures: 0, ipFailures: IP_FAILURE_LIMIT })).toBe(
      true,
    );
  });
});
