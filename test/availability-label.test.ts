import { describe, expect, it } from "vitest";
import { availabilityLabel } from "../src/ui/availabilityLabel";

describe("availability label logic", () => {
  it("missing declaration is Unconfirmed", () => {
    expect(availabilityLabel(null)).toEqual({ label: "Unconfirmed", tone: "unconfirmed" });
    expect(availabilityLabel(undefined)).toEqual({ label: "Unconfirmed", tone: "unconfirmed" });
  });

  it("email-only channel is Unconfirmed regardless of stated dates", () => {
    expect(availabilityLabel({ channel: "email_only", freshness: "current" })).toEqual({
      label: "Unconfirmed",
      tone: "unconfirmed",
    });
  });

  it("expired or unknown freshness is Unconfirmed", () => {
    expect(availabilityLabel({ channel: "booking_system", freshness: "expired" })).toEqual({
      label: "Unconfirmed",
      tone: "unconfirmed",
    });
    expect(availabilityLabel({ channel: "booking_system" })).toEqual({
      label: "Unconfirmed",
      tone: "unconfirmed",
    });
  });

  it("current booking-system declarations are Confirmed", () => {
    expect(availabilityLabel({ channel: "booking_system", freshness: "current" })).toEqual({
      label: "Confirmed available",
      tone: "confirmed",
    });
  });

  it("stale requires reconfirmation, aging recommends it", () => {
    expect(availabilityLabel({ channel: "booking_system", freshness: "stale" })).toEqual({
      label: "Uncertain — reconfirmation required",
      tone: "reconfirm",
    });
    expect(availabilityLabel({ channel: "booking_system", freshness: "aging" })).toEqual({
      label: "Likely current — reconfirmation recommended",
      tone: "reconfirm",
    });
  });
});
