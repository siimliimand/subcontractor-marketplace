import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import RequestDetail from "../../src/ui/pages/RequestDetail";
import type { RequestDetailData } from "../../src/ui/requestTypes";
import { renderWithRouter, setupFetchStub } from "./helpers";

const detail = (): RequestDetailData => ({
  request: {
    id: "r1",
    title: "Kitchen renovation",
    description: "Full gut renovation",
    location: "Tallinn",
    trade: "electrical",
    startDate: "2026-02-01",
    crewSize: 3,
    budget: null,
    duration: null,
    notes: null,
    pmName: "Mari",
    status: "draft",
    cancelledBy: null,
    cancelReason: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  trades: [{ trade: "electrical", isPrimary: true }],
  responses: [],
  bookings: [],
  bookingRequests: [],
  holds: [],
  comparison: [],
  outreach: [],
  timeEntries: [],
  events: [],
});

describe("RequestDetail page fetch effects", () => {
  const stub = setupFetchStub();

  it("fetches the detail, the effort rollup, and the providers picker, then renders", async () => {
    stub.enqueue("/api/requests/r1", { body: detail() });
    stub.enqueue("/api/requests/r1/effort", { body: { totalMinutes: 130, manualEvents: 2 } });
    stub.enqueue("/api/providers", { body: [] });
    renderWithRouter(<RequestDetail />, { route: "/requests/r1", path: "/requests/:id" });

    expect(await screen.findByRole("heading", { name: "Kitchen renovation" })).toBeTruthy();
    expect(screen.getByText("Effort rollup")).toBeTruthy();
    expect(screen.getByText(/2h 10m/)).toBeTruthy();
    expect(stub.callsTo("/api/requests/r1")).toEqual([
      "/api/requests/r1",
      "/api/requests/r1/effort",
    ]);
    expect(stub.callsTo("/api/providers")).toEqual(["/api/providers"]);
  });
});
