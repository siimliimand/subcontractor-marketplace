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

type EmailMetrics = {
  sent: number;
  delivered: number;
  bounced: number;
  opened: number;
  automatedQualified: number;
  manualQualified: number;
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
  // Email pipeline counts: lifecycle events plus automated-vs-manual qualified split
  const emailActionRows = await db.all<{ action: string; n: number }>(sql`
    SELECT action, COUNT(*) AS n
    FROM audit_events
    WHERE action IN ('email_sent', 'email_delivered', 'email_bounced', 'email_opened')
    GROUP BY action
  `);
  const actionCounts = new Map(
    (emailActionRows as unknown as Array<{ action: string; n: number }>).map((r) => [
      r.action,
      Number(r.n),
    ]),
  );
  const qualifiedChannelRows = await db.all<{ channel: string; n: number }>(sql`
    SELECT channel, COUNT(*) AS n
    FROM audit_events
    WHERE action = 'qualified_response'
    GROUP BY channel
  `);
  const channelCounts = new Map(
    (qualifiedChannelRows as unknown as Array<{ channel: string; n: number }>).map((r) => [
      r.channel,
      Number(r.n),
    ]),
  );
  const email: EmailMetrics = {
    sent: actionCounts.get("email_sent") ?? 0,
    delivered: actionCounts.get("email_delivered") ?? 0,
    bounced: actionCounts.get("email_bounced") ?? 0,
    opened: actionCounts.get("email_opened") ?? 0,
    automatedQualified: channelCounts.get("automated") ?? 0,
    manualQualified: channelCounts.get("manual") ?? 0,
  };

  // Booking flow (phase 2): requested → confirmed counts from the funnel events
  const bookingFlowRows = await db.all<{ action: string; n: number }>(sql`
    SELECT action, COUNT(*) AS n
    FROM audit_events
    WHERE action IN ('booking_requested', 'booking_confirmed')
    GROUP BY action
  `);
  const bookingCounts = new Map(
    (bookingFlowRows as unknown as Array<{ action: string; n: number }>).map((r) => [
      r.action,
      Number(r.n),
    ]),
  );
  const bookingRequested = bookingCounts.get("booking_requested") ?? 0;
  const bookingConfirmed = bookingCounts.get("booking_confirmed") ?? 0;

  return c.json({
    ...metrics,
    bookingFlow: {
      requested: bookingRequested,
      confirmed: bookingConfirmed,
      conversion: bookingRequested === 0 ? null : bookingConfirmed / bookingRequested,
    },
    email,
  });
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

dashboardRouter.get("/effort", async (c) => {  const db = drizzle(c.env.DB);

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

// ---------------------------------------------------------------------------
// Phase 3: weekly pilot dashboard (docs/details/08).
//
// Bucketing: Monday-of-week (UTC) of the anchor timestamp. Cohort metrics
// (success rate, conversion, time-to-response) bucket by the request's
// approval week and are evaluated over the cohort's lifetime; activity
// metrics (new requests, outreach, effort, failures) bucket by event week.
// Every metric with an empty denominator is `null` — the UI renders "no
// data", never 0%. Repeat usage groups by requests.pmName (free-text PM
// identity — documented limitation until partners have accounts).
// ---------------------------------------------------------------------------

function weekStartIso(timestamp: string | null | undefined): string | null {
  if (!timestamp) return null;
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return null;
  const day = (d.getUTCDay() + 6) % 7; // Mon = 0
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

export type WeeklyRow = {
  week: string;
  newPms: number;
  activePms: number;
  newRequests: number;
  completedRequests: number;
  successRate: number | null;
  medianHoursToFirstQualified: number | null;
  providersContacted: number;
  providersContactedPerRequest: number | null;
  bookingConfirmed: number;
  bookingConversion: number | null;
  availabilityConfirmationRate: number | null;
  failedCommitments: number;
  repeatUsage: number | null;
  manualMinutes: number;
  manualEvents: number;
  adoptionShare: number | null;
};

export async function computeWeeklyDashboard(
  db: ReturnType<typeof drizzle>,
  from: string,
  to: string,
): Promise<WeeklyRow[]> {
  const requestResult = await db.all<{
    id: string;
    pmName: string | null;
    status: string;
    cancelledBy: string | null;
    createdAt: string;
    approvedAt: string | null;
    firstQualifiedAt: string | null;
    bookedAt: string | null;
    outreachCount: number;
  }>(sql`
    SELECT r.id, r.pmName, r.status, r.cancelledBy, r.createdAt,
      (SELECT occurredAt FROM audit_events e
        WHERE e.entity = 'request' AND e.entityId = r.id AND e.action = 'request_approved'
        ORDER BY e.occurredAt LIMIT 1) AS approvedAt,
      (SELECT e.occurredAt FROM audit_events e
        WHERE e.entity = 'request' AND e.entityId = r.id AND e.action = 'qualified_response'
          AND e.channel = 'manual'
        ORDER BY e.occurredAt LIMIT 1) AS firstQualifiedAt,
      (SELECT e.occurredAt FROM audit_events e
        WHERE e.entity = 'request' AND e.entityId = r.id AND e.action = 'booking_confirmed'
        ORDER BY e.occurredAt LIMIT 1) AS bookedAt,
      (SELECT COUNT(*) FROM outreach_entries o WHERE o.requestId = r.id) AS outreachCount
    FROM requests r
    WHERE r.createdAt >= ${from} AND r.createdAt <= ${to || "9999-12-31"}
  `);
  const requests = requestResult as unknown as Array<{
    id: string;
    pmName: string | null;
    status: string;
    cancelledBy: string | null;
    createdAt: string;
    approvedAt: string | null;
    firstQualifiedAt: string | null;
    bookedAt: string | null;
    outreachCount: number;
  }>;

  // Business-hours helper (Europe/Tallinn) shared with the weekly median.
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
        hours += 1 / 12;
      }
      cursor = new Date(cursor.getTime() + DAY_MS / (24 * 12));
    }
    return hours;
  }

  const [responseRows, outreachRows, failureRows, effortRows, declarationRows, activeProviderRows] =
    await Promise.all([
      db.all<{ receivedAt: string; type: string; workersCount: number | null }>(sql`
        SELECT receivedAt, type, workersCount FROM responses
        WHERE receivedAt >= ${from} AND receivedAt <= ${to || "9999-12-31"}
      `),
      db.all<{ sentAt: string | null }>(sql`
        SELECT sentAt FROM outreach_entries
        WHERE sentAt >= ${from} AND sentAt <= ${to || "9999-12-31"}
      `),
      db.all<{ occurredAt: string; action: string }>(sql`
        SELECT occurredAt, action FROM audit_events
        WHERE action IN ('accepted_but_not_delivered', 'booking_cancelled', 'booking_confirmed')
          AND occurredAt >= ${from} AND occurredAt <= ${to || "9999-12-31"}
      `),
      db.all<{ createdAt: string; minutes: number }>(sql`
        SELECT createdAt, minutes FROM time_entries
        WHERE createdAt >= ${from} AND createdAt <= ${to || "9999-12-31"}
      `),
      db.all<{ channel: string; lastConfirmedAt: string }>(sql`
        SELECT a.channel, a.lastConfirmedAt
        FROM availability_declarations a
      `),
      db.all<{ n: number }>(sql`
        SELECT COUNT(*) AS n FROM companies WHERE status = 'active'
      `),
    ]);

  const responses = (responseRows as unknown as Array<{ receivedAt: string; type: string; workersCount: number | null }>).filter(
    (r) => weekStartIso(r.receivedAt) !== null,
  );
  const outreachByWeek = new Map<string, number>();
  for (const o of outreachRows as unknown as Array<{ sentAt: string | null }>) {
    const w = weekStartIso(o.sentAt);
    if (!w) continue;
    outreachByWeek.set(w, (outreachByWeek.get(w) ?? 0) + 1);
  }
  const failuresByWeek = new Map<string, number>();
  const confirmedByWeek = new Map<string, number>();
  for (const e of failureRows as unknown as Array<{ occurredAt: string; action: string }>) {
    const w = weekStartIso(e.occurredAt);
    if (!w) continue;
    if (e.action === "booking_confirmed") {
      confirmedByWeek.set(w, (confirmedByWeek.get(w) ?? 0) + 1);
    } else if (e.action === "accepted_but_not_delivered" || e.action === "booking_cancelled") {
      failuresByWeek.set(w, (failuresByWeek.get(w) ?? 0) + 1);
    }
  }
  const effortByWeek = new Map<string, { minutes: number; events: number }>();
  for (const row of effortRows as unknown as Array<{ createdAt: string; minutes: number }>) {
    const w = weekStartIso(row.createdAt);
    if (!w) continue;
    const entry = effortByWeek.get(w) ?? { minutes: 0, events: 0 };
    entry.minutes += Number(row.minutes);
    entry.events += 1;
    effortByWeek.set(w, entry);
  }

  // Adoption share as-of a week end: booking_system declarations confirmed on
  // or before that Sunday ÷ active providers (constant snapshot denominator).
  const activeProviders = Number((activeProviderRows as unknown as Array<{ n: number }>)[0]?.n ?? 0);

  // Collect the week range: every week that has any request, plus the range
  // bounds, sorted.
  const weekSet = new Set<string>();
  for (const r of requests) {
    for (const t of [r.createdAt, r.approvedAt, r.bookedAt]) {
      const w = weekStartIso(t);
      if (w) weekSet.add(w);
    }
  }
  for (const w of [
    ...outreachByWeek.keys(),
    ...failuresByWeek.keys(),
    ...confirmedByWeek.keys(),
    ...effortByWeek.keys(),
  ]) {
    weekSet.add(w);
  }
  const fromWeek = weekStartIso(new Date(from).toISOString());
  if (fromWeek) weekSet.add(fromWeek);
  const weeks = [...weekSet].filter((w) => !to || w <= (to || "9999-12-31")).sort();

  const rows: WeeklyRow[] = weeks.map((week) => {
    const weekEndDate = new Date(`${week}T00:00:00Z`);
    weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 7); // exclusive end

    // Activity (event-week buckets)
    const newRequests = requests.filter(
      (r) => weekStartIso(r.createdAt) === week,
    );
    const newPms = new Set(
      newRequests.map((r) => r.pmName).filter((p): p is string => !!p),
    );
    const cohortApproved = requests.filter(
      (r) => weekStartIso(r.approvedAt) === week,
    );
    const successDenominator = cohortApproved.filter(
      (r) => !(r.status === "cancelled" && r.cancelledBy === "customer"),
    );
    const qualifiedIn24h = successDenominator.filter((r) => {
      if (!r.approvedAt || !r.firstQualifiedAt) return false;
      return (
        (new Date(r.firstQualifiedAt).getTime() - new Date(r.approvedAt).getTime()) / 3_600_000 <=
        24
      );
    });
    const responseHours = successDenominator
      .filter((r) => r.approvedAt && r.firstQualifiedAt)
      .map((r) => businessHours(r.approvedAt!, r.firstQualifiedAt!))
      .sort((a, b) => a - b);
    const median =
      responseHours.length === 0
        ? null
        : responseHours.length % 2 === 1
          ? responseHours[(responseHours.length - 1) / 2]!
          : (responseHours[responseHours.length / 2 - 1]! + responseHours[responseHours.length / 2]!) / 2;

    // Conversion + completion: cohort semantics over the approved-in-week set.
    const cohortDecided = cohortApproved.filter((r) =>
      ["booked", "closed"].includes(r.status),
    );
    const cohortBooked = cohortApproved.filter((r) => r.bookedAt !== null);

    const contacted = outreachByWeek.get(week) ?? 0;

    // Availability confirmation (response-week bucket): responses declaring
    // workers ÷ all responses minus provider declines.
    const weekResponses = responses.filter(
      (r) => weekStartIso(r.receivedAt) === week,
    );
    const availabilityDenominator = weekResponses.filter((r) => r.type !== "decline");
    const availabilityNumerator = availabilityDenominator.filter(
      (r) => (r.workersCount ?? 0) > 0,
    );

    // Repeat usage (cumulative through end of week): PMs with ≥2 requests ÷ PMs active.
    const pmsToDate = new Map<string, number>();
    for (const r of requests) {
      if (!r.pmName || !r.createdAt || new Date(r.createdAt) > weekEndDate) continue;
      pmsToDate.set(r.pmName, (pmsToDate.get(r.pmName) ?? 0) + 1);
    }
    const activePms = pmsToDate.size;
    const repeatPms = [...pmsToDate.values()].filter((n) => n >= 2).length;

    // Adoption share as-of week end.
    const bsDeclarations = declarationRows.filter(
      (d) =>
        d.channel === "booking_system" &&
        weekStartIso(d.lastConfirmedAt) !== null &&
        new Date(d.lastConfirmedAt) <= weekEndDate,
    ).length;

    const effort = effortByWeek.get(week) ?? { minutes: 0, events: 0 };

    return {
      week,
      newPms: newPms.size,
      activePms,
      newRequests: newRequests.length,
      completedRequests: cohortBooked.length,
      successRate:
        successDenominator.length === 0 ? null : qualifiedIn24h.length / successDenominator.length,
      medianHoursToFirstQualified: median,
      providersContacted: contacted,
      providersContactedPerRequest:
        newRequests.length === 0 ? null : contacted / newRequests.length,
      bookingConfirmed: confirmedByWeek.get(week) ?? 0,
      bookingConversion:
        cohortDecided.length === 0 ? null : cohortBooked.length / cohortDecided.length,
      availabilityConfirmationRate:
        availabilityDenominator.length === 0
          ? null
          : availabilityNumerator.length / availabilityDenominator.length,
      failedCommitments: failuresByWeek.get(week) ?? 0,
      repeatUsage: activePms === 0 ? null : repeatPms / activePms,
      manualMinutes: Number(effort.minutes),
      manualEvents: Number(effort.events),
      adoptionShare: activeProviders === 0 ? null : bsDeclarations / activeProviders,
    };
  });

  return rows;
}

