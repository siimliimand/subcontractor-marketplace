import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get, post } from "../api";
import { Company, PROVIDER_STATUSES, TRADES, statusBadge } from "../types";

type ProviderRow = { company: Company; services: unknown[] };

export default function Providers() {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filters, setFilters] = useState({ trade: "", status: "", serviceArea: "", q: "" });

  async function load() {
    const params = new URLSearchParams(
      Object.entries(filters).filter(([, v]) => v !== ""),
    ).toString();
    try {
      setProviders(await get<ProviderRow[]>(`/providers${params ? `?${params}` : ""}`));
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
    if (submitting) return;
    setSubmitting(true);
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await post("/providers", data);
      setShowForm(false);
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
        <h1 className="text-xl font-bold">Providers</h1>
        <button
          className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? "Cancel" : "New provider"}
        </button>
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}

      {showForm && (
        <form onSubmit={submit} className="mb-6 bg-white p-4 rounded border space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Legal name *
              <input name="legalName" required className="mt-1 w-full border rounded p-1.5" />
            </label>
            <label className="text-sm">
              Registration identifier *
              <input
                name="registrationIdentifier"
                required
                className="mt-1 w-full border rounded p-1.5"
              />
            </label>
            <label className="text-sm">
              Contact email *
              <input
                name="contactEmail"
                type="email"
                required
                className="mt-1 w-full border rounded p-1.5"
              />
            </label>
            <label className="text-sm">
              Contact phone
              <input name="contactPhone" className="mt-1 w-full border rounded p-1.5" />
            </label>
          </div>
          <button
            disabled={submitting}
            className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            Create provider
          </button>
        </form>
      )}

      <div className="mb-4 flex gap-3 text-sm">
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
        <select
          className="border rounded p-1.5"
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
        >
          <option value="">All statuses</option>
          {PROVIDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          className="border rounded p-1.5"
          placeholder="Service area"
          value={filters.serviceArea}
          onChange={(e) => setFilters({ ...filters, serviceArea: e.target.value })}
        />
        <input
          className="border rounded p-1.5 flex-1"
          placeholder="Search by name"
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
        />
      </div>

      <table className="w-full bg-white rounded border text-sm">
        <thead className="bg-gray-50 text-left text-gray-600">
          <tr>
            <th className="p-2">Name</th>
            <th className="p-2">Reg. identifier</th>
            <th className="p-2">Contact</th>
            <th className="p-2">Trades</th>
            <th className="p-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {providers.map(({ company, services }) => (
            <tr key={company.id} className="border-t hover:bg-gray-50">
              <td className="p-2">
                <Link to={`/providers/${company.id}`} className="text-blue-600 hover:underline">
                  {company.legalName}
                </Link>
              </td>
              <td className="p-2">{company.registrationIdentifier}</td>
              <td className="p-2">{company.contactEmail}</td>
              <td className="p-2">
                {[...new Set((services as { trade: string }[]).map((s) => s.trade))].join(", ")}
              </td>
              <td className="p-2">
                <span className={`px-2 py-0.5 rounded text-xs ${statusBadge(company.status)}`}>
                  {company.status}
                </span>
              </td>
            </tr>
          ))}
          {providers.length === 0 && (
            <tr>
              <td colSpan={5} className="p-4 text-center text-gray-500">
                No providers found
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
