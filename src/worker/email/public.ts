import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import type { BatchItem } from "drizzle-orm/batch";
import { and, eq, isNull } from "drizzle-orm";
import type { Bindings } from "../app";
import { companies, emailTokens, outreachEntries, requests } from "../db/schema";
import type { EmailTokenPurpose } from "../db/schema";
import { auditEventStatement } from "../events";
import { buildDeclineCancellation, buildRecordResponse } from "../responses";
import { tokenExpired, verifyToken } from "./tokens";

type PublicEnv = { Bindings: Bindings };

const NEUTRAL_HTML =
  '<h1 style="color:#b91c1c">Link not available</h1><p style="color:#555">This link is not valid or has expired. If you received this link by email, please use the original message or contact us to receive a new one.</p>';

const GIF_BASE64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAAAAAAALAAAAAABAAEAAAICTAEAOw==";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function page(bodyHtml: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>Subcrew</title></head>` +
      `<body style="font-family:sans-serif;max-width:560px;margin:48px auto;padding:0 16px;color:#111;line-height:1.5">` +
      bodyHtml +
      `</body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Robots-Tag": "noindex",
        "Cache-Control": "no-store",
      },
    },
  );
}

function neutral(): Response {
  return page(NEUTRAL_HTML, 404);
}

function alreadyRecorded(): Response {
  return page(
    '<h1 style="color:#2563eb">Already recorded</h1>' +
      '<p style="color:#555">We already have your answer for this request. Thank you!</p>',
    200,
  );
}

function noLongerOpen(): Response {
  return page(
    '<h1 style="color:#b45309">Request no longer open</h1>' +
      '<p style="color:#555">This request has been closed or cancelled, so your answer could not be recorded. Thank you for letting us know.</p>',
    200,
  );
}

function confirmation(): Response {
  return page(
    '<h1 style="color:#059669">Thank you!</h1>' +
      '<p style="color:#555">Your answer has been recorded. The general contractor will follow up if there is a fit.</p>',
    200,
  );
}

type Brief = {
  title: string;
  trade: string;
  location: string;
  startDate: string;
  crewSize: number;
  description: string;
  providerName: string;
};

function briefHtml(brief: Brief): string {
  return `<h1>${escapeHtml(brief.title)}</h1>
<dl style="font-size:14px">
<dt style="font-weight:600">Trade</dt><dd style="margin:0 0 8px">${escapeHtml(brief.trade)}</dd>
<dt style="font-weight:600">Location</dt><dd style="margin:0 0 8px">${escapeHtml(brief.location)}</dd>
<dt style="font-weight:600">Start</dt><dd style="margin:0 0 8px">${escapeHtml(brief.startDate)}</dd>
<dt style="font-weight:600">Crew size</dt><dd style="margin:0 0 8px">${escapeHtml(String(brief.crewSize))} workers</dd>
</dl>
<p style="font-size:14px">${escapeHtml(brief.description)}</p>
<p style="font-size:14px;color:#555">Response for: <strong>${escapeHtml(brief.providerName)}</strong></p>`;
}

function formPage(
  token: string,
  purpose: "accept" | "quote",
  brief: Brief,
  error?: string,
): Response {
  const action = purpose === "accept" ? "Confirm interest" : "Send a quote";
  return page(
    `${briefHtml(brief)}
${error ? `<p style="color:#b91c1c;font-size:14px">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/e/${escapeHtml(token)}" style="margin-top:16px">
<label style="display:block;font-weight:600;font-size:14px" for="workersCount">How many workers can you commit?</label>
<input type="number" id="workersCount" name="workersCount" min="1" step="1" required value="1"
  style="display:block;margin:4px 0 12px;padding:8px;border:1px solid #d1d5db;border-radius:6px;width:120px" />
<label style="display:block;font-weight:600;font-size:14px" for="availableFrom">Available from</label>
<input type="date" id="availableFrom" name="availableFrom" required
  style="display:block;margin:4px 0 16px;padding:8px;border:1px solid #d1d5db;border-radius:6px" />
<button type="submit"
  style="background:${purpose === "accept" ? "#2563eb" : "#059669"};color:#fff;padding:10px 18px;border:0;border-radius:6px;font-size:15px">${escapeHtml(action)}</button>
</form>`,
    error ? 400 : 200,
  );
}

