import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import { auditEvents, briefProposals, requests } from "../src/worker/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createApp } from "../src/worker/app";
import { draftBrief, validateBrief } from "../src/worker/ai/brief";

const db = () => drizzle(env.DB);

let authHeaders: Record<string, string>;

beforeEach(async () => {
  const { privateKey } = (globalThis as any).__testAccessKey;
  const token = await makeAccessToken(privateKey, { email: "staff@example.com" });
  authHeaders = accessHeaders(token);
  await SELF.fetch("https://example.com/api/me", { headers: authHeaders });
  await db().delete(briefProposals);
  await db().delete(auditEvents);
  await db().delete(requests);
});

function aiBinding(responses: string[], calls: { n: number }) {
  return {
    run(_model: string, _inputs: unknown) {
      const response = responses[Math.min(calls.n, responses.length - 1)]!;
      calls.n += 1;
      return Promise.resolve({ response });
    },
  };
}

const SOURCE = "we need an electrical subcontractor for an apartment renovation in Tallinn next month, 3 fitters";

describe("brief draft validation (never invented)", () => {
  it("nulls unsupported fields and lists them missing", () => {
    const { draft, missing } = validateBrief({
      workType: "renovation",
      trades: ["electrical"],
      crewSize: 3,
      location: "Tallinn",
      // the model invented a specific date the source text never stated:
      startDate: "2026-11-01",
      budgetExpectations: 5000,
    });
    expect(draft.workType).toBe("renovation");
    expect(draft.trades).toEqual(["electrical"]);
    expect(draft.crewSize).toBe("3");
    // budget as a bare number is not a valid string expectation → dropped
    expect(draft.budgetExpectations).toBeNull();
    expect(missing).toContain("budgetExpectations");
  });
});

describe("brief draft via AI binding", () => {
  it("parses a valid JSON response, flagging missing fields", async () => {
    const calls = { n: 0 };
    const result = await draftBrief(
      aiBinding(
        [
          JSON.stringify({
            workType: "renovation",
            scope: "apartment rewiring",
            location: "Tallinn",
            trades: ["electrical"],
            crewSize: 3,
            startDate: null,
          }),
        ],
        calls,
      ),
      SOURCE,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proposal.draft.location).toBe("Tallinn");
      expect(result.proposal.draft.startDate).toBeNull();
      expect(result.proposal.missing).toContain("startDate");
      expect(result.proposal.missing).toContain("budgetExpectations");
    }
    expect(calls.n).toBe(1);
  });

  it("retries once on malformed output, then fails with a typed reason", async () => {
    const calls = { n: 0 };
    const result = await draftBrief(
      aiBinding(["I cannot help with that.", "still no JSON here"], calls),
      SOURCE,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("malformed_model_output");
    expect(calls.n).toBe(2);
  });

  it("recovers on the retry when the second response is valid JSON", async () => {
    const calls = { n: 0 };
    const good = JSON.stringify({ trades: ["electrical"], crewSize: 3 });
    const result = await draftBrief(aiBinding(["nope", good], calls), SOURCE);
    expect(result.ok).toBe(true);
    expect(calls.n).toBe(2);
  });

  it("drops invented values that fail validation (unsupported trades, bad dates)", () => {
    const { draft } = validateBrief({
      trades: ["electrical", "welding"],
      startDate: "next month",
      crewSize: 0,
    });
    expect(draft.trades).toEqual(["electrical"]);
    expect(draft.startDate).toBeNull();
    expect(draft.crewSize).toBeNull();
  });
});

describe("brief routes", () => {
  it("502 with manual-form fallback when the AI binding is missing", async () => {
    const res = await SELF.fetch("https://example.com/api/briefs/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ sourceText: SOURCE }),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("manual request form");
  });

  it("drafts via the AI binding, stores an inert proposal, approval records brief_approved with proposal-vs-final", async () => {
    const good = JSON.stringify({
      workType: "renovation",
      location: "Tallinn",
      trades: ["electrical"],
      crewSize: 3,
    });
    const app = createApp();
    const aiEnv = {
      ...env,
      AI: aiBinding([good], { n: 0 }),
    };

    const draftRes = await app.request(
      "https://example.com/api/briefs/draft",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ sourceText: SOURCE }),
      },
      aiEnv,
    );
    expect(draftRes.status).toBe(201);
    const draftBody = (await draftRes.json()) as {
      id: string;
      missing: string[];
      state: string;
    };
    expect(draftBody.state).toBe("drafted");
    expect(draftBody.missing).toContain("startDate");

    // Inert: no request rows created from the draft
    const requestRows = await db().select().from(requests);
    expect(requestRows).toHaveLength(0);

    // Approve with staff edits
    const approveRes = await app.request(
      `https://example.com/api/briefs/${draftBody.id}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          final: {
            workType: "renovation",
            location: "Tallinn, Kalamaja",
            trades: ["electrical", "drywall"],
            crewSize: 4,
            startDate: "2026-11-16",
          },
        }),
      },
      aiEnv,
    );
    expect(approveRes.status).toBe(200);
    const approveBody = (await approveRes.json()) as {
      final: { location: string; trades: string[] };
      proposed: { location: string };
    };
    expect(approveBody.final.location).toBe("Tallinn, Kalamaja");
    expect(approveBody.proposed.location).toBe("Tallinn"); // original preserved

    const events = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "brief_approved"));
    expect(events).toHaveLength(1);

    // double approval refused
    const again = await app.request(
      `https://example.com/api/briefs/${draftBody.id}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ final: {} }),
      },
      aiEnv,
    );
    expect(again.status).toBe(400);

    // proposal-vs-final retrievable
    const get = await app.request(`https://example.com/api/briefs/${draftBody.id}`, {
      headers: authHeaders,
    }, aiEnv);
    const getBody = (await get.json()) as {
      proposed: unknown;
      final: unknown;
      state: string;
    };
    expect(getBody.state).toBe("approved");
    expect(getBody.final).not.toBeNull();
    expect(getBody.proposed).not.toBeNull();
  });
});
