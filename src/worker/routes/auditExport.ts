import { Hono } from "hono";
import { and, asc, eq, gte, lte, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { auditEvents } from "../db/schema";
import type { AppEnv } from "../app";
import { auditEventStatement } from "../events";

export const auditExportRouter = new Hono<AppEnv>();

/**
 * Phase 4: exportable audit trail. Staff-only (Access guard upstream), CSV
 * streamed in pages so even large ranges don't buffer whole exports, row cap
 * with an explicit truncation marker. The export itself is an audit event
 * with its filter parameters — exports are never silent.
 */

const PAGE_SIZE = 1000;
const MAX_ROWS = 50_000;
const MAX_SPAN_DAYS = 366;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

auditExportRouter.get("/audit/export", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const { from, to, companyId, action } = c.req.query();

  if (!DATE_RE.test(from ?? "") || !DATE_RE.test(to ?? ""))
    return c.json({ error: "invalid_range: from and to are required as YYYY-MM-DD" }, 400);
  if (from! > to!) return c.json({ error: "invalid_range: from <= to required" }, 400);
  const spanDays = (new Date(to!).getTime() - new Date(from!).getTime()) / 86_400_000;
  if (spanDays > MAX_SPAN_DAYS)
    return c.json({ error: `range_too_wide: max ${MAX_SPAN_DAYS} days` }, 400);

  const fromIso = `${from}T00:00:00.000Z`;
  const toIso = `${to}T23:59:59.999Z`;
  const conditions: SQL[] = [gte(auditEvents.occurredAt, fromIso), lte(auditEvents.occurredAt, toIso)];
  // Company filter: audit rows tied directly to a company entity. (Events on
  // related entities are not company-tagged; a company-scoped export is
  // honestly scoped to the company's own lifecycle events.)
  if (companyId) {
    conditions.push(eq(auditEvents.entity, "company"));
    conditions.push(eq(auditEvents.entityId, companyId));
  }
  if (action) conditions.push(eq(auditEvents.action, action));

  const filters = { from: from!, to: to!, companyId: companyId ?? null, action: action ?? null };
  const where = and(...conditions);
  const header = "occurredAt,actorEmail,entity,entityId,action,channel,payloadJson";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(`${header}\n`));
      let offset = 0;
      let total = 0;
      try {
        while (total < MAX_ROWS) {
          const rows = await db
            .select()
            .from(auditEvents)
            .where(where)
            .orderBy(asc(auditEvents.occurredAt))
            .limit(PAGE_SIZE)
            .offset(offset);
          if (rows.length === 0) break;
          const chunk = rows
            .map((r) =>
              [
                r.occurredAt,
                r.actorEmail,
                r.entity,
                r.entityId,
                r.action,
                r.channel,
                r.payloadJson,
              ]
                .map(csvCell)
                .join(","),
            )
            .join("\n");
          controller.enqueue(encoder.encode(`${chunk}\n`));
          total += rows.length;
          offset += PAGE_SIZE;
          if (rows.length < PAGE_SIZE) break;
        }
        if (total >= MAX_ROWS) {
          controller.enqueue(encoder.encode(`# truncated at ${MAX_ROWS} rows — narrow the range\n`));
        }
      } finally {
        controller.close();
      }

      await db.batch([
        auditEventStatement(db, {
          actorUserId: user.id,
          actorEmail: user.email,
          entity: "audit_export",
          entityId: null,
          action: "audit_exported",
          payload: { ...filters, rows: total },
        }),
      ]);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-${from}-to-${to}.csv"`,
    },
  });
});
