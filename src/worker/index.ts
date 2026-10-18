import { createApp } from "./app";
import type { AppEnv } from "./app";
import { publicApp } from "./email/public";
import { handleEmailEventBatch } from "./email/events";

const app = createApp();

export default {
  async fetch(request: Request, env: AppEnv["Bindings"], ctx: ExecutionContext) {
    const url = new URL(request.url);
    const { pathname } = url;
    // Public token routes live outside the Access guard and must be matched
    // before every other branch.
    if (pathname.startsWith("/e/") || pathname.startsWith("/t/")) {
      return publicApp.fetch(request, env, ctx);
    }
    if (pathname.startsWith("/api/")) {
      return app.fetch(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
  async queue(
    batch: MessageBatch<unknown>,
    env: AppEnv["Bindings"],
    _ctx: ExecutionContext,
  ) {
    await handleEmailEventBatch(
      env,
      batch.messages.map((m) => ({ id: m.id, body: m.body })),
    );
  },
};
