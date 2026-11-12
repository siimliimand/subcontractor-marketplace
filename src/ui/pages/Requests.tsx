import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get, post } from "../api";
import { REQUEST_STATUSES, TRADES, statusBadge } from "../types";
import type { RequestRow } from "../requestTypes";

type BriefDraft = Record<string, string | string[] | null>;

type BriefDraftResult = {
  id: string;
  draft: BriefDraft;
  missing: string[];
  state: string;
};

type RequestFilters = { status: string; trade: string };

async function fetchRequestRows(filters: RequestFilters): Promise<RequestRow[]> {
  const params = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v !== ""),
  ).toString();
  return get<RequestRow[]>(`/requests${params ? `?${params}` : ""}`);
}

const BRIEF_FIELD_LABELS: Record<string, string> = {
  workType: "Work type",
  scope: "Scope",
  location: "Location",
  startDate: "Start date",
  duration: "Duration",
  trades: "Trades",
  crewSize: "Crew size",
  budgetExpectations: "Budget expectations",
  materialsResponsibility: "Materials responsibility",
  siteConditions: "Site conditions",
};

function BriefDraftPanel({
  onApproved,
}: {
  onApproved: (final: BriefDraft) => void;
}) {
  const [sourceText, setSourceText] = useState("");
  const [draft, setDraft] = useState<BriefDraftResult | null>(null);
  const [final, setFinal] = useState<BriefDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runDraft() {
    if (busy || sourceText.trim().length < 10) return;
    setBusy(true);
    setError(null);
    setDraft(null);
    setFinal(null);
    try {
      const res = await fetch("/api/briefs/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceText }),
      });
      const body = (await res.json()) as BriefDraftResult & { error?: string };
      if (!res.ok) {
        setError(String(body.error ?? `draft failed (${res.status})`));
      } else {
        setDraft(body);
        setFinal({ ...body.draft });
      }
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (busy || !draft || !final) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/briefs/${draft.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ final }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(String(body.error ?? `approve failed (${res.status})`));
      } else {
        onApproved(final);
        setDraft(null);
        setFinal(null);
        setSourceText("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white p-4 rounded border space-y-3">
      <h3 className="text-sm font-semibold">AI brief builder (optional)</h3>
      <textarea
        value={sourceText}
        onChange={(e) => setSourceText(e.target.value)}
        placeholder="Describe the job in plain words, e.g. “we need an electrical subcontractor for an apartment renovation in Tallinn next month, 3 fitters”"
        className="w-full border rounded p-2 text-sm"
        rows={3}
      />
      <button
        type="button"
        onClick={runDraft}
        disabled={busy || sourceText.trim().length < 10}
        className="bg-gray-700 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
      >
        Draft structured brief
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {draft && final && (
        <div className="border rounded p-3 text-sm space-y-2">
          <p className="font-medium">Proposed brief — gaps flagged, never invented:</p>
          <div className="grid grid-cols-2 gap-2">
            {Object.keys(draft.draft).map((k) => {
              const wasMissing = draft.missing.includes(k);
              const value = final[k] ?? "";
              const stringValue = Array.isArray(value) ? value.join(", ") : value;
              return (
                <label key={k} className={wasMissing ? "text-amber-700" : ""}>
                  <span className="text-xs">
                    {BRIEF_FIELD_LABELS[k] ?? k}
                    {wasMissing ? " · was missing" : ""}
                  </span>
                  <input
                    value={stringValue}
                    onChange={(e) =>
                      setFinal({ ...final, [k]: k === "trades" ? e.target.value.split(",").map((s) => s.trim()) : e.target.value })
                    }
                    className={`mt-0.5 w-full border rounded p-1.5 ${wasMissing ? "border-amber-400" : ""}`}
                  />
                </label>
              );
            })}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={approve}
              disabled={busy}
              className="bg-green-600 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
            >
              Approve &amp; pre-fill form
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setFinal(null);
              }}
              className="text-gray-600 hover:underline text-sm"
            >
              Discard draft
            </button>
          </div>
          <p className="text-xs text-gray-400">
            Nothing is created or sent until you approve. The original proposal is stored alongside
            your approved edits.
          </p>
        </div>
      )}
    </div>
  );
}

