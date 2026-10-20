import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { regions, trades } from "./db/schema";
import { PILOT_TRADES, TRADE_PILOT_MINIMUMS, type Trade } from "./config";

/**
 * Phase 4 trade/region catalog: adding a trade or region is a data change,
 * not a deploy. The catalog is the single source of truth for validation;
 * the built-in pilot trades remain only as the migration seed and the
 * empty-catalog fallback, so the platform never loses its trade vocabulary.
 *
 * A 60-second TTL cache keeps the hot paths (request/service/booking
 * validation, matching) off D1 for repeat reads. Tests reset it explicitly
 * to preserve isolation.
 */

export type CatalogTrade = {
  slug: string;
  label: string;
  pilotMinimum: number;
  active: boolean;
};

export type CatalogRegion = {
  slug: string;
  name: string;
  active: boolean;
};

type CacheEntry = { at: number; trades: CatalogTrade[]; regions: CatalogRegion[] };

let cache: CacheEntry | null = null;
const TTL_MS = 60_000;

export function resetCatalogCache() {
  cache = null;
}

function fallbackTrades(): CatalogTrade[] {
  return PILOT_TRADES.map((slug) => ({
    slug,
    label: slug.charAt(0).toUpperCase() + slug.slice(1),
    pilotMinimum: TRADE_PILOT_MINIMUMS[slug],
    active: true,
  }));
}

export async function listTrades(db: DrizzleD1Database): Promise<CatalogTrade[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.trades;
  const rows = await db.select().from(trades);
  const list: CatalogTrade[] = rows.map((r) => ({
    slug: r.slug,
    label: r.label,
    pilotMinimum: r.pilotMinimum,
    active: r.active === 1,
  }));
  const result = list.length > 0 ? list : fallbackTrades();
  cache = { at: Date.now(), trades: result, regions: cache?.regions ?? [] };
  return result;
}

export async function listRegions(db: DrizzleD1Database): Promise<CatalogRegion[]> {
  if (cache && cache.regions.length > 0 && Date.now() - cache.at < TTL_MS) return cache.regions;
  const rows = await db.select().from(regions);
  const list: CatalogRegion[] = rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    active: r.active === 1,
  }));
  if (cache && Date.now() - cache.at < TTL_MS) cache = { ...cache, regions: list };
  else cache = { at: Date.now(), trades: cache?.trades ?? [], regions: list };
  return list;
}

/** Active trades are selectable for new records; history is preserved. */
export async function activeTradeSlugs(db: DrizzleD1Database): Promise<string[]> {
  return (await listTrades(db)).filter((t) => t.active).map((t) => t.slug);
}

export async function isCatalogTrade(db: DrizzleD1Database, slug: string): Promise<boolean> {
  return (await activeTradeSlugs(db)).includes(slug);
}

/** Any catalog slug, active or not — actions on existing records (booking,
 * matching, reconfirming) must keep working for trades deactivated mid-flight. */
export async function isKnownCatalogTrade(db: DrizzleD1Database, slug: string): Promise<boolean> {
  return (await listTrades(db)).some((t) => t.slug === slug);
}

export async function isCatalogRegion(db: DrizzleD1Database, slug: string): Promise<boolean> {
  const region = (await listRegions(db)).find((r) => r.slug === slug);
  return !!region && region.active;
}

/** Legacy helper for code that stores/compares `Trade`-typed slugs. */
export function asTrade(slug: string): Trade {
  return slug as Trade;
}
