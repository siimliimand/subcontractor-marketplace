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
        {r.trade} · {r.location} · start {r.startDate} · crew {r.crewSize}
        {r.pmName ? ` · PM ${r.pmName}` : ""}
        {r.cancelledBy ? ` · cancelled by ${r.cancelledBy}: ${r.cancelReason}` : ""}
      </p>

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

          <OutreachPanel
            providers={providers}
            contacted={data.outreach.map(({ entry }) => entry.companyId)}
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

function OutreachPanel({
  providers,
  contacted,
  disabled,
  onLog,
}: {
  providers: { company: { id: string; legalName: string } }[];
  contacted: string[];
  disabled: boolean;
  onLog: (providerIds: string[], notes: string) => Promise<OutreachResult>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

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

  if (disabled) return <Card title="Outreach">Request is closed for outreach.</Card>;

  return (
    <Card title="Log outreach batch">
      <div className="space-y-2 text-sm">
        {providers.map(({ company }) => {
          const isSelected = selected.includes(company.id);
          const isContacted = contacted.includes(company.id);
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
            </button>
          );
        })}
        <input
          className="border rounded p-1.5 w-full"
          placeholder="Batch notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <button
          className="bg-purple-600 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
          disabled={selected.length === 0}
          onClick={submit}
        >
          Log outreach to {selected.length} provider(s)
        </button>
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
