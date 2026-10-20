import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";

const uuid = () => text().$defaultFn(() => crypto.randomUUID());

const nowIso = () => text().$defaultFn(() => new Date().toISOString());

export const users = sqliteTable("users", {
  id: uuid().primaryKey(),
  email: text().notNull().unique(),
  role: text().notNull().default("staff"),
  createdAt: nowIso(),
  lastLoginAt: text(),
});

export const companies = sqliteTable(
  "companies",
  {
    id: uuid().primaryKey(),
    legalName: text().notNull(),
    registrationIdentifier: text().notNull(),
    contactEmail: text().notNull(),
    contactPhone: text(),
    status: text().notNull().default("active"),
    statusReason: text(),
    statusChangedAt: text(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  (t) => ({
    idx0: uniqueIndex("companies_registration_identifier_unique").on(t.registrationIdentifier),
    idx1: index("companies_status_idx").on(t.status),
  }),
);

export const services = sqliteTable(
  "services",
  {
    id: uuid().primaryKey(),
    companyId: text()
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    trade: text().notNull(),
    skills: text(),
    serviceArea: text().notNull(),
    pricingApproach: text(),
    pricingModel: text().notNull(),
    status: text().notNull().default("active"),
    statusReason: text(),
    statusChangedAt: text(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  (t) => ({
    idx0: index("services_company_idx").on(t.companyId),
    idx1: index("services_trade_idx").on(t.trade),
  }),
);

export const requests = sqliteTable(
  "requests",
  {
    id: uuid().primaryKey(),
    title: text().notNull(),
    description: text().notNull(),
    location: text().notNull(),
    trade: text().notNull(),
    startDate: text().notNull(),
    crewSize: integer().notNull(),
    budget: text(),
    duration: text(),
    notes: text(),
    pmName: text(),
    status: text().notNull().default("draft"),
    cancelledBy: text(),
    cancelReason: text(),
    createdBy: text()
      .notNull()
      .references(() => users.id),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  (t) => ({
    idx0: index("requests_status_idx").on(t.status),
    idx1: index("requests_trade_idx").on(t.trade),
  }),
);

/**
 * Multi-trade requests (Decision 3): the required-trades set. `requests.trade`
 * stays NOT NULL as the primary trade; this relation carries the full set.
 */
export const requestTrades = sqliteTable(
  "request_trades",
  {
    id: uuid().primaryKey(),
    requestId: text()
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    trade: text().notNull(),
    isPrimary: integer().notNull().default(0),
  },
  (t) => ({
    idx0: uniqueIndex("request_trades_request_trade_unique").on(t.requestId, t.trade),
    idx1: index("request_trades_trade_idx").on(t.trade),
  }),
);

export const AVAILABILITY_CHANNELS = ["booking_system", "email_only"] as const;

export type AvailabilityChannel = (typeof AVAILABILITY_CHANNELS)[number];

/** Capacity model: people per trade per day, freshness keyed off lastConfirmedAt. */
export const availabilityDeclarations = sqliteTable(
  "availability_declarations",
  {
    id: uuid().primaryKey(),
    companyId: text()
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    trade: text().notNull(),
    workersCount: integer().notNull(),
    dateFrom: text().notNull(),
    dateTo: text().notNull(),
    channel: text().notNull().default("booking_system"),
    lastConfirmedAt: text().notNull(),
    notes: text(),
    createdBy: text().references(() => users.id),
    createdAt: nowIso(),
  },
  (t) => ({
    idx0: index("availability_company_trade_idx").on(t.companyId, t.trade),
    idx1: index("availability_confirmed_idx").on(t.lastConfirmedAt),
  }),
);

export const responses = sqliteTable(
  "responses",
  {
    id: uuid().primaryKey(),
    requestId: text()
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    companyId: text()
      .notNull()
      .references(() => companies.id),
    type: text().notNull(),
    workersCount: integer(),
    availableFrom: text(),
    reason: text(),
    receivedAt: nowIso(),
    createdBy: text().references(() => users.id),
  },
  (t) => ({
    idx0: index("responses_request_idx").on(t.requestId),
  }),
);

export const bookings = sqliteTable(
  "bookings",
  {
    id: uuid().primaryKey(),
    requestId: text()
      .notNull()
      .unique()
      .references(() => requests.id, { onDelete: "cascade" }),
    responseId: text()
      .notNull()
      .references(() => responses.id),
    companyId: text()
      .notNull()
      .references(() => companies.id),
    // Phase 2: required for first-confirmed-wins capacity checks (per-trade).
    // Legacy rows created before this column exist carry the DEFAULT '' value;
    // the app always sets a real trade on new bookings.
    trade: text().notNull().default(""),
    startDate: text().notNull(),
    endDate: text().notNull(),
    workersCount: integer().notNull(),
    outcome: text(),
    outcomeReason: text(),
    outcomeAt: text(),
    createdBy: text()
      .notNull()
      .references(() => users.id),
    createdAt: nowIso(),
  },
  (t) => ({
    idx0: index("bookings_company_idx").on(t.companyId),
    idx1: index("bookings_company_trade_idx").on(t.companyId, t.trade),
  }),
);

export const EMAIL_STATUSES = ["sent", "delivered", "bounced", "opened", "skipped"] as const;

export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const outreachEntries = sqliteTable(
  "outreach_entries",
  {
    id: uuid().primaryKey(),
    requestId: text()
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    companyId: text()
      .notNull()
      .references(() => companies.id),
    batchNumber: text().notNull(),
    contactedBy: text()
      .notNull()
      .references(() => users.id),
    channel: text().notNull().default("manual"),
    // Phase 2: matching-generated entries record the trade they target and the
    // transparent ranking breakdown that selected this candidate.
    trade: text(),
    matchScore: real(),
    matchFactorsJson: text(),
    emailStatus: text(),
    emailSkippedReason: text(),
    sentAt: nowIso(),
    notes: text(),
  },
  (t) => ({
    idx0: uniqueIndex("outreach_request_company_unique").on(t.requestId, t.companyId),
    idx1: index("outreach_batch_idx").on(t.batchNumber),
    idx2: index("outreach_email_status_idx").on(t.emailStatus),
  }),
);

export const EMAIL_TOKEN_PURPOSES = ["accept", "quote", "decline", "track"] as const;

export type EmailTokenPurpose = (typeof EMAIL_TOKEN_PURPOSES)[number];

export const emailTokens = sqliteTable(
  "email_tokens",
  {
    id: uuid().primaryKey(),
    jti: text().notNull().unique(),
    outreachEntryId: text()
      .notNull()
      .references(() => outreachEntries.id, { onDelete: "cascade" }),
    purpose: text().notNull(),
    expiresAt: text().notNull(),
    usedAt: text(),
    createdAt: nowIso(),
  },
  (t) => ({
    idx0: index("email_tokens_entry_idx").on(t.outreachEntryId),
  }),
);

export const emailSuppressions = sqliteTable(
  "email_suppressions",
  {
    email: text().primaryKey(),
    reason: text().notNull(),
    createdAt: nowIso(),
  },
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: uuid().primaryKey(),
    actorUserId: text(),
    actorEmail: text(),
    occurredAt: nowIso(),
    entity: text().notNull(),
    entityId: text(),
    action: text().notNull(),
    payloadJson: text(),
    channel: text().notNull().default("manual"),
  },
  (t) => ({
    idx0: index("audit_events_entity_idx").on(t.entity, t.entityId),
    idx1: index("audit_events_action_idx").on(t.action),
    idx2: index("audit_events_occurred_idx").on(t.occurredAt),
  }),
);

export const timeEntries = sqliteTable(
  "time_entries",
  {
    id: uuid().primaryKey(),
    requestId: text()
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => users.id),
    minutes: integer().notNull(),
    note: text(),
    createdAt: nowIso(),
  },
  (t) => ({
    idx0: index("time_entries_request_idx").on(t.requestId),
  }),
);

export const BOOKING_REQUEST_STATES = ["requested", "confirmed", "withdrawn"] as const;

export type BookingRequestState = (typeof BOOKING_REQUEST_STATES)[number];

/**
 * Phase 2 booking flow: a booking request (recording intent) precedes the
 * explicit confirmation that inserts the `bookings` row. Only a confirmation
 * sets the request status to `booked`.
 */
export const bookingRequests = sqliteTable(
  "booking_requests",
  {
    id: uuid().primaryKey(),
    requestId: text()
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    responseId: text().references(() => responses.id),
    holdId: text(),
    companyId: text()
      .notNull()
      .references(() => companies.id),
    trade: text().notNull(),
    startDate: text().notNull(),
    endDate: text().notNull(),
    workersCount: integer().notNull(),
    state: text().notNull().default("requested"),
    requestedBy: text()
      .notNull()
      .references(() => users.id),
    confirmedBy: text().references(() => users.id),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  (t) => ({
    idx0: index("booking_requests_request_idx").on(t.requestId),
  }),
);

export const HOLD_STATES = ["active", "expired", "superseded", "released"] as const;

export type HoldState = (typeof HOLD_STATES)[number];

export const HOLD_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * Advisory 48-hour holds on provider capacity. Expiry is lazy: readers and
 * writers first flip active holds past `expiresAt` to `expired` in the same
 * batch, so no cron is needed.
 */
export const holds = sqliteTable(
  "holds",
  {
    id: uuid().primaryKey(),
    requestId: text()
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    companyId: text()
      .notNull()
      .references(() => companies.id),
    trade: text().notNull(),
    startDate: text().notNull(),
    endDate: text().notNull(),
    workersCount: integer().notNull(),
    state: text().notNull().default("active"),
    releasedReason: text(),
    expiresAt: text().notNull(),
    createdBy: text()
      .notNull()
      .references(() => users.id),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  (t) => ({
    idx0: index("holds_company_trade_idx").on(t.companyId, t.trade),
    idx1: index("holds_request_idx").on(t.requestId),
  }),
);

/**
 * AI brief builder (phase 2): the model's proposal and the approved final are
 * both stored so the PM-edit delta stays auditable. Unapproved drafts are
 * inert — they never create requests or outreach.
 */
export const briefProposals = sqliteTable(
  "brief_proposals",
  {
    id: uuid().primaryKey(),
    requestId: text().references(() => requests.id, { onDelete: "set null" }),
    sourceText: text().notNull(),
    proposedJson: text().notNull(),
    missingFields: text(),
    finalJson: text(),
    model: text().notNull(),
    state: text().notNull().default("drafted"),
    createdBy: text()
      .notNull()
      .references(() => users.id),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
  (t) => ({
    idx0: index("brief_proposals_request_idx").on(t.requestId),
  }),
);
