import { drizzle } from "drizzle-orm/d1";
import { sql } from "drizzle-orm";
import type { AppEnv } from "../app";
import { Hono } from "hono";
import { TRADE_PILOT_MINIMUMS, type Trade } from "../config";

export const dashboardRouter = new Hono<AppEnv>();

// Denominator rules (spec):
// - success rate excludes customer-cancelled requests
// - booking conversion excludes requests still open
// - time-to-response excludes automated responses (channel filter; cockpit era is manual)

type Metrics = {
  eligibleRequests: number;
  numerator: {
    qualifiedWithin24h: number;
    booked: number;
  };
  denominators: {
    successRate: number;
    conversion: number;
  };
  successRate: number | null;
  conversion: number | null;
  medianHoursToFirstQualified: number | null;
};

dashboardRouter.get("/overview", async (c) => {
  const db = drizzle(c.env.DB);
  const from = c.req.query("from") ?? "1970-01-01";
  const to = c.req.query("to") ?? "9999-12-31";

  const requestsResult = await db.all<{
    id: string;
    status: string;
    cancelledBy: string | null;
    approvedAt: string | null;
    firstQualifiedAt: string | null;
    bookedAt: string | null;
  }>(sql`
    SELECT r.id, r.status, r.cancelledBy,
      (SELECT occurredAt FROM audit_events e
        WHERE e.entity = 'request' AND e.entityId = r.id AND e.action = 'request_approved'
        ORDER BY e.occurredAt LIMIT 1) AS approvedAt,
      (SELECT e.occurredAt FROM audit_events e
        WHERE e.entity = 'request' AND e.entityId = r.id AND e.action = 'qualified_response'
          AND e.channel = 'manual'
        ORDER BY e.occurredAt LIMIT 1) AS firstQualifiedAt,
      (SELECT e.occurredAt FROM audit_events e
        WHERE e.entity = 'request' AND e.entityId = r.id AND e.action = 'booking_confirmed'
        ORDER BY e.occurredAt LIMIT 1) AS bookedAt
    FROM requests r
    WHERE r.createdAt >= ${from} AND r.createdAt <= ${to}
  `);

  const rows = requestsResult as unknown as Array<{
    id: string;
    status: string;
    cancelledBy: string | null;
    approvedAt: string | null;
    firstQualifiedAt: string | null;
    bookedAt: string | null;
  }>;

  // Eligible = requests that reached approval in range (the funnel starts at approval)
  const eligible = rows.filter((r) => r.approvedAt !== null);

  // Success-rate denominator: eligible minus customer-cancelled
  const successDenominator = eligible.filter((r) => !(r.status === "cancelled" && r.cancelledBy === "customer"));
  const qualifiedIn24h = successDenominator.filter((r) => {
    if (!r.approvedAt || !r.firstQualifiedAt) return false;
    const diffH =
      (new Date(r.firstQualifiedAt).getTime() - new Date(r.approvedAt).getTime()) / 3_600_000;
    return diffH <= 24;
  });

  // Conversion denominator: only closed requests (booked or definitively lost) — open ones excluded
  const conversionDenominator = rows.filter((r) =>
    ["booked", "closed"].includes(r.status),
  );
  const converted = conversionDenominator.filter((r) => r.bookedAt !== null);

  // Median time approval → first qualified response in business hours (Europe/Tallinn)
  const tz = "Europe/Tallinn";
  function businessHours(startIso: string, endIso: string): number {
    const DAY_MS = 3_600_000 * 24;
    let cursor = new Date(startIso);
    const end = new Date(endIso);
    let hours = 0;
    while (cursor < end && hours < 24 * 30) {
      const fmt = new Intl.DateTimeFormat("en-GB", {
        timeZone: tz,
        weekday: "short",
        hour: "numeric",
        hour12: false,
      });
      const parts = fmt.formatToParts(cursor);
      const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
      const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
      if (weekday !== "Sat" && weekday !== "Sun" && hour >= 9 && hour < 17) {
        hours += 1 / 12; // 5-minute increments
      }
      cursor = new Date(cursor.getTime() + DAY_MS / (24 * 12));
    }
    return hours;
  }

  const responseHours = successDenominator
    .filter((r) => r.approvedAt && r.firstQualifiedAt)
    .map((r) => businessHours(r.approvedAt!, r.firstQualifiedAt!))
    .sort((a, b) => a - b);
  const medianHours =
    responseHours.length === 0
      ? null
      : responseHours.length % 2 === 1
        ? responseHours[(responseHours.length - 1) / 2]!
        : (responseHours[responseHours.length / 2 - 1]! + responseHours[responseHours.length / 2]!) /
          2;

  const metrics: Metrics = {
    eligibleRequests: eligible.length,
    numerator: {
      qualifiedWithin24h: qualifiedIn24h.length,
      booked: converted.length,
    },
    denominators: {
      successRate: successDenominator.length,
      conversion: conversionDenominator.length,
    },
    successRate:
      successDenominator.length === 0
        ? null
        : qualifiedIn24h.length / successDenominator.length,
    conversion:
      conversionDenominator.length === 0 ? null : converted.length / conversionDenominator.length,
    medianHoursToFirstQualified: medianHours,
  };
  return c.json(metrics);
});