export default function Requests() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filters, setFilters] = useState({ status: "", trade: "" });
  // Multi-trade (Decision 3): checked trades form the required set; the
  // selected primary goes first in the payload.
  const [selectedTrades, setSelectedTrades] = useState<string[]>([]);
  const [primaryTrade, setPrimaryTrade] = useState<string>("");
  // AI brief builder prefill (only applied when the user approves a draft).
  const [prefill, setPrefill] = useState<Record<string, string>>({});

  function toggleTrade(t: string) {
    setSelectedTrades((prev) => {
      const next = prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t];
      if (primaryTrade && !next.includes(primaryTrade)) setPrimaryTrade(next[0] ?? "");
      if (!primaryTrade && next.length) setPrimaryTrade(next[0]!);
      return next;
    });
  }

  async function load() {
    try {
      setRequests(await fetchRequestRows(filters));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    let alive = true;
    fetchRequestRows(filters).then(
      (rows) => {
        if (!alive) return;
        setRequests(rows);
        setError(null);
      },
      (e: unknown) => {
        if (alive) setError(String(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [filters]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    if (selectedTrades.length === 0) {
      setError("Select at least one trade");
      return;
    }
    setSubmitting(true);
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const trades = [primaryTrade || selectedTrades[0], ...selectedTrades.filter((t) => t !== (primaryTrade || selectedTrades[0]))];
    try {
      await post("/requests", {
        ...data,
        trade: undefined,
        trades,
        crewSize: Number(data.crewSize),
      });
      setShowForm(false);
      setSelectedTrades([]);
      setPrimaryTrade("");
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Requests</h1>
        <button
          className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? "Cancel" : "New request"}
        </button>
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}

      {showForm && (
        <div className="mb-6 space-y-3">
          <BriefDraftPanel
            onApproved={(approved) => {
              const asStrings: Record<string, string> = {};
              for (const [k, v] of Object.entries(approved)) {
                if (typeof v === "string") asStrings[k] = v;
              }
              setPrefill(asStrings);
              const trades = Array.isArray(approved.trades)
                ? approved.trades.filter((t): t is string => !!t && TRADES.includes(t as never))
                : [];
              if (trades.length) {
                setSelectedTrades(trades);
                setPrimaryTrade(trades[0]!);
              }
            }}
          />
          <form onSubmit={submit} className="bg-white p-4 rounded border space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Title *
              <input
                name="title"
                required
                defaultValue={prefill.workType ?? ""}
                className="mt-1 w-full border rounded p-1.5"
              />
            </label>
            <label className="text-sm">
              On behalf of PM
              <input name="pmName" className="mt-1 w-full border rounded p-1.5" />
            </label>
            <label className="text-sm col-span-2">
              Work description *
              <textarea
                name="description"
                required
                defaultValue={prefill.scope ?? ""}
                className="mt-1 w-full border rounded p-1.5"
              />
            </label>
            <label className="text-sm">
              Location *
              <input
                name="location"
                required
                defaultValue={prefill.location ?? ""}
                className="mt-1 w-full border rounded p-1.5"
              />
            </label>
            <div className="text-sm">
              <span className="block">Trades * (select all that apply)</span>
              <div className="mt-1 flex flex-wrap gap-3">
                {TRADES.map((t) => (
                  <label key={t} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={selectedTrades.includes(t)}
                      onChange={() => toggleTrade(t)}
                    />
                    {t}
                  </label>
                ))}
              </div>
              {selectedTrades.length > 1 && (
                <label className="block mt-2">
                  Primary trade
                  <select
                    value={primaryTrade}
                    onChange={(e) => setPrimaryTrade(e.target.value)}
                    className="mt-1 w-full border rounded p-1.5"
                  >
                    {selectedTrades.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <label className="text-sm">
              Desired start date *
              <input
                name="startDate"
                type="date"
                required
                defaultValue={prefill.startDate ?? ""}
                className="mt-1 w-full border rounded p-1.5"
              />
            </label>
            <label className="text-sm">
              Crew size *
              <input
                name="crewSize"
                type="number"
                min="1"
                required
                defaultValue={prefill.crewSize ?? ""}
                className="mt-1 w-full border rounded p-1.5"
              />
            </label>
            <label className="text-sm">
              Budget
              <input
                name="budget"
                defaultValue={prefill.budgetExpectations ?? ""}
                className="mt-1 w-full border rounded p-1.5"
              />
            </label>
            <label className="text-sm">
              Duration
              <input
                name="duration"
                defaultValue={prefill.duration ?? ""}
                className="mt-1 w-full border rounded p-1.5"
              />
            </label>
            <label className="text-sm">
              Notes
              <input
                name="notes"
                defaultValue={prefill.siteConditions ?? ""}
                className="mt-1 w-full border rounded p-1.5"
              />
            </label>
          </div>
          <button
            disabled={submitting}
            className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            Create draft request
          </button>
          </form>
        </div>
      )}

      <div className="mb-4 flex gap-3 text-sm">
        <select
          className="border rounded p-1.5"
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
        >
          <option value="">All statuses</option>
          {REQUEST_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className="border rounded p-1.5"
          value={filters.trade}
          onChange={(e) => setFilters({ ...filters, trade: e.target.value })}
        >
          <option value="">All trades</option>
          {TRADES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <table className="w-full bg-white rounded border text-sm">
        <thead className="bg-gray-50 text-left text-gray-600">
          <tr>
            <th className="p-2">Title</th>
            <th className="p-2">Trade</th>
            <th className="p-2">Location</th>
            <th className="p-2">Start</th>
            <th className="p-2">Crew</th>
            <th className="p-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id} className="border-t hover:bg-gray-50">
              <td className="p-2">
                <Link to={`/requests/${r.id}`} className="text-blue-600 hover:underline">
                  {r.title}
                </Link>
              </td>
              <td className="p-2">{r.trade}</td>
              <td className="p-2">{r.location}</td>
              <td className="p-2">{r.startDate}</td>
              <td className="p-2">{r.crewSize}</td>
              <td className="p-2">
                <span className={`px-2 py-0.5 rounded text-xs ${statusBadge(r.status)}`}>
                  {r.status}
                </span>
              </td>
            </tr>
          ))}
          {requests.length === 0 && (
            <tr>
              <td colSpan={6} className="p-4 text-center text-gray-500">
                No requests found
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
