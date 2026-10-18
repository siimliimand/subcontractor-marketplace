import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

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
