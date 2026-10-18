import { Hono } from "hono";
import { asc, count, eq, sql, sum } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { auditEvents, timeEntries } from "../db/schema";
import type { AppEnv } from "../app";

export const effortRouter = new Hono<AppEnv>();

effortRouter.post("/requests/:id/time", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const requestId = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_json" }, 400);
  const b = body as Record<string, unknown>;

  const minutes = typeof b.minutes === "number" ? b.minutes : 0;
  if (!Number.isInteger(minutes) || minutes < 1)
    return c.json({ error: "minutes_must_be_positive_integer" }, 400);

  const inserted = await db
    .insert(timeEntries)
    .values({
      requestId,
      userId: user.id,
      minutes,
      note: typeof b.note === "string" ? b.note : null,
    })
    .returning();
  return c.json(inserted[0], 201);
});

effortRouter.get("/requests/:id/effort", async (c) => {
  const db = drizzle(c.env.DB);
  const requestId = c.req.param("id");

  const [minutesRow] = await db
    .select({ totalMinutes: sum(timeEntries.minutes) })
    .from(timeEntries)
    .where(eq(timeEntries.requestId, requestId));
  const [eventsRow] = await db
    .select({ manualEvents: count() })
    .from(auditEvents)
    .where(sql`${auditEvents.entityId} = ${requestId} AND ${auditEvents.channel} = 'manual'`);

  const entries = await db
    .select()
    .from(timeEntries)
    .where(eq(timeEntries.requestId, requestId))
    .orderBy(asc(timeEntries.createdAt));

  return c.json({
    totalMinutes: Number(minutesRow?.totalMinutes ?? 0),
    manualEvents: Number(eventsRow?.manualEvents ?? 0),
    entries,
  });
});
