import { env } from "cloudflare:test";
import type { Bindings } from "../../src/worker/app";
import {
  sendOutreachEmailBatch,
  type EmailSendOutcome,
} from "../../src/worker/email/sender";

export type StubEmailMessage = { from: string; to: string; subject: string; text: string };

/**
 * The pinned miniflare (3.20241230.0, via vitest-pool-workers 0.5) has no
 * sendEmail binding support, so env.SEND_EMAIL is undefined in the worker
 * under test. Stubbing at the sendOutreachEmailBatch boundary keeps the
 * sender's semantics unchanged while still exercising the full send path.
 */
export function stubSendEnv(): { stubEnv: Bindings; sent: StubEmailMessage[] } {
  const sent: StubEmailMessage[] = [];
  const stubEnv = {
    ...env,
    SEND_EMAIL: {
      send: async (message: StubEmailMessage) => {
        sent.push(message);
      },
    },
  } as Bindings;
  return { stubEnv, sent };
}

export async function sendOutreachWithStub(params: {
  requestId: string;
  providerIds: string[];
  staffUserId: string;
  staffEmail: string;
}): Promise<{ outcome: EmailSendOutcome; sent: StubEmailMessage[] }> {
  const { stubEnv, sent } = stubSendEnv();
  const outcome = await sendOutreachEmailBatch(stubEnv, params);
  return { outcome, sent };
}
