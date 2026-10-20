import { FormEvent, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { get, post } from "../api";
import { statusBadge } from "../types";
import type { RequestDetailData } from "../requestTypes";

const NEXT_ACTIONS: Record<string, string[]> = {
  draft: ["approved"],
  approved: ["matched"],
  matched: ["in_outreach"],
  responded: ["booked"],
};

export default function RequestDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<RequestDetailData | null>(null);
  const [providers, setProviders] = useState<{ company: { id: string; legalName: string } }[]>([]);
  const [effort, setEffort] = useState<{ totalMinutes: number; manualEvents: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function load() {
    if (!id) return;
    try {
      const detail = await get<RequestDetailData>(`/requests/${id}`);
      setData(detail);
      setEffort(await get(`/requests/${id}/effort`));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  useEffect(() => {
    get<{ company: { id: string; legalName: string } }[]>("/providers").then(setProviders).catch(
      () => {},
    );
  }, []);

  async function action(path: string, body: unknown) {
    if (!id || inFlight.current) return;
    inFlight.current = true;
    try {
      await post(`/requests/${id}${path}`, body);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      inFlight.current = false;
    }
  }

  if (!data) return <div>{error ?? "Loading…"}</div>;
  const r = data.request;

  const timeline = [
    ...data.events.map((e) => ({
      at: e.occurredAt,
      kind: "event",
      text: `${e.action} (${e.actorEmail ?? "system"})${
        e.payloadJson ? ` — ${e.payloadJson}` : ""
      }`,
    })),
    ...data.outreach.map(({ entry, provider }) => ({
      at: entry.sentAt,
      kind: "outreach",
      text: `Outreach to ${provider?.legalName ?? entry.companyId} batch ${entry.batchNumber}`,
    })),
    ...data.responses.map(({ response, provider }) => ({
      at: response.receivedAt,
      kind: "response",
      text: `Response from ${provider?.legalName ?? response.companyId}: ${response.type}${
        response.workersCount ? ` (${response.workersCount} workers from ${response.availableFrom})` : ""
      }${response.reason ? ` — ${response.reason}` : ""}`,
    })),
    ...data.bookings.map(({ booking, provider }) => ({
      at: booking.createdAt,
      kind: "booking",
      text: `Booking with ${provider?.legalName ?? booking.companyId}: ${booking.startDate} → ${booking.endDate}, ${booking.workersCount} workers${booking.outcome ? ` — outcome: ${booking.outcome}` : ""}`,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold">{r.title}</h1>
        <span className={`px-2 py-0.5 rounded text-xs ${statusBadge(r.status)}`}>{r.status}</span>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        {data.trades.map((t, i) => (
          <span key={t.trade}>
            {i > 0 && ", "}
            {t.trade}
            {t.isPrimary && <span className="text-gray-400"> (primary)</span>}
          </span>
        ))}
        {" · "}
        {r.location} · start {r.startDate} · crew {r.crewSize}
        {r.pmName ? ` · PM ${r.pmName}` : ""}
        {r.cancelledBy ? ` · cancelled by ${r.cancelledBy}: ${r.cancelReason}` : ""}
      </p>

      {data.comparison.length > 0 && (
        <Card title="Response comparison (by trade)">          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            {data.comparison.map((group) => (
              <div key={group.trade} className="border rounded p-2">
                <p className="font-medium mb-1">
                  {group.trade}
                  {group.isPrimary ? " (primary)" : ""}
                </p>
                {group.entries.length === 0 ? (
                  <p className="text-gray-400 text-xs">No responses</p>
                ) : (
                  <ul className="space-y-1">
                    {group.entries.map((e) => (
                      <li key={e.responseId} className="flex justify-between gap-2">
                        <span>
                          {e.verification?.registeredActive && (
                            <span className="text-green-700 mr-1" title="Registered & active (Äriregister)">✓ Registered</span>
                          )}
                          {e.verification?.tradeNotification && (
                            <span className="text-green-700 mr-1" title="Trade notification valid (MTR/Tarvik)">✓ Licensed</span>
                          )}
                          {e.legalName} — {e.type}
                          {e.workersCount ? ` · ${e.workersCount} workers from ${e.availableFrom ?? "?"}` : ""}
                        </span>
                        <span
                          className={
                            e.availability.label === "current"
                              ? "text-green-700 whitespace-nowrap"
                              : e.availability.label === "unconfirmed"
                                ? "text-gray-400 whitespace-nowrap"
                                : "text-yellow-700 whitespace-nowrap"
                          }
                        >
                          {e.availability.label === "current"
                            ? "Confirmed"
                            : e.availability.label === "unconfirmed"
                              ? "Unconfirmed"
                              : e.availability.label === "aging"
                                ? "Aging — reconfirm"
                                : "Stale — reconfirm"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {data.outreach.length > 0 && <OutreachBatchesPanel outreach={data.outreach} />}

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <ActionsCard r={r} action={action} responses={data.responses} />

          <Card title="Record response">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const d = Object.fromEntries(new FormData(e.currentTarget));
                action("/responses", { ...d, workersCount: d.workersCount ? Number(d.workersCount) : undefined }).then(
                  () => (e.target as HTMLFormElement).reset(),
                );
              }}
              className="space-y-2"
            >
              <select name="companyId" required className="border rounded p-1.5 text-sm w-full">
                {providers.map(({ company }) => (
                  <option key={company.id} value={company.id}>
                    {company.legalName}
                  </option>
                ))}
              </select>
              <select name="type" className="border rounded p-1.5 text-sm w-full">
                <option value="interest">interest</option>
                <option value="quote">quote</option>
                <option value="decline">decline</option>
              </select>
              <div className="flex gap-2">
                <input
                  name="workersCount"
                  type="number"
                  min="1"
                  placeholder="Workers"
                  className="border rounded p-1.5 text-sm flex-1"
                />
                <input
                  name="availableFrom"
                  type="date"
                  className="border rounded p-1.5 text-sm flex-1"
                />
              </div>
              <input
                name="reason"
                placeholder="Reason (required for decline)"
                className="border rounded p-1.5 text-sm w-full"
              />
              <button className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm">
                Save response
              </button>
            </form>
          </Card>

          {data.bookings.length > 0 && data.bookings[0] && !data.bookings[0].booking.outcome && (
            <Card title="Record outcome">
              <div className="flex gap-2">
                <button
                  className="bg-green-600 text-white px-3 py-1.5 rounded text-sm"
                  onClick={() => action("/outcome", { outcome: "completion_confirmed" })}
                >
                  Completion confirmed
                </button>
                <button
                  className="bg-red-600 text-white px-3 py-1.5 rounded text-sm"
                  onClick={() => action("/outcome", { outcome: "accepted_but_not_delivered" })}
                >
                  Accepted but not delivered
                </button>
              </div>
            </Card>
          )}

          <MatchingPanel
            requestId={id ?? ""}
            disabled={["draft", "booked", "cancelled", "closed"].includes(r.status)}
            onMatched={load}
          />

          <BookingFlowPanel
            data={data}
            providers={providers}
            disabled={["booked", "cancelled", "closed"].includes(r.status)}
            onChanged={load}
          />

          <OutreachPanel
            providers={providers}
            outreach={data.outreach}
            disabled={["booked", "cancelled", "closed"].includes(r.status)}
            onLog={async (providerIds, notes) => {
              const res = await fetch(`/api/requests/${id}/outreach`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ providerIds, notes }),
              });
              const body = (await res.json()) as OutreachResult;
              await load();
              return body;
            }}
            onEmail={async (providerIds) => {
              const res = await fetch(`/api/requests/${id}/outreach/email`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ providerIds }),
              });
              const body = (await res.json()) as EmailSendResult;
              await load();
              return body;
            }}
          />

          <TimePanel
            onLog={async (minutes, note) => {
              await action("/time", { minutes, note });
            }}
          />

          <EffortSummary effort={effort} />
        </div>

        <div className="space-y-4">
          <Card title="Chronological history">
            <ul className="space-y-2 text-sm">
              {timeline.map((item, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-gray-400 whitespace-nowrap">
                    {item.at.replace("T", " ").slice(0, 16)}
                  </span>
                  <span
                    className={
                      item.kind === "outreach"
                        ? "text-purple-700"
                        : item.kind === "response"
                          ? "text-blue-700"
                          : item.kind === "booking"
                            ? "text-green-700"
                            : "text-gray-700"
                    }
                  >
                    {item.text}
                  </span>
                </li>
              ))}
              {timeline.length === 0 && <li className="text-gray-500">No history yet</li>}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function TimePanel({
  onLog,
}: {
  onLog: (minutes: number, note: string) => Promise<void>;
}) {
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <Card title="Log manual time">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await onLog(Number(minutes), note);
            setMsg("Time logged");
            setMinutes("");
            setNote("");
          } catch (err) {
            setMsg(String(err));
          }
        }}
        className="flex gap-2 items-center text-sm"
      >
        <input
          className="border rounded p-1.5 w-24"
          type="number"
          min="1"
          required
          placeholder="Minutes"
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
        />
        <input
          className="border rounded p-1.5 flex-1"
          placeholder="What was done?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm">Log</button>
      </form>
      {msg && <p className="text-xs text-gray-500 mt-1">{msg}</p>}
    </Card>
  );
}

function EffortSummary({
  effort,
}: {
  effort: { totalMinutes: number; manualEvents: number } | null;
}) {
  if (!effort) return null;
  const hours = Math.floor(effort.totalMinutes / 60);
  const mins = effort.totalMinutes % 60;
  return (
    <Card title="Effort rollup">
      <p className="text-sm text-gray-700">
        <span className="font-semibold">{hours}h {mins}m</span> logged ·{" "}
        <span className="font-semibold">{effort.manualEvents}</span> manual interventions
      </p>
    </Card>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white p-4 rounded border">
      <h2 className="text-sm font-semibold mb-2">{title}</h2>
      {children}
    </div>
  );
}

type OutreachResult = {
  batchNumber?: string;
  accepted?: string[];
  rejected?: { companyId: string; reason: string }[];
  error?: string;
};

type EmailSendResult = {
  sent?: string[];
  skipped?: { companyId: string; reason: string }[];
  requestStatus?: string;
  error?: string;
};

function OutreachPanel({
  providers,
  outreach,
  disabled,
  onLog,
  onEmail,
}: {
  providers: { company: { id: string; legalName: string } }[];
  outreach: RequestDetailData["outreach"];
  disabled: boolean;
  onLog: (providerIds: string[], notes: string) => Promise<OutreachResult>;
  onEmail: (providerIds: string[]) => Promise<EmailSendResult>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const contacted = outreach.map(({ entry }) => entry.companyId);

  function skippedText(skipped: { companyId: string; reason: string }[]) {
    if (!skipped || skipped.length === 0) return "";
    return (
      " · " +
      skipped
        .map((s) => {
          const name =
            providers.find((p) => p.company.id === s.companyId)?.company.legalName ?? s.companyId;
          return `${name}: ${s.reason}`;
        })
        .join(" · ")
    );
  }

  async function submit() {
    if (selected.length === 0) return;
    const body = await onLog(selected, notes);
    if (body.rejected && body.rejected.length > 0) {
      setFeedback(
        body.rejected
          .map((rj) => {
            const name =
              providers.find((p) => p.company.id === rj.companyId)?.company.legalName ??
              rj.companyId;
            return `${name}: ${rj.reason}`;
          })
          .join(" · "),
      );
    } else if (body.error) {
      setFeedback(body.error);
    } else {
      setFeedback(`Batch ${body.batchNumber} logged to ${body.accepted?.length ?? 0} providers`);
    }
    setSelected([]);
    setNotes("");
  }

  async function sendEmail() {
    if (selected.length === 0 || sending) return;
    setSending(true);
    try {
      const body = await onEmail(selected);
      if (body.error) {
        setFeedback(body.error);
      } else {
        const sentCount = body.sent?.length ?? 0;
        setFeedback(`Emailed ${sentCount} provider(s)${skippedText(body.skipped ?? [])}`);
        if (sentCount > 0) setSelected([]);
      }
    } catch (e) {
      setFeedback(String(e));
    } finally {
      setSending(false);
    }
  }

  if (disabled) return <Card title="Outreach">Request is closed for outreach.</Card>;

  return (
    <Card title="Log outreach batch">
      <div className="space-y-2 text-sm">
        {providers.map(({ company }) => {
          const isSelected = selected.includes(company.id);
          const isContacted = contacted.includes(company.id);
          const emailEntries = outreach
            .filter(({ entry }) => entry.companyId === company.id && entry.channel === "email")
            .map(({ entry }) => entry);
          const emailEntry = emailEntries[emailEntries.length - 1];
          const emailStatus = emailEntry?.emailStatus;
          const emailReason = emailEntry?.emailSkippedReason;
          const emailClass = emailStatus === "delivered" || emailStatus === "opened"
            ? "text-green-700"
            : emailStatus === "bounced" || emailStatus === "skipped" || emailReason
              ? "text-red-700"
              : "text-gray-500";
          return (
            <button
              key={company.id}
              type="button"
              disabled={isContacted}
              onClick={() =>
                setSelected(
                  isSelected
                    ? selected.filter((sid) => sid !== company.id)
                    : [...selected, company.id],
                )
              }
              className={`flex items-center gap-2 text-left text-sm rounded px-2 py-1 border ${
                isSelected
                  ? "bg-purple-100 border-purple-400"
                  : "bg-white border-gray-200 hover:bg-gray-50"
              } disabled:opacity-50`}
            >
              <span className="inline-block w-3">{isSelected ? "☑" : "☐"}</span>
              {company.legalName}
              {isContacted && <span className="text-xs text-gray-400">(already contacted)</span>}
              {emailEntry && (emailStatus || emailReason) && (
                <span className={`text-xs whitespace-nowrap ${emailClass}`}>
                  {emailReason ? (
                    <span
                      className="inline-block max-w-[16rem] truncate align-bottom"
                      title={emailReason}
                    >
                      email: skipped — {emailReason}
                    </span>
                  ) : (
                    `email: ${emailStatus}`
                  )}
                </span>
              )}
            </button>
          );
        })}
        <input
          className="border rounded p-1.5 w-full"
          placeholder="Batch notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <div className="flex gap-2">
          <button
            className="bg-purple-600 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
            disabled={selected.length === 0}
            onClick={submit}
          >
            Log outreach to {selected.length} provider(s)
          </button>
          <button
            className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
            disabled={selected.length === 0 || sending}
            onClick={sendEmail}
          >
            Send by email to {selected.length} provider(s)
          </button>
        </div>
        {feedback && <p className="text-xs text-amber-700">{feedback}</p>}
      </div>
    </Card>
  );
}

function ActionsCard({
  r,
  action,
  responses,
}: {
  r: RequestDetailData["request"];
  action: (path: string, body: unknown) => Promise<void>;
  responses: { response: { id: string; type: string } }[];
}) {
  const next = NEXT_ACTIONS[r.status] ?? [];
  return (
    <Card title="Actions">
      <div className="flex flex-wrap gap-2">
        {next.map((to) => (
          <button
            key={to}
            className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700"
            onClick={() => action("/transition", { to })}
          >
            Move to {to}
          </button>
        ))}
        {r.status === "responded" && (
          <BookingForm action={action} responses={responses} />
        )}
        {!["cancelled", "closed"].includes(r.status) && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const d = Object.fromEntries(new FormData(e.currentTarget));
              action("/cancel", d).then(() => (e.target as HTMLFormElement).reset());
            }}
            className="flex gap-2 items-center"
          >
            <select name="cancelledBy" className="border rounded p-1.5 text-sm">
              <option value="customer">customer</option>
              <option value="provider">provider</option>
            </select>
            <input
              name="reason"
              placeholder="Cancel reason"
              className="border rounded p-1.5 text-sm"
            />
            <button className="bg-red-600 text-white px-3 py-1.5 rounded text-sm">Cancel</button>
          </form>
        )}
        {next.length === 0 && !["cancelled", "closed"].includes(r.status) && (
          <span className="text-sm text-gray-500">No direct transitions</span>
        )}
      </div>
    </Card>
  );
}

function BookingForm({
  action,
  responses,
}: {
  action: (path: string, body: unknown) => Promise<void>;
  responses: { response: { id: string; type: string } }[] | undefined;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.currentTarget));
        action("/bookings", { ...d, workersCount: Number(d.workersCount) });
      }}
      className="flex gap-2 items-center flex-wrap"
    >
      <select name="responseId" required className="border rounded p-1.5 text-sm">
        {(responses ?? []).map(({ response }) => (
          <option key={response.id} value={response.id}>
            {response.type} response
          </option>
        ))}
      </select>
      <input name="startDate" type="date" required className="border rounded p-1.5 text-sm" />
      <input name="endDate" type="date" required className="border rounded p-1.5 text-sm" />
      <input
        name="workersCount"
        type="number"
        min="1"
        placeholder="Workers"
        required
        className="border rounded p-1.5 text-sm w-24"
      />
      <button className="bg-green-600 text-white px-3 py-1.5 rounded text-sm">Confirm booking</button>
    </form>
  );
}

type FactorResult = {
  value: number;
  weighted: number;
  missing: boolean;
  inputs: Record<string, unknown>;
};

type FactorBreakdown = Record<string, FactorResult>;

type MatchRun = {
  trade: string;
  created: number;
  candidates?: {
    companyId: string;
    legalName: string;
    rank: number;
    score: number;
    specialisation: string;
    factors: FactorBreakdown;
  }[];
  excluded?: { companyId: string; legalName: string; reason: string }[];
};

const FACTOR_LABELS: Record<string, string> = {
  confirmedCapacity: "Confirmed capacity",
  specialisationDepth: "Specialisation depth",
  responseHistory: "Response history",
  reliability: "Reliability",
  proximity: "Proximity to site",
  reviewQuality: "Review quality",
  priceFit: "Price fit",
};

function FactorRow({ name, f }: { name: string; f: FactorResult }) {
  const label = FACTOR_LABELS[name] ?? name;
  if (f.missing) {
    return (
      <li className="text-gray-400">
        {label}: no data — contributes 0
        {typeof f.inputs.note === "string" ? ` (${f.inputs.note})` : ""}
      </li>
    );
  }
  return (
    <li>
      {label}: {(f.value * 100).toFixed(0)}% → +{(f.weighted * 100).toFixed(1)} pts
    </li>
  );
}

function MatchingPanel({
  requestId,
  disabled,
  onMatched,
}: {
  requestId: string;
  disabled: boolean;
  onMatched: () => Promise<void>;
}) {
  const [runs, setRuns] = useState<MatchRun[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(widen: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(widen ? { widen: true } : {}),
      });
      const body = (await res.json()) as { runs?: MatchRun[]; error?: string };
      if (!res.ok) {
        setError(body.error ?? `match failed (${res.status})`);
      } else {
        setRuns(body.runs ?? []);
        await onMatched();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Matching v1">
      {disabled ? (
        <p className="text-sm text-gray-500">Matching not available in this status.</p>
      ) : (
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={() => run(false)}
            className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
          >
            Run matching
          </button>
          <button
            disabled={busy}
            onClick={() => run(true)}
            className="bg-gray-700 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
            title="Widen outreach once, toward 10 providers per trade"
          >
            Widen (once, toward 10)
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {runs?.map((run, i) => (
        <div key={i} className="mt-3 border rounded p-2 text-sm">
          <p className="font-medium">
            {run.trade}: {run.created} provider(s) in batch
          </p>
          {run.candidates?.map((cand) => (
            <div key={cand.companyId} className="mt-2 border-t pt-2">
              <p>
                #{cand.rank} {cand.legalName} — score {(cand.score * 100).toFixed(1)} (
                {cand.specialisation})
              </p>
              <ul className="ml-4 list-disc text-xs text-gray-600">
                {Object.entries(cand.factors).map(([name, f]) => (
                  <FactorRow key={name} name={name} f={f} />
                ))}
              </ul>
              <p className="text-xs text-gray-400">
                Proximity is a heuristic match on free-text service areas in phase 2.
              </p>
            </div>
          ))}
          {run.excluded && run.excluded.length > 0 && (
            <details className="mt-2">
              <summary className="text-xs text-gray-500 cursor-pointer">
                {run.excluded.length} provider(s) excluded by hard filters
              </summary>
              <ul className="ml-4 list-disc text-xs text-gray-500">
                {run.excluded.map((e) => (
                  <li key={e.companyId}>
                    {e.legalName}: {e.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ))}
    </Card>
  );
}

function BookingFlowPanel({
  data,
  providers,
  disabled,
  onChanged,
}: {
  data: RequestDetailData;
  providers: { company: { id: string; legalName: string } }[] | null;
  disabled: boolean;
  onChanged: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const openRequests = data.bookingRequests.filter(({ br }) => br.state === "requested");
  const activeHolds = data.holds.filter((h) => h.state === "active");

  async function post(path: string, body: unknown): Promise<{ ok: boolean; body: Record<string, unknown> }> {
    const res = await fetch(`/api/requests/${data.request.id}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const body2 = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      if (body2.error === "capacity_conflict") {
        const w = body2.winner as { requestId?: string } | null;
        setError(
          `Capacity conflict: provider already booked for overlapping dates${w?.requestId ? ` (booking on request ${w.requestId.slice(0, 8)}…)` : ""}. First confirmed booking stands.`,
        );
      } else {
        setError(String(body2.error ?? `failed (${res.status})`));
      }
      return { ok: false, body: body2 };
    }
    setError(null);
    return { ok: true, body: body2 };
  }

  async function submit(e: FormEvent<HTMLFormElement>, path: string, numeric?: string) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const d = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
      if (numeric) d[numeric] = String(Number(d[numeric]));
      const { ok } = await post(path, d);
      if (ok) {
        (e.target as HTMLFormElement).reset();
        await onChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Booking (request → confirm)">
      {/* details/03: the platform cannot know about commitments made outside
          the system — always visible where bookings are made. */}
      <p className="mb-2 text-xs text-gray-500">
        Note: the platform cannot see commitments made outside this system. A provider's
        availability here is not a guarantee — off-platform bookings may exist.
      </p>
      {disabled ? (
        <p className="text-sm text-gray-500">Booking not available in this status.</p>
      ) : (
        <div className="space-y-3">
          <form
            onSubmit={(e) => submit(e, "/bookings/request", "workersCount")}
            className="flex gap-2 items-center flex-wrap text-sm"
          >
            <select name="responseId" required className="border rounded p-1.5 text-sm">
              {(data.responses ?? [])
                .filter(({ response }) => ["interest", "quote"].includes(response.type))
                .map(({ response, provider }) => (
                  <option key={response.id} value={response.id}>
                    {provider?.legalName ?? response.companyId.slice(0, 8)} — {response.type}
                  </option>
                ))}
            </select>
            <select name="trade" required className="border rounded p-1.5 text-sm">
              {data.trades.map((t) => (
                <option key={t.trade} value={t.trade}>
                  {t.trade}
                </option>
              ))}
            </select>
            <input name="startDate" type="date" required className="border rounded p-1.5 text-sm" />
            <input name="endDate" type="date" required className="border rounded p-1.5 text-sm" />
            <input
              name="workersCount"
              type="number"
              min="1"
              placeholder="Workers"
              required
              className="border rounded p-1.5 text-sm w-24"
            />
            <button className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm" disabled={busy}>
              Request booking
            </button>
          </form>

          {openRequests.map(({ br, provider }) => (
            <div key={br.id} className="flex items-center gap-2 text-sm border rounded p-2">
              <span className="flex-1">
                {provider?.legalName ?? br.companyId.slice(0, 8)} · {br.trade} · {br.startDate} →{" "}
                {br.endDate} · {br.workersCount} workers ·{" "}
                <span className="text-amber-600 font-medium">
                  Tentative — awaiting confirmation
                </span>
              </span>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const { ok } = await post("/bookings/confirm", { bookingRequestId: br.id });
                    if (ok) await onChanged();
                  } finally {
                    setBusy(false);
                  }
                }}
                className="bg-green-600 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
              >
                Confirm
              </button>
            </div>
          ))}

          {(() => {
            const live = data.bookings.find(({ booking }) => !booking.outcome);
            if (!live) return null;
            const { booking, provider } = live;
            const reconfirm = data.reconfirmations?.[booking.id];
            const proposals = (data.reschedules ?? []).filter(
              (r) => r.bookingId === booking.id,
            );
            const openProposal = proposals.find((r) => r.state === "proposed");
            return (
              <div className="border rounded p-2 space-y-2 bg-green-50">
                <div className="text-sm">
                  <span className="font-medium text-green-700">Confirmed booking</span> ·{" "}
                  {provider?.legalName ?? booking.companyId.slice(0, 8)} · {booking.startDate} →{" "}
                  {booking.endDate} · {booking.workersCount} workers
                  {reconfirm?.required && (
                    <span className="ml-2 text-amber-600 font-medium">
                      ⚠ Availability {reconfirm.worstState} — reconfirmation required
                    </span>
                  )}
                </div>

                {reconfirm?.required && (
                  <button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await fetch(`/api/providers/${booking.companyId}/availability/reconfirm`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ bookingId: booking.id }),
                        });
                        await onChanged();
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="bg-amber-500 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
                  >
                    Reconfirm availability
                  </button>
                )}

                {!openProposal ? (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (busy) return;
                      setBusy(true);
                      try {
                        const d = Object.fromEntries(
                          new FormData(e.currentTarget),
                        ) as Record<string, string>;
                        d.workersCount = String(Number(d.workersCount));
                        const { ok } = await post("/bookings/reschedule", d);
                        if (ok) await onChanged();
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="flex gap-2 items-center flex-wrap text-sm border-t pt-2"
                  >
                    <span className="text-gray-600">Reschedule:</span>
                    <input name="startDate" type="date" required className="border rounded p-1.5 text-sm" />
                    <input name="endDate" type="date" required className="border rounded p-1.5 text-sm" />
                    <input
                      name="workersCount"
                      type="number"
                      min="1"
                      placeholder="Workers"
                      required
                      className="border rounded p-1.5 text-sm w-24"
                    />
                    <input name="reason" placeholder="Reason" className="border rounded p-1.5 text-sm w-40" />
                    <button className="bg-blue-600 text-white px-3 py-1 rounded text-sm" disabled={busy}>
                      Propose
                    </button>
                  </form>
                ) : (
                  <div className="text-sm border-t pt-2 flex items-center gap-2 flex-wrap">
                    <span>
                      Reschedule proposed: {openProposal.startDate} → {openProposal.endDate} ·{" "}
                      {openProposal.workersCount} workers
                      {openProposal.reason ? ` · ${openProposal.reason}` : ""}
                    </span>
                    <button
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const { ok } = await post(
                            `/bookings/reschedule/${openProposal.id}/confirm`,
                            {},
                          );
                          if (ok) await onChanged();
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="bg-green-600 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
                    >
                      Confirm reschedule
                    </button>
                    <button
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await post(`/bookings/reschedule/${openProposal.id}/reject`, {});
                          await onChanged();
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="text-red-600 hover:underline text-sm"
                    >
                      Reject
                    </button>
                  </div>
                )}

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (busy) return;
                    setBusy(true);
                    try {
                      const d = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
                      const { ok } = await post("/bookings/cancel", d);
                      if (ok) await onChanged();
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="flex gap-2 items-center flex-wrap text-sm border-t pt-2"
                >
                  <span className="text-gray-600">Cancel booking:</span>
                  <select name="cancelledBy" required className="border rounded p-1.5 text-sm">
                    <option value="customer">by customer</option>
                    <option value="provider">by provider</option>
                  </select>
                  <input name="reason" placeholder="Reason (required)" required className="border rounded p-1.5 text-sm w-48" />
                  <button className="bg-red-600 text-white px-3 py-1 rounded text-sm" disabled={busy}>
                    Cancel booking
                  </button>
                </form>
              </div>
            );
          })()}

          <form
            onSubmit={(e) => submit(e, "/holds", "workersCount")}
            className="flex gap-2 items-center flex-wrap text-sm border-t pt-2"
          >
            <select name="companyId" required className="border rounded p-1.5 text-sm">
              {(providers ?? []).map(({ company }) => (
                <option key={company.id} value={company.id}>
                  {company.legalName}
                </option>
              ))}
            </select>
            <select name="trade" required className="border rounded p-1.5 text-sm">
              {data.trades.map((t) => (
                <option key={t.trade} value={t.trade}>
                  {t.trade}
                </option>
              ))}
            </select>
            <input name="startDate" type="date" required className="border rounded p-1.5 text-sm" />
            <input name="endDate" type="date" required className="border rounded p-1.5 text-sm" />
            <input
              name="workersCount"
              type="number"
              min="1"
              placeholder="Workers"
              required
              className="border rounded p-1.5 text-sm w-24"
            />
            <button className="bg-gray-700 text-white px-3 py-1.5 rounded text-sm" disabled={busy}>
              Place 48h hold
            </button>
          </form>

          {activeHolds.map((h) => (
            <div key={h.id} className="flex items-center gap-2 text-xs text-gray-600">
              <span className="flex-1">
                Hold · {h.trade} · {h.startDate} → {h.endDate} · expires {h.expiresAt.slice(0, 16)}
              </span>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await fetch(`/api/holds/${h.id}/release`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ reason: "released by staff" }),
                    });
                    await onChanged();
                  } finally {
                    setBusy(false);
                  }
                }}
                className="text-red-600 hover:underline"
              >
                Release
              </button>
            </div>
          ))}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Card>
  );
}

/**
 * Phase 3: post-hoc explainability — the outreach panel re-opens the factor
 * breakdown stored on matching-channel entries at match time (per-factor
 * contribution, inputs, missing flags and the weights then in force), without
 * recomputation. Legacy entries that predate weight snapshots render with
 * defaults noted.
 */
function OutreachBatchesPanel({
  outreach,
}: {
  outreach: RequestDetailData["outreach"];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const matching = outreach.filter(({ entry }) => entry.channel === "matching");
  if (matching.length === 0) return null;

  return (
    <Card title="Outreach batches (matching)">
      <div className="space-y-2 text-sm">
        {matching.map(({ entry, provider }) => {
          let parsed: {
            factors?: Record<
              string,
              { value: number; weighted: number; missing: boolean; inputs: Record<string, unknown> }
            >;
            weights?: Record<string, number>;
          } | null = null;
          let legacy = false;
          try {
            const raw = entry.matchFactorsJson ? JSON.parse(entry.matchFactorsJson) : null;
            if (raw && typeof raw === "object" && raw.factors) {
              parsed = raw;
            } else if (raw && typeof raw === "object") {
              // Legacy (phase 2): bare factor breakdown without a weights snapshot.
              parsed = { factors: raw as Record<string, never> };
              legacy = true;
            }
          } catch {
            parsed = null;
          }
          const isOpen = openId === entry.id;
          return (
            <div key={entry.id} className="border rounded p-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">
                  {provider?.legalName ?? entry.companyId.slice(0, 8)}
                </span>
                <span className="text-xs text-gray-500">
                  {entry.trade ?? ""} · batch {entry.batchNumber} · score{" "}
                  {entry.matchScore != null ? entry.matchScore.toFixed(3) : "?"}
                </span>
                {parsed?.factors && (
                  <button
                    type="button"
                    className="text-blue-600 hover:underline text-xs"
                    onClick={() => setOpenId(isOpen ? null : entry.id)}
                  >
                    {isOpen ? "Hide ranking rationale" : "Why this provider ranked here"}
                  </button>
                )}
              </div>
              {isOpen && parsed?.factors && (
                <div className="mt-2 border-t pt-2 space-y-1">
                  {legacy && (
                    <p className="text-xs text-gray-400">
                      Stored before weight snapshots — defaults assumed.
                    </p>
                  )}
                  {parsed.weights && (
                    <p className="text-xs text-gray-500">
                      Weights at match time:{" "}
                      {Object.entries(parsed.weights)
                        .map(([k, v]) => `${k} ${v.toFixed(2)}`)
                        .join(" · ")}
                    </p>
                  )}
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-500">
                        <th className="pr-2">Factor</th>
                        <th className="pr-2">Value</th>
                        <th className="pr-2">Weighted</th>
                        <th>Inputs / missing</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(parsed.factors).map(([name, f]) => (
                        <tr key={name} className="border-t">
                          <td className="pr-2 py-0.5">{name}</td>
                          <td className="pr-2">{f.missing ? "—" : f.value.toFixed(2)}</td>
                          <td className="pr-2">{f.weighted.toFixed(3)}</td>
                          <td className={f.missing ? "text-amber-600" : "text-gray-500"}>
                            {f.missing
                              ? `no data — contributes 0 (${JSON.stringify(f.inputs)})`
                              : JSON.stringify(f.inputs)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