dashboardRouter.get("/supply", async (c) => {
  const db = drizzle(c.env.DB);
  const result = await db.all<{ trade: string; providers: number }>(sql`
    SELECT s.trade AS trade, COUNT(DISTINCT s.companyId) AS providers
    FROM services s
    JOIN companies c ON c.id = s.companyId
    WHERE c.status = 'active' AND s.status = 'active'
    GROUP BY s.trade
  `);
  const counts = new Map(
    (result as unknown as Array<{ trade: string; providers: number }>).map((r) => [
      r.trade,
      r.providers,
    ]),
  );
  return c.json(
    Object.entries(TRADE_PILOT_MINIMUMS).map(([trade, minimum]) => ({
      trade,
      minimum,
      activeProviders: counts.get(trade) ?? 0,
      met: (counts.get(trade) ?? 0) >= minimum,
    })),
  );
});

dashboardRouter.get("/effort", async (c) => {
  const db = drizzle(c.env.DB);

  const perRequest = await db.all<{
    id: string;
    title: string;
    status: string;
    createdAt: string;
    totalMinutes: number;
  }>(sql`
    SELECT r.id, r.title, r.status, r.createdAt,
      COALESCE((SELECT SUM(t.minutes) FROM time_entries t WHERE t.requestId = r.id), 0) AS totalMinutes,
      (SELECT COUNT(*) FROM audit_events e WHERE e.entityId = r.id AND e.entity = 'request' AND e.channel = 'manual') AS manualEvents
    FROM requests r
    ORDER BY r.createdAt DESC
  `);
  const perRequestRows = (perRequest as unknown as Array<{
    id: string;
    title: string;
    status: string;
    createdAt: string;
    totalMinutes: number;
    manualEvents: number;
  }>).map((r) => ({ ...r, totalMinutes: Number(r.totalMinutes) }));

  // Monday-of-week bucket per row source, then merge in JS
  const weeklyMinutes = await db.all<{ week: string; minutes: number }>(sql`
    SELECT date(t.createdAt, 'weekday 1', '-6 days') AS week, SUM(t.minutes) AS minutes
    FROM time_entries t
    GROUP BY week
    ORDER BY week
  `);
  const weeklyEvents = await db.all<{ week: string; interventions: number }>(sql`
    SELECT date(e.occurredAt, 'weekday 1', '-6 days') AS week, COUNT(*) AS interventions
    FROM audit_events e
    WHERE e.channel = 'manual'
    GROUP BY week
    ORDER BY week
  `);

  const byWeek = new Map<string, { week: string; minutes: number; interventions: number }>();
  for (const row of weeklyMinutes as unknown as Array<{ week: string; minutes: number }>) {
    const entry = byWeek.get(row.week) ?? { week: row.week, minutes: 0, interventions: 0 };
    entry.minutes = Number(row.minutes);
    byWeek.set(row.week, entry);
  }
  for (const row of weeklyEvents as unknown as Array<{
    week: string;
    interventions: number;
  }>) {
    const entry = byWeek.get(row.week) ?? { week: row.week, minutes: 0, interventions: 0 };
    entry.interventions = Number(row.interventions);
    byWeek.set(row.week, entry);
  }

  return c.json({
    perRequest: perRequestRows,
    weekly: [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week)),
  });
});
