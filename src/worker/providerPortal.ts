import { Hono, type Context } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  availabilityDeclarations,
  bookingReviews,
  bookings,
  calendarFeeds,
  companies,
  emailSuppressions,
  outreachEntries,
  providerUsers,
} from "./db/schema";
import {
  consumeProviderToken,
  issueProviderToken,
  resolveActiveProviderUser,
  signSession,
  verifySession,
  SESSION_TTL_SECONDS,
} from "./providerAuth";
import { maskFeedUrl } from "./calendar/ics";
import { isFeedStale } from "./cron/calendar";
import { auditEventStatement } from "./events";

/**
 * Phase 4 provider portal (public, no Access guard): email-token accept/
 * login, then company-scoped reads under an HMAC session cookie. Every
 * query is filtered by the session's companyId — cross-company reads are
 * indistinguishable from missing records. No passwords anywhere; tokens are
 * single-use and expiring.
 */

export const SESSION_COOKIE = "provider_session";

type PortalEnv = {
  DB: D1Database;
  PROVIDER_SESSION_SECRET?: string;
  EMAIL_TOKEN_SECRET?: string;
  CALENDAR_STALE_DAYS?: string;
  SEND_EMAIL?: {
    send(message: { from: string; to: string; subject: string; text: string }): Promise<void>;
  };
  EMAIL_FROM?: string;
};

export const providerPortal = new Hono<{ Bindings: PortalEnv }>();

function sessionSecret(env: PortalEnv): string {
  // Falls back to the email token secret so local/dev setups work without a
  // second secret; production sets PROVIDER_SESSION_SECRET explicitly.
  return env.PROVIDER_SESSION_SECRET ?? env.EMAIL_TOKEN_SECRET ?? "insecure-dev-secret";
}

function cookieFrom(request: Request): string | undefined {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return undefined;
}

function sessionCookie(value: string): string {
  return `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}; Path=/`;
}

function clearedCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/`;
}

type PortalUser = typeof providerUsers.$inferSelect;

/** Resolves the active provider user from the session cookie, or null. */
async function requireProviderUser(
  c: Context<{ Bindings: PortalEnv }>,
): Promise<{ user: PortalUser } | null> {
  const db = drizzle(c.env.DB);
  const session = await verifySession(cookieFrom(c.req.raw), sessionSecret(c.env));
  if (!session) return null;
  const user = await resolveActiveProviderUser(db, session);
  if (!user) return null;
  return { user };
}

/** Queue the invite/login email when a mailer is wired (same channel as
 * outreach); the raw token is additionally returned for pilot-stage manual
 * sends and local testing. */
async function sendProviderMail(
  env: PortalEnv,
  to: string,
  subject: string,
  text: string,
): Promise<void> {
  if (!env.SEND_EMAIL) return;
  try {
    await env.SEND_EMAIL.send({
      from: env.EMAIL_FROM ?? "Subcrew <outreach@subcrew.example>",
      to,
      subject,
      text,
    });
  } catch {
    // Mail failure must not fail the API call; the token stays valid.
  }
}

providerPortal.post("/u/auth/accept", async (c) => {
  const db = drizzle(c.env.DB);
  const body = await c.req.json().catch(() => null);
  const token = typeof (body as Record<string, unknown>)?.token === "string"
    ? ((body as Record<string, unknown>).token as string)
    : "";
  if (!token) return c.json({ error: "invalid_token" }, 400);
  const consumed = await consumeProviderToken(db, token, sessionSecret(c.env));
  if (!consumed || consumed.purpose !== "provider_invite")
    return c.json({ error: "invalid_token" }, 400);

  const user = (
    await db.select().from(providerUsers).where(eq(providerUsers.id, consumed.userId)).limit(1)
  )[0];
  if (!user || user.status === "disabled") return c.json({ error: "invalid_token" }, 400);

  const now = new Date().toISOString();
  await db
    .update(providerUsers)
    .set({ status: "active", lastLoginAt: now, updatedAt: now })
    .where(eq(providerUsers.id, user.id));
  const session = await signSession(
    { userId: user.id, companyId: user.companyId, role: user.role as "owner" | "coordinator" },
    sessionSecret(c.env),
  );
  c.header("Set-Cookie", sessionCookie(session));
  return c.json({ ok: true, role: user.role, companyId: user.companyId }, 200);
});

providerPortal.post("/u/auth/login", async (c) => {
  const db = drizzle(c.env.DB);
  const body = await c.req.json().catch(() => null);
  const token = typeof (body as Record<string, unknown>)?.token === "string"
    ? ((body as Record<string, unknown>).token as string)
    : "";
  if (!token) return c.json({ error: "invalid_token" }, 400);
  const consumed = await consumeProviderToken(db, token, sessionSecret(c.env));
  if (!consumed || consumed.purpose !== "provider_login")
    return c.json({ error: "invalid_token" }, 400);

  const user = (
    await db.select().from(providerUsers).where(eq(providerUsers.id, consumed.userId)).limit(1)
  )[0];
  // Disabled users get the same generic rejection as invalid tokens.
  if (!user || user.status !== "active") return c.json({ error: "invalid_token" }, 400);

  const now = new Date().toISOString();
  await db.update(providerUsers).set({ lastLoginAt: now }).where(eq(providerUsers.id, user.id));
  const session = await signSession(
    { userId: user.id, companyId: user.companyId, role: user.role as "owner" | "coordinator" },
    sessionSecret(c.env),
  );
  c.header("Set-Cookie", sessionCookie(session));
  return c.json({ ok: true, role: user.role, companyId: user.companyId }, 200);
});

/** Login-link request: issues a token for known, active users; the response
 * is identical (and mail goes only to real users) either way. */
providerPortal.post("/u/auth/request-login", async (c) => {
  const db = drizzle(c.env.DB);
  const body = await c.req.json().catch(() => null);
  const email = typeof (body as Record<string, unknown>)?.email === "string"
    ? ((body as Record<string, unknown>).email as string).trim().toLowerCase()
    : "";
  if (email) {
    const user = (
      await db.select().from(providerUsers).where(eq(providerUsers.email, email)).limit(1)
    )[0];
    if (user && user.status === "active") {
      const { raw } = await issueProviderToken(db, {
        userId: user.id,
        purpose: "provider_login",
        secret: sessionSecret(c.env),
      });
      await sendProviderMail(
        c.env,
        user.email,
        "Your Subcrew login link",
        `Use this single-use link to sign in (valid 3 days):\n${raw}\n\nIf you did not request this, ignore this message.`,
      );
      return c.json({ ok: true });
    }
  }
  // Uniform response — does not reveal whether the address is registered.
  return c.json({ ok: true });
});

providerPortal.post("/u/auth/logout", async (c) => {
  c.header("Set-Cookie", clearedCookie());
  return c.json({ ok: true }, 200);
});

providerPortal.get("/u/me", async (c) => {
  const ctx = await requireProviderUser(c);
  if (!ctx) return c.json({ error: "unauthorized" }, 401);
  const db = drizzle(c.env.DB);
  const company = (
    await db.select().from(companies).where(eq(companies.id, ctx.user.companyId)).limit(1)
  )[0];
  return c.json({
    user: {
      id: ctx.user.id,
      email: ctx.user.email,
      role: ctx.user.role,
      company: company ? { id: company.id, legalName: company.legalName, status: company.status } : null,
    },
  });
});

// --- Company-scoped reads (own company only) ---

providerPortal.get("/u/company", async (c) => {
  const ctx = await requireProviderUser(c);
  if (!ctx) return c.json({ error: "unauthorized" }, 401);
  const db = drizzle(c.env.DB);
  const companyId = ctx.user.companyId;

  const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) return c.json({ error: "not_found" }, 404);

  const [companyBookings, declarations, feeds, reviews, contacted] = await Promise.all([
    db.select().from(bookings).where(eq(bookings.companyId, companyId)).orderBy(desc(bookings.createdAt)).limit(50),
    db.select().from(availabilityDeclarations).where(eq(availabilityDeclarations.companyId, companyId)),
    db.select().from(calendarFeeds).where(eq(calendarFeeds.companyId, companyId)),
    db.select().from(bookingReviews).where(eq(bookingReviews.companyId, companyId)),
    db.select().from(outreachEntries).where(eq(outreachEntries.companyId, companyId)),
  ]);
  const contactedRequests = new Set(contacted.map((e) => e.requestId));

  const now = new Date();
  const staleDays = Number(c.env.CALENDAR_STALE_DAYS ?? "3") || 3;

  return c.json({
    company: {
      id: company.id,
      legalName: company.legalName,
      status: company.status,
    },
    contactedRequests: contactedRequests.size,
    bookings: companyBookings.map((b) => ({
      id: b.id,
      trade: b.trade,
      startDate: b.startDate,
      endDate: b.endDate,
      workersCount: b.workersCount,
      outcome: b.outcome,
    })),
    availability: {
      declarations: declarations.length,
      latestConfirmation: declarations.map((d) => d.lastConfirmedAt).sort().at(-1) ?? null,
    },
    calendar: {
      feeds: feeds.map((f) => ({
        id: f.id,
        urlMasked: maskFeedUrl(f.url),
        state: f.state,
        stale: isFeedStale(f, now, staleDays),
        lastSuccessAt: f.lastSuccessAt,
      })),
    },
    reviews: reviews
      .filter((r) => !r.disputedAt)
      .map((r) => ({ rating: r.rating, comment: r.comment, createdAt: r.createdAt })),
  });
});

// --- Owner-only user management ---

providerPortal.get("/u/users", async (c) => {
  const ctx = await requireProviderUser(c);
  if (!ctx) return c.json({ error: "unauthorized" }, 401);
  if (ctx.user.role !== "owner") return c.json({ error: "owner_only" }, 403);
  const db = drizzle(c.env.DB);
  const rows = await db
    .select()
    .from(providerUsers)
    .where(eq(providerUsers.companyId, ctx.user.companyId));
  return c.json({
    users: rows.map((u) => ({ id: u.id, email: u.email, role: u.role, status: u.status })),
  });
});

providerPortal.post("/u/users", async (c) => {
  const ctx = await requireProviderUser(c);
  if (!ctx) return c.json({ error: "unauthorized" }, 401);
  if (ctx.user.role !== "owner") return c.json({ error: "owner_only" }, 403);
  const db = drizzle(c.env.DB);

  const body = await c.req.json().catch(() => null);
  const b = (body ?? {}) as Record<string, unknown>;
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) return c.json({ error: "invalid_email" }, 400);
  const role = b.role === "owner" ? "owner" : "coordinator";

  // The invite respects the suppression list exactly as every send path does.
  const suppressed = (
    await db.select().from(emailSuppressions).where(eq(emailSuppressions.email, email)).limit(1)
  )[0];
  if (suppressed) return c.json({ error: "invite_suppressed" }, 409);

  const existing = (
    await db.select().from(providerUsers).where(eq(providerUsers.email, email)).limit(1)
  )[0];
  if (existing) return c.json({ error: "email_already_a_user" }, 409);

  const inserted = await db
    .insert(providerUsers)
    .values({
      companyId: ctx.user.companyId,
      email,
      role,
      status: "invited",
      invitedBy: null,
      updatedAt: new Date().toISOString(),
    })
    .returning();
  const created = inserted[0]!;

  const { raw } = await issueProviderToken(db, {
    userId: created.id,
    purpose: "provider_invite",
    secret: sessionSecret(c.env),
  });
  await sendProviderMail(
    c.env,
    email,
    "You've been invited to your company's Subcrew profile",
    `Accept your invitation with this single-use link (valid 3 days):\n${raw}\n`,
  );

  // Owner invitations are audit-logged with the provider user as actor.
  await db.batch([
    auditEventStatement(db, {
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      entity: "provider_user",
      entityId: created.id,
      action: "provider_user_invited",
      payload: { companyId: ctx.user.companyId, email, role, invitedBy: "owner" },
    }),
  ]);
  return c.json({ id: created.id, email: created.email, role: created.role, status: created.status, inviteToken: raw }, 201);
});

providerPortal.post("/u/users/:id/disable", async (c) => {
  const ctx = await requireProviderUser(c);
  if (!ctx) return c.json({ error: "unauthorized" }, 401);
  if (ctx.user.role !== "owner") return c.json({ error: "owner_only" }, 403);
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  const target = (
    await db
      .select()
      .from(providerUsers)
      .where(and(eq(providerUsers.id, id), eq(providerUsers.companyId, ctx.user.companyId)))
      .limit(1)
  )[0];
  if (!target) return c.json({ error: "not_found" }, 404);
  if (target.id === ctx.user.id) return c.json({ error: "cannot_disable_self" }, 400);

  const now = new Date().toISOString();
  await db
    .update(providerUsers)
    .set({ status: "disabled", updatedAt: now })
    .where(eq(providerUsers.id, id));
  await db.batch([
    auditEventStatement(db, {
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      entity: "provider_user",
      entityId: id,
      action: "provider_user_disabled",
      payload: { companyId: ctx.user.companyId, email: target.email },
    }),
  ]);
  return c.json({ ok: true, id });
});
