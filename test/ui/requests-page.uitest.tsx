import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Requests from "../../src/ui/pages/Requests";
import type { RequestRow } from "../../src/ui/requestTypes";
import { renderWithRouter, setupFetchStub } from "./helpers";

const requestRow = (overrides: Partial<RequestRow> = {}): RequestRow => ({
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
  pmName: null,
  status: "draft",
  cancelledBy: null,
  cancelReason: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("Requests page fetch effects", () => {
  const stub = setupFetchStub();

  it("fetches /api/requests on mount and renders populated rows", async () => {
    stub.enqueue("/api/requests", { body: [requestRow()] });
    renderWithRouter(<Requests />, { route: "/requests" });

    expect(await screen.findByRole("link", { name: "Kitchen renovation" })).toBeTruthy();
    expect(stub.callsTo("/api/requests")).toEqual(["/api/requests"]);
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Tallinn")).toBeTruthy();
    expect(table.getByText("draft")).toBeTruthy();
  });

  it("re-fetches with the status query when the status filter changes", async () => {
    stub.enqueue("/api/requests", [
      { body: [requestRow()] },
      { body: [requestRow({ id: "r2", title: "Bathroom refit", status: "approved" })] },
    ]);
    renderWithRouter(<Requests />, { route: "/requests" });

    await screen.findByRole("link", { name: "Kitchen renovation" });
    // The filter bar renders two selects in order: status first, trade second.
    const statusSelect = screen.getAllByRole("combobox")[0]!;
    fireEvent.change(statusSelect, { target: { value: "draft" } });

    await waitFor(() =>
      expect(stub.callsTo("/api/requests")).toEqual([
        "/api/requests",
        "/api/requests?status=draft",
      ]),
    );
    expect(await screen.findByRole("link", { name: "Bathroom refit" })).toBeTruthy();
  });

  it("renders the error banner when the fetch rejects", async () => {
    stub.enqueue("/api/requests", { status: 500, body: { error: "database offline" } });
    renderWithRouter(<Requests />, { route: "/requests" });

    expect(await screen.findByText("Error: database offline")).toBeTruthy();
    expect(screen.getByText("No requests found")).toBeTruthy();
  });
});
