/**
 * AI brief builder (details/04): a PM's natural-language description is
 * drafted into a structured brief by Cloudflare Workers AI. Missing
 * information is flagged, never invented — enforced by post-validation
 * regardless of model behaviour. Nothing is created or sent until staff
 * approve (see routes/briefs.ts).
 */

// Swappable Workers AI model id (instruct-style, JSON-capable).
export const BRIEF_MODEL = "@cf/meta/llama-3.1-8b-instruct";

export const BRIEF_FIELDS = [
  "workType",
  "scope",
  "location",
  "startDate",
  "duration",
  "trades",
  "crewSize",
  "budgetExpectations",
  "materialsResponsibility",
  "siteConditions",
] as const;

export type BriefField = (typeof BRIEF_FIELDS)[number];

export type BriefDraft = {
  [K in BriefField]: K extends "trades" ? string[] | null : string | null;
};

export type BriefProposal = {
  draft: BriefDraft;
  missing: BriefField[];
};

type AiBinding = { run(model: string, inputs: unknown): Promise<unknown> };

/**
 * Phase 4: the trade vocabulary comes from the catalog. `validateBrief`
 * stays sync (pure) and takes the allowed slugs; callers load them via
 * `activeTradeSlugs` (built-in pilot trades as fallback when unset).
 */
const FALLBACK_TRADES = [
  "electrical",
  "plumbing",
  "hvac",
  "drywall",
  "flooring",
  "painting",
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Post-validation enforces "flagged, never invented": fields the source text
 * does not support (per the model) are nulled and reported missing. Values
 * that fail type/format checks are dropped the same way.
 */
export function validateBrief(raw: unknown, allowedTrades: string[] = FALLBACK_TRADES): BriefProposal {
  const src = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const tradesRaw = src.trades;
  const crewRaw = src.crewSize;
  const draft: BriefDraft = {
    workType: str(src.workType),
    scope: str(src.scope),
    location: str(src.location),
    startDate:
      typeof src.startDate === "string" && DATE_RE.test(src.startDate.trim())
        ? src.startDate.trim()
        : null,
    duration: str(src.duration),
    trades: Array.isArray(tradesRaw)
      ? tradesRaw.filter((t): t is string => typeof t === "string" && allowedTrades.includes(t))
      : null,
    crewSize:
      crewRaw === null || crewRaw === undefined || crewRaw === ""
        ? null
        : Number.isFinite(Number(crewRaw)) && Number(crewRaw) >= 1
          ? String(Math.floor(Number(crewRaw)))
          : null,
    budgetExpectations: str(src.budgetExpectations),
    materialsResponsibility: str(src.materialsResponsibility),
    siteConditions: str(src.siteConditions),
  };
  const missing = BRIEF_FIELDS.filter((f) => {
    const v = draft[f];
    if (Array.isArray(v)) return v.length === 0;
    return v === null;
  });
  if (draft.trades && draft.trades.length === 0) draft.trades = null;
  return { draft, missing };
}

export function buildBriefPrompt(sourceText: string): string {
  return [
    "You draft structured construction subcontracting briefs from a project manager's description.",
    "Extract ONLY information stated or clearly implied by the text. Never invent values.",
    'For every field the text does not support, return null. "trades" must use exactly these values when stated: electrical, plumbing, hvac, drywall, flooring, painting. "startDate" must be YYYY-MM-DD only when a date is stated; relative phrases like "next month" go to null.',
    'Return JSON only, no commentary, with exactly these keys: workType, scope, location, startDate, duration, trades, crewSize, budgetExpectations, materialsResponsibility, siteConditions.',
    "",
    "Description:",
    sourceText,
  ].join("\n");
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Draft a brief via Workers AI. One retry on malformed output, then a typed
 * failure the route turns into a 502 fallback message pointing staff at the
 * manual form.
 */
export async function draftBrief(
  ai: AiBinding,
  sourceText: string,
): Promise<{ ok: true; proposal: BriefProposal } | { ok: false; reason: string }> {
  const prompt = buildBriefPrompt(sourceText);
  let lastReason = "empty_model_response";
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: unknown;
    try {
      response = await ai.run(BRIEF_MODEL, {
        messages: [{ role: "user", content: prompt }],
        max_tokens: 512,
        temperature: 0,
      });
    } catch (e) {
      return { ok: false, reason: `ai_binding_error: ${String(e)}` };
    }
    const text =
      typeof response === "string"
        ? response
        : typeof (response as { response?: unknown })?.response === "string"
          ? (response as { response: string }).response
          : null;
    if (!text) {
      lastReason = "empty_model_response";
      continue;
    }
    const json = extractJson(text);
    if (json === null) {
      lastReason = "malformed_model_output";
      continue;
    }
    return { ok: true, proposal: validateBrief(json) };
  }
  return { ok: false, reason: lastReason };
}