function declinePage(token: string, brief: Brief, error?: string): Response {
  return page(
    `${briefHtml(brief)}
<p style="font-size:14px">Please confirm that your company is not taking this work. This cannot be undone.</p>
${error ? `<p style="color:#b91c1c;font-size:14px">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/e/${escapeHtml(token)}" style="margin-top:16px">
<label style="display:block;font-weight:600;font-size:14px" for="reason">Reason (optional)</label>
<textarea id="reason" name="reason" rows="3"
  style="display:block;margin:4px 0 16px;padding:8px;border:1px solid #d1d5db;border-radius:6px;width:100%;box-sizing:border-box"></textarea>
<button type="submit"
  style="background:#e5e7eb;color:#111;padding:10px 18px;border:0;border-radius:6px;font-size:15px">Confirm decline</button>
</form>`,
    error ? 400 : 200,
  );
}

async function loadBrief(
  db: ReturnType<typeof drizzle>,
  entryId: string,
): Promise<Brief | null> {
  const row = (
    await db
      .select({ request: requests, providerName: companies.legalName })
      .from(outreachEntries)
      .innerJoin(requests, eq(requests.id, outreachEntries.requestId))
      .innerJoin(companies, eq(companies.id, outreachEntries.companyId))
      .where(eq(outreachEntries.id, entryId))
      .limit(1)
  )[0];
  if (!row) return null;
  return {
    title: row.request.title,
    trade: row.request.trade,
    location: row.request.location,
    startDate: row.request.startDate,
    crewSize: row.request.crewSize,
    description: row.request.description,
    providerName: row.providerName,
  };
}

async function verifyHelper(token: string, env: Bindings) {
  if (!env.EMAIL_TOKEN_SECRET) return null;
  const verified = await verifyToken(token, env.EMAIL_TOKEN_SECRET);
  if (!verified || tokenExpired(verified)) return null;
  return verified;
}

function gif(): Response {
  return new Response(Uint8Array.from(atob(GIF_BASE64), (ch) => ch.charCodeAt(0)), {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

function markEntryTokensUsedStatement(db: ReturnType<typeof drizzle>, entryId: string) {
  return db
    .update(emailTokens)
    .set({ usedAt: new Date().toISOString() })
    .where(and(eq(emailTokens.outreachEntryId, entryId), isNull(emailTokens.usedAt)));
}

export function createPublicApp() {
  const app = new Hono<PublicEnv>();

  app.get("/e/:token", async (c) => {
    const db = drizzle(c.env.DB);
    const token = c.req.param("token");
    const verified = await verifyHelper(token, c.env);
    if (!verified || verified.purpose === "track") return neutral();

    const tokenRow = (
      await db.select().from(emailTokens).where(eq(emailTokens.jti, verified.jti)).limit(1)
    )[0];
    if (!tokenRow) return neutral();
    if (tokenRow.usedAt) return alreadyRecorded();

    const entryTokens = await db
      .select({ usedAt: emailTokens.usedAt })
      .from(emailTokens)
      .where(eq(emailTokens.outreachEntryId, tokenRow.outreachEntryId));
    if (entryTokens.length > 0 && entryTokens.every((t) => t.usedAt !== null)) {
      return alreadyRecorded();
    }

    const brief = await loadBrief(db, tokenRow.outreachEntryId);
    if (!brief) return neutral();

    if (verified.purpose === "decline") return declinePage(token, brief);
    return formPage(token, verified.purpose, brief);
  });

  app.post("/e/:token", async (c) => {
    const db = drizzle(c.env.DB);
    const token = c.req.param("token");
    const verified = await verifyHelper(token, c.env);
    if (!verified || verified.purpose === "track") return neutral();

    const tokenRow = (
      await db.select().from(emailTokens).where(eq(emailTokens.jti, verified.jti)).limit(1)
    )[0];
    if (!tokenRow) return neutral();
    if (tokenRow.usedAt) return alreadyRecorded();

    const entry = (
      await db
        .select({ entry: outreachEntries, contactEmail: companies.contactEmail })
        .from(outreachEntries)
        .innerJoin(companies, eq(companies.id, outreachEntries.companyId))
        .where(eq(outreachEntries.id, tokenRow.outreachEntryId))
        .limit(1)
    )[0];
    if (!entry) return neutral();

    const purpose: EmailTokenPurpose = verified.purpose;
    const form = await c.req.parseBody().catch(() => null);
    if (!form || typeof form !== "object") {
      return page(
        '<p style="color:#b91c1c">The form could not be read. Please go back and try again.</p>',
        400,
      );
    }

    const rawWorkersCount = form["workersCount"];
    const rawAvailableFrom = form["availableFrom"];
    const rawReason = form["reason"];

    let workersCount: number | null = null;
    let availableFrom: string | null = null;
    let reason: string | null = null;

    if (purpose === "accept" || purpose === "quote") {
      const parsed = Number(typeof rawWorkersCount === "string" ? rawWorkersCount : NaN);
      const from = typeof rawAvailableFrom === "string" ? rawAvailableFrom : "";
      if (!Number.isInteger(parsed) || parsed < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
        const brief = await loadBrief(db, entry.entry.id);
        if (!brief) return neutral();
        return formPage(
          token,
          purpose,
          brief,
          "Please provide the number of workers (at least 1) and the available-from date.",
        );
      }
      workersCount = parsed;
      availableFrom = from;
    } else {
      reason =
        typeof rawReason === "string" && rawReason.trim().length > 0 ? rawReason.trim() : null;
    }

    const type =
      purpose === "accept" ? "interest" : purpose === "quote" ? "quote" : "decline";
    const result = await buildRecordResponse(db, {
      requestId: entry.entry.requestId,
      companyId: entry.entry.companyId,
      type,
      workersCount,
      availableFrom,
      reason,
      actor: { actorUserId: null, actorEmail: entry.contactEmail },
      channel: "automated",
    });

    if (!result.ok) {
      if (result.error === "duplicate_response" || result.error.startsWith("request_is_")) {
        await db.batch([
          markEntryTokensUsedStatement(db, entry.entry.id),
        ] as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
        return result.error === "duplicate_response"
          ? alreadyRecorded()
          : noLongerOpen();
      }
      return neutral();
    }

    const cancelStatements =
      purpose === "decline"
        ? await buildDeclineCancellation(db, {
            requestId: result.requestId,
            reason,
            requestStatusBefore: result.requestStatusBefore,
            actor: { actorUserId: null, actorEmail: entry.contactEmail },
          })
        : [];

    await db.batch([
      markEntryTokensUsedStatement(db, entry.entry.id),
      ...result.statements,
      ...cancelStatements,
    ] as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);

    return confirmation();
  });

  app.get("/t/:file", async (c) => {
    const file = c.req.param("file");
    if (!file.endsWith(".gif")) return gif();
    const token = file.slice(0, -4);
    const verified = await verifyHelper(token, c.env);
    if (!verified || verified.purpose !== "track") return gif();

    const db = drizzle(c.env.DB);
    const tokenRow = (
      await db.select().from(emailTokens).where(eq(emailTokens.jti, verified.jti)).limit(1)
    )[0];
    if (!tokenRow || tokenRow.usedAt) return gif();

    const entry = (
      await db
        .select()
        .from(outreachEntries)
        .where(eq(outreachEntries.id, tokenRow.outreachEntryId))
        .limit(1)
    )[0];
    if (!entry) return gif();

    await db.batch([
      db
        .update(emailTokens)
        .set({ usedAt: new Date().toISOString() })
        .where(and(eq(emailTokens.jti, verified.jti), isNull(emailTokens.usedAt))),
      auditEventStatement(db, {
        actorUserId: null,
        actorEmail: null,
        entity: "outreach_entry",
        entityId: entry.id,
        action: "email_opened",
        channel: "automated",
        payload: { requestId: entry.requestId, companyId: entry.companyId },
      }),
    ] as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    return gif();
  });

  return app;
}

export const publicApp = createPublicApp();
