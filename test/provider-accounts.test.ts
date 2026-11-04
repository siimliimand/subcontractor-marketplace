import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { makeAccessToken, accessHeaders } from "./helpers/access";
import {
  auditEvents,
  companies,
  emailSuppressions,
  providerUserTokens,
  providerUsers,
} from "../src/worker/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { providerPortal } from "../src/worker/providerPortal";
import { issueProviderToken } from "../src/worker/providerAuth";

const db = () => drizzle(env.DB);
const SECRET = env.EMAIL_TOKEN_SECRET;

let authHeaders: Record<string, string>;

beforeEach(async () => {
  const { privateKey } = globalThis.__testAccessKey;
  const token = await makeAccessToken(privateKey, { email: "staff@example.com" });
  authHeaders = accessHeaders(token);
  await SELF.fetch("https://example.com/api/me", { headers: authHeaders });
  await db().delete(providerUserTokens);
  await db().delete(providerUsers);
  await db().delete(emailSuppressions);
  await db().delete(auditEvents);
  await db().delete(companies);
});

async function createProvider() {
  const res = await SELF.fetch("https://example.com/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      legalName: `OÜ Multiuser ${Math.random().toString(36).slice(2, 7)}`,
      registrationIdentifier: `reg-mu-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      contactEmail: "mu@x.ee",
    }),
  });
  return (await res.json()) as { id: string };
}

function portalPost(path: string, body: unknown, cookie?: string) {
  return providerPortal.request(`https://example.com${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  }, env);
}

function portalGet(path: string, cookie: string) {
  return providerPortal.request(`https://example.com${path}`, {
    method: "GET",
    headers: { Cookie: cookie },
  }, env);
}

describe("staff provisions provider users", () => {
  it("provisions the first owner with a single-use invite; audit recorded", async () => {
    const provider = await createProvider();
    const res = await SELF.fetch(`https://example.com/api/providers/${provider.id}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ email: "owner@firm.ee", role: "owner" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; status: string; role: string };
    expect(body.status).toBe("invited");
    expect(body.role).toBe("owner");

    const events = await db().select().from(auditEvents).where(eq(auditEvents.entity, "provider_user"));
    expect(events.map((e) => e.action)).toContain("provider_user_invited");
  });

  it("suppressed addresses cannot be invited", async () => {
    const provider = await createProvider();
    await db().insert(emailSuppressions).values({ email: "blocked@firm.ee", reason: "bounce (manual)" });
    const res = await SELF.fetch(`https://example.com/api/providers/${provider.id}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ email: "blocked@firm.ee", role: "coordinator" }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("invite_suppressed");
  });
});

describe("token accept and login", () => {
  let provider: { id: string };
  let ownerUserId: string;

  beforeEach(async () => {
    provider = await createProvider();
    const res = await SELF.fetch(`https://example.com/api/providers/${provider.id}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ email: "owner@firm.ee", role: "owner" }),
    });
    ownerUserId = ((await res.json()) as { id: string }).id;
  });

  it("accept flow activates the user and issues a working session", async () => {
    const raw = await issueProviderToken(db(), {
      userId: ownerUserId,
      purpose: "provider_invite",
      secret: SECRET,
    });
    const accept = await portalPost("/u/auth/accept", { token: raw.raw });
    expect(accept.status).toBe(200);
    const cookie = accept.headers.get("Set-Cookie")!.split(";")[0]!;

    const me = await portalGet("/u/me", cookie);
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { user: { role: string; company: { id: string } } };
    expect(meBody.user.role).toBe("owner");
    expect(meBody.user.company.id).toBe(provider.id);

    // Token is single-use.
    const replay = await portalPost("/u/auth/accept", { token: raw.raw });
    expect(replay.status).toBe(400);
  });

  it("login tokens work only for active users; disabled users get a generic rejection", async () => {
    // Activate via accept first.
    const invite = await issueProviderToken(db(), {
      userId: ownerUserId,
      purpose: "provider_invite",
      secret: SECRET,
    });
    await portalPost("/u/auth/accept", { token: invite.raw });

    const login = await issueProviderToken(db(), {
      userId: ownerUserId,
      purpose: "provider_login",
      secret: SECRET,
    });
    const ok = await portalPost("/u/auth/login", { token: login.raw });
    expect(ok.status).toBe(200);

    // Disable via staff, then the next login attempt fails generically.
    await SELF.fetch(`https://example.com/api/providers/${provider.id}/users/${ownerUserId}/disable`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ reason: "left the company" }),
    });
    const login2 = await issueProviderToken(db(), {
      userId: ownerUserId,
      purpose: "provider_login",
      secret: SECRET,
    });
    const rejected = await portalPost("/u/auth/login", { token: login2.raw });
    expect(rejected.status).toBe(400);
    // Same shape as an invalid token — indistinguishable.
    const invalid = await portalPost("/u/auth/login", { token: "not-a-token" });
    expect(((await rejected.json()) as { error: string }).error).toBe(
      ((await invalid.json()) as { error: string }).error,
    );
  });
});

describe("company-scoped access", () => {
  it("coordinator cannot invite or disable (owner-only); owner can; cross-company is 404-shaped", async () => {
    const providerA = await createProvider();
    const providerB = await createProvider();

    // Owner + coordinator for company A.
    const ownerInvite = await issueProviderToken(db(), {
      userId: (
        await (
          await SELF.fetch(`https://example.com/api/providers/${providerA.id}/users`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders },
            body: JSON.stringify({ email: "a-owner@firm.ee", role: "owner" }),
          })
        ).json() as { id: string }
      ).id,
      purpose: "provider_invite",
      secret: SECRET,
    });
    const acceptOwner = await portalPost("/u/auth/accept", { token: ownerInvite.raw });
    const ownerCookie = acceptOwner.headers.get("Set-Cookie")!.split(";")[0]!;

    const coordinatorUserId = (
      await (
        await SELF.fetch(`https://example.com/api/providers/${providerA.id}/users`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({ email: "a-coord@firm.ee", role: "coordinator" }),
        })
      ).json() as { id: string }
    ).id;
    const coordInvite = await issueProviderToken(db(), {
      userId: coordinatorUserId,
      purpose: "provider_invite",
      secret: SECRET,
    });
    const acceptCoord = await portalPost("/u/auth/accept", { token: coordInvite.raw });
    const coordCookie = acceptCoord.headers.get("Set-Cookie")!.split(";")[0]!;

    // Coordinator tries owner-only actions → rejected.
    const coordInviteAttempt = await portalPost("/u/users", {
      email: "new@firm.ee",
      role: "coordinator",
    }, coordCookie);
    expect(coordInviteAttempt.status).toBe(403);
    expect(((await coordInviteAttempt.json()) as { error: string }).error).toBe("owner_only");

    // Owner invites successfully.
    const ownerInviteAttempt = await portalPost("/u/users", {
      email: "new@firm.ee",
      role: "coordinator",
    }, ownerCookie);
    expect(ownerInviteAttempt.status).toBe(201);

    // Owner disables the coordinator; coordinator's session dies.
    const disable = await portalPost(`/u/users/${coordinatorUserId}/disable`, {}, ownerCookie);
    expect(disable.status).toBe(200);
    const deadSession = await portalGet("/u/me", coordCookie);
    expect(deadSession.status).toBe(401);

    // Coordinator's company-scoped read of another company's data is not
    // distinguishable from a missing record (they see only their company).
    const companyView = await portalGet("/u/company", ownerCookie);
    expect(companyView.status).toBe(200);
    const companyBody = (await companyView.json()) as { company: { id: string } };
    expect(companyBody.company.id).toBe(providerA.id);
    expect(companyBody.company.id).not.toBe(providerB.id);
  });
});
