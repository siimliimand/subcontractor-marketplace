import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get, post } from "../api";
import { REQUEST_STATUSES, TRADES, statusBadge } from "../types";
import type { RequestRow } from "../requestTypes";

export default function Requests() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filters, setFilters] = useState({ status: "", trade: "" });

  async function load() {
    const params = new URLSearchParams(
      Object.entries(filters).filter(([, v]) => v !== ""),
    ).toString();
    try {
      setRequests(await get<RequestRow[]>(`/requests${params ? `?${params}` : ""}`));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    load();
  }, [filters]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await post("/requests", {
        ...data,
        crewSize: Number(data.crewSize),
      });
      setShowForm(false);
      await load();
    } catch (err) {
      setError(String(err));
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
        <form onSubmit={submit} className="mb-6 bg-white p-4 rounded border space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Title *
              <input name="title" required className="mt-1 w-full border rounded p-1.5" />
            </label>
            <label className="text-sm">
              On behalf of PM
              <input name="pmName" className="mt-1 w-full border rounded p-1.5" />
            </label>
            <label className="text-sm col-span-2">
              Work description *
              <textarea name="description" required className="mt-1 w-full border rounded p-1.5" />
            </label>
            <label className="text-sm">
              Location *
              <input name="location" required className="mt-1 w-full border rounded p-1.5" />
            </label>
            <label className="text-sm">
              Trade *
              <select name="trade" required className="mt-1 w-full border rounded p-1.5">
                {TRADES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Desired start date *
              <input
                name="startDate"
                type="date"
                required
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
                className="mt-1 w-full border rounded p-1.5"
              />
            </label>
            <label className="text-sm">
              Budget
              <input name="budget" className="mt-1 w-full border rounded p-1.5" />
            </label>
            <label className="text-sm">
              Duration
              <input name="duration" className="mt-1 w-full border rounded p-1.5" />
            </label>
            <label className="text-sm">
              Notes
              <input name="notes" className="mt-1 w-full border rounded p-1.5" />
            </label>
          </div>
          <button className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700">
            Create draft request
          </button>
        </form>
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
