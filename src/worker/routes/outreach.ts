import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { BatchItem } from "drizzle-orm/batch";
import { companies, outreachEntries, requests } from "../db/schema";
import type { AppEnv } from "../app";
import { auditEventStatement } from "../events";
import type { RequestStatus } from "../config";

export const outreachRouter = new Hono<AppEnv>();

outreachRouter.post("/requests/:id/outreach", async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const requestId = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_json" }, 400);
  const b = body as Record<string, unknown>;

  const request = (await db.select().from(requests).where(eq(requests.id, requestId)).limit(1))[0];
  if (!request) return c.json({ error: "not_found" }, 404);
  if (["booked", "cancelled", "closed"].includes(request.status))
    return c.json(
      { error: `request_is_${request.status}: closed for outreach` },
      400,
    );

  const providerIds = Array.isArray(b.providerIds) ? b.providerIds : [];
  if (providerIds.length === 0 || !providerIds.every((p) => typeof p === "string"))
    return c.json({ error: "provider_ids_required" }, 400);

  const notes = typeof b.notes === "string" ? b.notes : null;
  const batchNumber =
    typeof b.batchNumber === "string" && b.batchNumber.trim()
      ? b.batchNumber.trim()
      : `B-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 7)}`;

  const providers = await db
    .select()
    .from(companies)
    .where(inArray(companies.id, providerIds as string[]));

  const rejected: { companyId: string; reason: string }[] = [];
  const acceptedIds: string[] = [];
  for (const id of providerIds as string[]) {
    const provider = providers.find((p) => p.id === id);
    if (!provider) {
      rejected.push({ companyId: id, reason: "provider_not_found" });
      continue;
    }
    if (provider.status === "opted_out") {
      rejected.push({
        companyId: id,
        reason: `provider_opted_out${provider.statusReason ? `: ${provider.statusReason}` : ""}`,
      });
      continue;
    }
    const existing = (
      await db
        .select()
        .from(outreachEntries)
        .where(
          and(eq(outreachEntries.requestId, requestId), eq(outreachEntries.companyId, id)),
        )
        .limit(1)
    )[0];
    if (existing) {
      rejected.push({
        companyId: id,
        reason: `duplicate_outreach: already contacted in batch ${existing.batchNumber}`,
      });
      continue;
    }
    acceptedIds.push(id);
  }

  if (acceptedIds.length > 0) {
    const statements: unknown[] = acceptedIds.map((companyId) =>
      db.insert(outreachEntries).values({
        requestId,
        companyId,
        batchNumber,
        contactedBy: user.id,
        channel: "manual",
        notes,
      }),
    );
    for (const companyId of acceptedIds) {
      statements.push(
        auditEventStatement(db, {
          actorUserId: user.id,
          actorEmail: user.email,
          entity: "request",
          entityId: requestId,
          action: "outreach_sent",
          payload: { companyId, batchNumber, channel: "manual" },
        }),
      );
    }
    if (request.status === "matched") {
      statements.push(
        db
          .update(requests)
          .set({ status: "in_outreach", updatedAt: new Date().toISOString() })
          .where(eq(requests.id, requestId)),
      );
    }
    await db.batch(statements as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }

  const after = request.status as RequestStatus;
  return c.json(
    {
      batchNumber,
      accepted: acceptedIds,
      rejected,
      requestStatus: acceptedIds.length > 0 && after === "matched" ? "in_outreach" : after,
    },
    acceptedIds.length > 0 ? 201 : 400,
  );
});

outreachRouter.get("/requests/:id/outreach", async (c) => {
  const db = drizzle(c.env.DB);
  const requestId = c.req.param("id");
  const entries = await db
    .select()
    .from(outreachEntries)
    .where(eq(outreachEntries.requestId, requestId));
  return c.json(entries);
});
