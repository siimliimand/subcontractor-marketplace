import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Providers from "../../src/ui/pages/Providers";
import { deferred, renderWithRouter, setupFetchStub } from "./helpers";

const rows = [
  {
    company: {
      id: "p1",
      legalName: "OÜ Katsetaja",
      registrationIdentifier: "11002233",
      contactEmail: "kats@test.example",
      contactPhone: null,
      status: "active",
      statusReason: null,
      statusChangedAt: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
    },
    services: [{ trade: "electrical" }],
  },
];

const staleRow = {
  company: {
    id: "p0",
    legalName: "Old Painting OÜ",
    registrationIdentifier: "99001122",
    contactEmail: "old@test.example",
    contactPhone: null,
    status: "inactive",
    statusReason: null,
    statusChangedAt: null,
    createdAt: "2025-06-01T00:00:00Z",
    updatedAt: "2025-06-02T00:00:00Z",
  },
  services: [{ trade: "painting" }],
};

describe("Providers page fetch effects", () => {
  const stub = setupFetchStub();

  it("fetches /api/providers on mount without a query when filters are empty", async () => {
    stub.enqueue("/api/providers", { body: rows });
    renderWithRouter(<Providers />, { route: "/providers" });

    expect(await screen.findByRole("link", { name: "OÜ Katsetaja" })).toBeTruthy();
    expect(stub.callsTo("/api/providers")).toEqual(["/api/providers"]);
  });

  it("renders populated rows", async () => {
    stub.enqueue("/api/providers", { body: rows });
    renderWithRouter(<Providers />, { route: "/providers" });

    await screen.findByRole("link", { name: "OÜ Katsetaja" });
    const table = within(screen.getByRole("table"));
    expect(table.getByText("11002233")).toBeTruthy();
    expect(table.getByText("kats@test.example")).toBeTruthy();
    expect(table.getByText("electrical")).toBeTruthy();
    expect(table.getByText("active")).toBeTruthy();
  });

  it("re-fetches with the search query when the name filter changes", async () => {
    stub.enqueue("/api/providers", [{ body: rows }, { body: [] }]);
    renderWithRouter(<Providers />, { route: "/providers" });

    await screen.findByRole("link", { name: "OÜ Katsetaja" });
    fireEvent.change(screen.getByPlaceholderText("Search by name"), {
      target: { value: "kats" },
    });

    await waitFor(() =>
      expect(stub.callsTo("/api/providers")).toEqual([
        "/api/providers",
        "/api/providers?q=kats",
      ]),
    );
    expect(await screen.findByText("No providers found")).toBeTruthy();
  });

  it("renders the error banner when the fetch rejects", async () => {
    stub.enqueue("/api/providers", { status: 500, body: { error: "database offline" } });
    renderWithRouter(<Providers />, { route: "/providers" });

    expect(await screen.findByText("Error: database offline")).toBeTruthy();
    expect(screen.getByText("No providers found")).toBeTruthy();
  });

  it("never paints a stale response that resolves after a newer filter change", async () => {
    const staleMount = deferred();
    const freshAfterChange = deferred();
    stub.enqueue("/api/providers", [
      { deferred: staleMount },
      { deferred: freshAfterChange },
    ]);
    renderWithRouter(<Providers />, { route: "/providers" });

    // Change the filter while the first fetch is still pending.
    fireEvent.change(screen.getByPlaceholderText("Search by name"), {
      target: { value: "kats" },
    });
    expect(stub.callsTo("/api/providers")).toEqual([
      "/api/providers",
      "/api/providers?q=kats",
    ]);

    // The NEW response resolves first; the OLD response lands afterwards.
    freshAfterChange.resolve({ body: rows });
    expect(await screen.findByRole("link", { name: "OÜ Katsetaja" })).toBeTruthy();
    staleMount.resolve({ body: [staleRow] });

    // The stale response must never overwrite the fresher one.
    await waitFor(() =>
      expect(screen.queryByText("Old Painting OÜ")).toBeNull(),
    );
    expect(screen.getByRole("link", { name: "OÜ Katsetaja" })).toBeTruthy();
  });

  it("stays correct under StrictMode dev double-mount", async () => {
    const deadMount = deferred();
    const liveMount = deferred();
    stub.enqueue("/api/providers", [
      { deferred: deadMount },
      { deferred: liveMount },
    ]);
    renderWithRouter(<Providers />, { route: "/providers", strictMode: true });

    // StrictMode mounts the effect twice: the first run is discarded on cleanup.
    expect(stub.callsTo("/api/providers")).toEqual(["/api/providers", "/api/providers"]);

    // The live mount's response resolves; the dead mount's lands afterwards.
    liveMount.resolve({ body: rows });
    expect(await screen.findByRole("link", { name: "OÜ Katsetaja" })).toBeTruthy();
    deadMount.resolve({ body: [staleRow] });

    await waitFor(() =>
      expect(screen.queryByText("Old Painting OÜ")).toBeNull(),
    );
    expect(screen.getByRole("link", { name: "OÜ Katsetaja" })).toBeTruthy();
  });
});
