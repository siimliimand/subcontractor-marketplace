import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ProviderDetail from "../../src/ui/pages/ProviderDetail";
import type { Company } from "../../src/ui/types";
import { deferred, renderWithRouter, setupFetchStub } from "./helpers";

const company: Company = {
  id: "p1",
  legalName: "OÜ Katsetaja",
  registrationIdentifier: "11002233",
  contactEmail: "kats@test.example",
  contactPhone: "+372 5555",
  status: "active",
  statusReason: null,
  statusChangedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  services: [
    {
      id: "s1",
      companyId: "p1",
      trade: "electrical",
      skills: null,
      serviceArea: "Harju",
      pricingApproach: null,
      pricingModel: "hour",
      status: "active",
      statusReason: null,
      statusChangedAt: null,
      createdAt: "2026-01-01T00:00:00Z",
    },
  ],
};

const availability = {
  declarations: [],
  summary: { confirmedWorkers: 3, hasFreshDeclarations: true },
};

const verifications = {
  badges: { registryActive: null, trades: {} },
  mtrBadgesEnabled: true,
};

describe("ProviderDetail page fetch effects", () => {
  const stub = setupFetchStub();

  it("fetches all three endpoints for :id sequentially and renders the loaded provider", async () => {
    stub.enqueue("/api/providers/p1", { body: company });
    stub.enqueue("/api/providers/p1/availability", { body: availability });
    stub.enqueue("/api/providers/p1/verifications", { body: verifications });
    renderWithRouter(<ProviderDetail />, { route: "/providers/p1", path: "/providers/:id" });

    expect(await screen.findByRole("heading", { name: "OÜ Katsetaja" })).toBeTruthy();
    expect(screen.getByText("3 workers confirmed fresh")).toBeTruthy();
    expect(
      screen.getByText((_, el) => el?.textContent === "Area: Harju · Model: hour"),
    ).toBeTruthy();
    expect(stub.callsTo("/api/providers/p1")).toEqual([
      "/api/providers/p1",
      "/api/providers/p1/availability",
      "/api/providers/p1/verifications",
    ]);
  });

  it("shows the loading state before the provider fetch resolves", async () => {
    const pending = deferred();
    stub.enqueue("/api/providers/p1", { deferred: pending });
    stub.enqueue("/api/providers/p1/availability", { body: availability });
    stub.enqueue("/api/providers/p1/verifications", { body: verifications });
    renderWithRouter(<ProviderDetail />, { route: "/providers/p1", path: "/providers/:id" });

    expect(screen.getByText("Loading…")).toBeTruthy();

    pending.resolve({ body: company });
    expect(await screen.findByRole("heading", { name: "OÜ Katsetaja" })).toBeTruthy();
  });

  it("keeps the provider header rendered when the availability fetch fails after the provider resolved", async () => {
    stub.enqueue("/api/providers/p1", { body: company });
    stub.enqueue("/api/providers/p1/availability", {
      status: 500,
      body: { error: "database offline" },
    });
    stub.enqueue("/api/providers/p1/verifications", { body: verifications });
    renderWithRouter(<ProviderDetail />, { route: "/providers/p1", path: "/providers/:id" });

    // Provider applied incrementally before the failure → header stays visible.
    expect(await screen.findByRole("heading", { name: "OÜ Katsetaja" })).toBeTruthy();
    expect(await screen.findByText("Error: database offline")).toBeTruthy();
    // Sequential order: the failure aborts before the verifications fetch.
    expect(stub.callsTo("/api/providers/p1/verifications")).toEqual([]);
    expect(screen.getByText(/No register checks imported yet/)).toBeTruthy();
  });
});
