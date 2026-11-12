import { render } from "@testing-library/react";
import { createElement } from "react";
import type { ReactElement } from "react";
import { StrictMode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, vi } from "vitest";

/**
 * Shared jsdom-lane helpers for the UI page tests (SUBC-016).
 *
 * Kept JSX-free (`createElement` instead of JSX syntax) so this file stays a
 * plain `.ts` module, matching the `test/ui/helpers.ts` naming.
 */

/** Minimal shape of the `Response`-like object `src/ui/api.ts` consumes. */
export type StubbedResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

/** A queued fetch result: an immediate body (200 by default) or an error status. */
export type StubResponse = {
  status?: number;
  body: unknown;
};

export type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

/** A queued fetch result resolved manually by the test (stale-race scenarios). */
export type StubEntry = StubResponse | { deferred: Deferred<StubResponse> };

type RecordedCall = { url: string; init: unknown };

export function deferred<T = StubResponse>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeResponse(entry: StubResponse): StubbedResponse {
  const status = entry.status ?? 200;
  return {
    ok: status >= 200 && status < 400,
    status,
    json: async () => entry.body,
  };
}

/**
 * Installs a stubbed global `fetch` for every test in the calling file
 * (registers its own beforeEach/afterEach — call once at the top level of the
 * test file, then use the returned controller inside each test).
 *
 * Routes match by URL prefix (longest prefix wins, so `/api/providers/p1` and
 * `/api/providers/p1/availability` can coexist). Each route is a FIFO queue;
 * when a queue runs dry the route repeats its last response, and an unknown
 * URL answers 404.
 */
export function setupFetchStub() {
  let routes: { prefix: string; entries: StubEntry[]; last: StubResponse | null }[] = [];
  let calls: RecordedCall[] = [];

  beforeEach(() => {
    routes = [];
    calls = [];
    const stubbedFetch = async (
      input: unknown,
      init?: unknown,
    ): Promise<StubbedResponse> => {
      const url = typeof input === "string" ? input : String((input as URL).toString());
      calls.push({ url, init });
      const unmatched = { status: 404, body: { error: `no stub for ${url}` } };
      const matches = routes
        .filter((r) => url.startsWith(r.prefix))
        .sort((a, b) => b.prefix.length - a.prefix.length);
      const route = matches[0];
      if (!route) return fakeResponse(unmatched);
      const entry = route.entries.shift();
      if (!entry) return fakeResponse(route.last ?? unmatched);
      if ("deferred" in entry) {
        const res = await entry.deferred.promise;
        route.last = res;
        return fakeResponse(res);
      }
      route.last = entry;
      return fakeResponse(entry);
    };
    vi.stubGlobal("fetch", stubbedFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  return {
    /** Queue one or more responses (or deferred promises) for a URL prefix. */
    enqueue(prefix: string, entry: StubEntry | StubEntry[]) {
      let route = routes.find((r) => r.prefix === prefix);
      if (!route) {
        route = { prefix, entries: [], last: null };
        routes.push(route);
      }
      for (const e of Array.isArray(entry) ? entry : [entry]) route.entries.push(e);
    },
    /** All recorded calls this test, in order. */
    calls: (): RecordedCall[] => calls,
    /** URLs recorded this test whose value starts with `prefix`, in order. */
    callsTo: (prefix: string): string[] =>
      calls.filter((c) => c.url.startsWith(prefix)).map((c) => c.url),
  };
}

/**
 * Render a page under `MemoryRouter` (every page that renders `Link` or reads
 * route params needs router context). For detail pages pass the real route
 * pattern from `src/ui/main.tsx` as `path` plus the concrete URL as `route`,
 * e.g. `{ route: "/providers/p1", path: "/providers/:id" }`. Set `strictMode`
 * to wrap the tree in `React.StrictMode` (proves dev double-mount safety).
 */
export function renderWithRouter(
  ui: ReactElement,
  options: { route?: string; path?: string; strictMode?: boolean } = {},
) {
  const { route = "/", path, strictMode = false } = options;
  let tree: ReactElement;
  if (path) {
    tree = createElement(
      MemoryRouter,
      { initialEntries: [route] },
      createElement(Routes, null, createElement(Route, { path, element: ui })),
    );
  } else {
    tree = createElement(MemoryRouter, { initialEntries: [route] }, ui);
  }
  if (strictMode) tree = createElement(StrictMode, null, tree);
  return render(tree);
}
