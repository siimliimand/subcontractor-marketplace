import type { RequestStatus } from "./config";

export const REQUEST_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  draft: ["approved", "cancelled"],
  approved: ["matched", "cancelled"],
  matched: ["in_outreach", "cancelled"],
  in_outreach: ["responded", "cancelled"],
  responded: ["booked", "in_outreach", "cancelled"],
  booked: ["cancelled"],
  closed: [],
  cancelled: [],
};

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return REQUEST_TRANSITIONS[from]!.includes(to);
}

export const PRE_BOOKED_STATUSES: RequestStatus[] = [
  "draft",
  "approved",
  "matched",
  "in_outreach",
  "responded",
];

export const OPEN_STATUSES: RequestStatus[] = [
  "draft",
  "approved",
  "matched",
  "in_outreach",
  "responded",
];
