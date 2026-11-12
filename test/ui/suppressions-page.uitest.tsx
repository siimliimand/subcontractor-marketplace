import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Suppressions from "../../src/ui/pages/Suppressions";
import { renderWithRouter, setupFetchStub } from "./helpers";

const suppressions = {
  suppressions: [
    {
      email: "bounced@example.com",
      reason: "hard bounce",
      createdAt: "2026-01-05T09:00:00Z",
    },
  ],
};

describe("Suppressions page fetch effects", () => {
  const stub = setupFetchStub();

  it("fetches /api/suppressions on mount and renders populated rows", async () => {
    stub.enqueue("/api/suppressions", { body: suppressions });
    renderWithRouter(<Suppressions />, { route: "/suppressions" });

    expect(await screen.findByText("bounced@example.com")).toBeTruthy();
    expect(screen.getByText("hard bounce")).toBeTruthy();
    expect(screen.getByText("added 2026-01-05")).toBeTruthy();
    expect(stub.callsTo("/api/suppressions")).toEqual(["/api/suppressions"]);
  });

  it("sets feedback when the initial fetch fails", async () => {
    stub.enqueue("/api/suppressions", {
      status: 500,
      body: { error: "database offline" },
    });
    renderWithRouter(<Suppressions />, { route: "/suppressions" });

    expect(await screen.findByText("Error: database offline")).toBeTruthy();
  });
});
