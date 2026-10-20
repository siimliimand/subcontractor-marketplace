import { FormEvent, useEffect, useState } from "react";
import { get, post } from "../api";

type SuppressionRow = {
  email: string;
  reason: string;
  createdAt: string;
};

export default function Suppressions() {
  const [rows, setRows] = useState<SuppressionRow[] | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [removalReason, setRemovalReason] = useState<Record<string, string>>({});

  async function load() {
    try {
      const data = await get<{ suppressions: SuppressionRow[] }>("/suppressions");
      setRows(data.suppressions);
    } catch (e) {
      setFeedback(String(e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await post("/suppressions", data);
      setFeedback(null);
      (e.target as HTMLFormElement).reset();
      await load();
    } catch (err) {
      setFeedback(String(err));
    }
  }

  async function remove(email: string) {
    const reason = removalReason[email]?.trim();
    if (!reason) {
      setFeedback("A reason is required to remove a suppression.");
      return;
    }
    try {
      const res = await fetch(`/api/suppressions/${encodeURIComponent(email)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setFeedback(body.error ?? `failed (${res.status})`);
        return;
      }
      setFeedback(null);
      await load();
    } catch (err) {
      setFeedback(String(err));
    }
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Email suppression list</h1>
      <p className="text-sm text-gray-500 mb-4 max-w-2xl">
        Suppressed addresses are skipped by every send path (manual and bounce-driven entries
        behave identically). Adding requires a reason; removing requires one too — both are
        audit-logged.
      </p>

      <form onSubmit={add} className="flex gap-2 items-center flex-wrap mb-4">
        <input name="email" type="email" required placeholder="email@example.com" className="border rounded p-1.5 text-sm w-64" />
        <input name="reason" required placeholder="Reason (e.g. provider request)" className="border rounded p-1.5 text-sm w-64" />
        <button className="bg-red-600 text-white px-3 py-1.5 rounded text-sm">Suppress</button>
      </form>

      {feedback && <div className="mb-4 text-sm text-red-600 bg-red-50 p-2 rounded">{feedback}</div>}

      <div className="space-y-2 max-w-3xl">
        {(rows ?? []).map((row) => (
          <div key={row.email} className="border rounded p-2 text-sm">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-medium">{row.email}</span>
              <span className="text-xs text-gray-500">added {row.createdAt?.slice(0, 10)}</span>
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs text-gray-500 flex-1">{row.reason}</span>
              <input
                placeholder="Removal reason"
                value={removalReason[row.email] ?? ""}
                onChange={(e) => setRemovalReason({ ...removalReason, [row.email]: e.target.value })}
                className="border rounded p-1 text-xs w-44"
              />
              <button
                onClick={() => remove(row.email)}
                className="text-blue-600 hover:underline text-xs"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        {rows && rows.length === 0 && (
          <p className="text-sm text-gray-500">No suppressed addresses.</p>
        )}
      </div>
    </div>
  );
}
