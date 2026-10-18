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

export type RequestDetailData = {
  request: RequestRow;
  responses: { response: ResponseRow; provider: Company | null }[];
  bookings: { booking: BookingRow; provider: Company | null }[];
  outreach: { entry: OutreachRow; provider: Company | null }[];
  timeEntries: TimeEntryRow[];
  events: AuditEventRow[];
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
  sentAt: string;
  notes: string | null;
  contactedBy: string;
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
