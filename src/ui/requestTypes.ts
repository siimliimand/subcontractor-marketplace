import type { Company, Service } from "./types";

export type RequestRow = {
  id: string;
  title: string;
  description: string;
  location: string;
  trade: string;
  startDate: string;
  crewSize: number;
  budget: string | null;
  duration: string | null;
  notes: string | null;
  pmName: string | null;
  status: string;
  cancelledBy: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ComparisonEntry = {
  responseId: string;
  companyId: string;
  legalName: string;
  type: string;
  workersCount: number | null;
  availableFrom: string | null;
  reason: string | null;
  receivedAt: string | null;
  availability: { label: string; confirmedWorkers: number };
};

export type ComparisonGroup = {
  trade: string;
  isPrimary: boolean;
  entries: ComparisonEntry[];
};

export type RequestDetailData = {
  request: RequestRow;
  trades: { trade: string; isPrimary: boolean }[];
  responses: { response: ResponseRow; provider: Company | null }[];
  bookings: { booking: BookingRow; provider: Company | null }[];
  bookingRequests: { br: BookingRequestRow; provider: Company | null }[];
  holds: HoldRow[];
  comparison: ComparisonGroup[];
  outreach: { entry: OutreachRow; provider: Company | null }[];
  timeEntries: TimeEntryRow[];
  events: AuditEventRow[];
};

export type BookingRequestRow = {
  id: string;
  requestId: string;
  responseId: string | null;
  holdId: string | null;
  companyId: string;
  trade: string;
  startDate: string;
  endDate: string;
  workersCount: number;
  state: string;
  createdAt: string;
};

export type HoldRow = {
  id: string;
  requestId: string;
  companyId: string;
  trade: string;
  startDate: string;
  endDate: string;
  workersCount: number;
  state: string;
  expiresAt: string;
  createdAt: string;
};

export type ResponseRow = {
  id: string;
  requestId: string;
  companyId: string;
  type: string;
  workersCount: number | null;
  availableFrom: string | null;
  reason: string | null;
  receivedAt: string;
};

export type BookingRow = {
  id: string;
  requestId: string;
  responseId: string;
  companyId: string;
  startDate: string;
  endDate: string;
  workersCount: number;
  outcome: string | null;
  outcomeReason: string | null;
  outcomeAt: string | null;
  createdAt: string;
};

export type OutreachRow = Service & {
  batchNumber: string;
  channel: string;
  sentAt: string;
  notes: string | null;
  contactedBy: string;
  emailStatus?: "sent" | "delivered" | "bounced" | "opened" | "skipped" | null;
  emailSkippedReason?: string | null;
};

export type TimeEntryRow = {
  id: string;
  requestId: string;
  userId: string;
  minutes: number;
  note: string | null;
  createdAt: string;
};

export type AuditEventRow = {
  id: string;
  actorUserId: string | null;
  actorEmail: string | null;
  occurredAt: string;
  entity: string;
  entityId: string | null;
  action: string;
  payloadJson: string | null;
  channel: string;
};
