import { drizzle } from "drizzle-orm/d1";
import type { Bindings } from "../app";
import { applyEmailLifecycleEvent } from "./events";

// ---------------------------------------------------------------------------
// SUBC-011: inbound bounce handling via Cloudflare Email Routing.
//
// Cloudflare Email Service cannot route lifecycle events into Queues, so
// bounces arrive the classic way: as RFC 3464 delivery status notifications
// (DSNs) sent back to our envelope sender. Cloudflare Email Routing delivers
// those messages to the Worker's `email()` handler (dashboard setup — see
// README "Email pipeline"), which reads the raw message and parses it here.
//
// parseDeliveryFailure is deliberately conservative: a message is only
// classified as a bounce when it carries an EXPLICIT failure indicator
// (`Action: failed` or an RFC 3463 `Status: 4.x/5.x`). Vacation auto-replies
// (`Auto-Submitted: auto-replied`, no failure status) and ordinary human
// replies never become bounces. Dependency-free line-anchored regex only.
// ---------------------------------------------------------------------------

export type DeliveryFailure = { to: string; permanent: boolean };

// Line-anchored, case-insensitive header matching over the raw RFC 822 text.
const FINAL_RECIPIENT_RE = /^Final-Recipient:[ \t]*(.+)$/im;
const X_FAILED_RECIPIENTS_RE = /^X-Failed-Recipients:[ \t]*(.+)$/im;
// RFC 3463 status-code: class.subject.detail — we only need the class
// (2 = success, 4 = temporary, 5 = permanent) to grade the failure.
const STATUS_CLASS_RE = /^Status:[ \t]*([245])\.\d{1,3}(?:\.\d{1,3})?/im;
const ACTION_FAILED_RE = /^Action:[ \t]*failed/im;
const EMAILISH_RE = /^[^\s@,;<>]+@[^\s@,;<>]+$/;

function cleanAddress(value: string): string | null {
  const address = value
    .replace(/^rfc822\s*;\s*/i, "")
    .replace(/[<>]/g, "")
    .split(",")[0]!
    .trim();
  return EMAILISH_RE.test(address) ? address : null;
}

/**
 * Parses a raw message for an explicit delivery failure. Returns the failed
 * recipient and whether the failure is permanent (Status 5.x) or temporary
 * (Status 4.x; `Action: failed` without a Status defaults to permanent), or
 * null when the message is not an explicit bounce (auto-replies, human mail,
 * DSNs without a usable recipient).
 */
export function parseDeliveryFailure(raw: string): DeliveryFailure | null {
  const statusMatch = STATUS_CLASS_RE.exec(raw);
  const statusClass = statusMatch ? Number(statusMatch[1]) : null;
  const actionFailed = ACTION_FAILED_RE.test(raw);

  // Explicit failure only: a 4.x/5.x status or a failed action. Anything
  // else (including Auto-Submitted auto-replies without a failure status)
  // is ordinary mail, never a bounce.
  const explicitFailure = actionFailed || statusClass === 4 || statusClass === 5;
  if (!explicitFailure) return null;

  const recipientValue =
    FINAL_RECIPIENT_RE.exec(raw)?.[1] ?? X_FAILED_RECIPIENTS_RE.exec(raw)?.[1];
  if (!recipientValue) return null;
  const to = cleanAddress(recipientValue);
  if (!to) return null;

  const permanent = statusClass === 4 ? false : true;
  return { to, permanent };
}

export type InboundResult = {
  applied: boolean;
  to: string;
  permanent: boolean;
};

/**
 * Parses an inbound raw message and, when it is an explicit bounce, applies
 * it through the shared lifecycle applier (source: "inbound"). Never throws —
 * inbound lifecycle signals are additive and never blocking, matching the
 * queue-consumer semantics.
 */
export async function handleInboundEmail(env: Bindings, raw: string): Promise<InboundResult | null> {
  const failure = parseDeliveryFailure(raw);
  if (!failure) return null;
  const db = drizzle(env.DB);
  const applied = await applyEmailLifecycleEvent(db, {
    kind: "bounced",
    to: failure.to,
    permanent: failure.permanent,
    source: "inbound",
  });
  return { applied, ...failure };
}