dashboardRouter.get("/weekly", async (c) => {
  const db = drizzle(c.env.DB);
  const to = c.req.query("to") ?? new Date().toISOString().slice(0, 10);
  const from =
    c.req.query("from") ??
    new Date(Date.now() - 8 * 7 * 24 * 3_600_000).toISOString().slice(0, 10);
  const rows = await computeWeeklyDashboard(db, from, to);
  return c.json({ from, to, weeks: rows });
});

const WEEKLY_COLUMNS: { key: keyof WeeklyRow; label: string }[] = [
  { key: "newPms", label: "new_pms" },
  { key: "activePms", label: "active_pms" },
  { key: "newRequests", label: "new_requests" },
  { key: "completedRequests", label: "completed_requests" },
  { key: "successRate", label: "success_rate" },
  { key: "medianHoursToFirstQualified", label: "median_hours_to_first_qualified" },
  { key: "providersContacted", label: "providers_contacted" },
  { key: "providersContactedPerRequest", label: "providers_contacted_per_request" },
  { key: "bookingConfirmed", label: "booking_confirmed" },
  { key: "bookingConversion", label: "booking_conversion" },
  { key: "availabilityConfirmationRate", label: "availability_confirmation_rate" },
  { key: "failedCommitments", label: "failed_commitments" },
  { key: "repeatUsage", label: "repeat_usage" },
  { key: "manualMinutes", label: "manual_minutes" },
  { key: "manualEvents", label: "manual_events" },
  { key: "adoptionShare", label: "adoption_share" },
];

/** CSV export for the Monday metrics review — one row per week, no data = empty cell. */
dashboardRouter.get("/export.csv", async (c) => {
  const db = drizzle(c.env.DB);
  const to = c.req.query("to") ?? new Date().toISOString().slice(0, 10);
  const from =
    c.req.query("from") ??
    new Date(Date.now() - 8 * 7 * 24 * 3_600_000).toISOString().slice(0, 10);
  const rows = await computeWeeklyDashboard(db, from, to);

  const header = ["week", ...WEEKLY_COLUMNS.map((col) => col.label)].join(",");
  const lines = rows.map((row) =>
    [
      row.week,
      ...WEEKLY_COLUMNS.map((col) => {
        const value = row[col.key];
        return value === null || value === undefined ? "" : String(value);
      }),
    ].join(","),
  );
  const csv = `${header}\n${lines.join("\n")}\n`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="weekly-dashboard-${to}.csv"`,
    },
  });
});
