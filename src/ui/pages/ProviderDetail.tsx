import { FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { get, patch, post } from "../api";
import { Company, PROVIDER_STATUSES, PRICING_MODELS, TRADES, statusBadge } from "../types";

export default function ProviderDetail() {
  const { id } = useParams<{ id: string }>();
  const [provider, setProvider] = useState<Company | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  async function load() {
    if (!id) return;
    try {
      setProvider(await get<Company>(`/providers/${id}`));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  async function saveProvider(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!id) return;
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await patch(`/providers/${id}`, data);
      setEditing(false);
      await load();
    } catch (err) {
      setError(String(err));
    }
  }

  async function changeStatus(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!id) return;
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await patch(`/providers/${id}`, data);
      await load();
    } catch (err) {
      setError(String(err));
    }
  }

  async function addService(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!id) return;
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await post(`/providers/${id}/services`, data);
      await load();
    } catch (err) {
      setError(String(err));
    }
  }

  async function changeServiceStatus(serviceId: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!id) return;
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await patch(`/providers/${id}/services/${serviceId}`, data);
      await load();
    } catch (err) {
      setError(String(err));
    }
  }

  if (!provider) return <div>{error ?? "Loading…"}</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">{provider.legalName}</h1>
          <p className="text-sm text-gray-500">
            Reg. {provider.registrationIdentifier} · {provider.contactEmail}
            {provider.contactPhone ? ` · ${provider.contactPhone}` : ""}
          </p>
        </div>
        <span className={`px-2 py-0.5 rounded text-xs ${statusBadge(provider.status)}`}>
          {provider.status}
        </span>
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}

      <div className="grid grid-cols-2 gap-6">
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">Profile</h2>
            <button
              className="text-sm text-blue-600 hover:underline"
              onClick={() => setEditing(!editing)}
            >
              {editing ? "Cancel" : "Edit"}
            </button>
          </div>

          {editing ? (
            <form onSubmit={saveProvider} className="bg-white p-4 rounded border space-y-3">
              <label className="block text-sm">
                Legal name
                <input
                  name="legalName"
                  defaultValue={provider.legalName}
                  className="mt-1 w-full border rounded p-1.5"
                />
              </label>
              <label className="block text-sm">
                Contact email
                <input
                  name="contactEmail"
                  defaultValue={provider.contactEmail}
                  className="mt-1 w-full border rounded p-1.5"
                />
              </label>
              <label className="block text-sm">
                Contact phone
                <input
                  name="contactPhone"
                  defaultValue={provider.contactPhone ?? ""}
                  className="mt-1 w-full border rounded p-1.5"
                />
              </label>
              <button className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm">
                Save
              </button>
            </form>
          ) : (
            <div className="bg-white p-4 rounded border text-sm text-gray-700">
              Created {provider.createdAt.slice(0, 10)} · Updated {provider.updatedAt.slice(0, 10)}
              {provider.statusReason && (
                <p className="mt-2 text-gray-500">
                  Status reason: {provider.statusReason}
                  {provider.statusChangedAt && ` (${provider.statusChangedAt.slice(0, 10)})`}
                </p>
              )}
            </div>
          )}

          <form onSubmit={changeStatus} className="bg-white p-4 rounded border mt-4 space-y-2">
            <h3 className="text-sm font-semibold">Change status</h3>
            <select name="status" className="border rounded p-1.5 text-sm w-full">
              {PROVIDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              name="reason"
              placeholder="Reason (required)"
              className="border rounded p-1.5 text-sm w-full"
            />
            <button className="bg-gray-800 text-white px-3 py-1 rounded text-sm">
              Update status
            </button>
          </form>
        </div>

        <div>
          <h2 className="font-semibold mb-2">Services</h2>
          <div className="space-y-3">
            {provider.services?.map((s) => (
              <div key={s.id} className="bg-white p-4 rounded border text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{s.trade}</span>
                  <span className={`px-2 py-0.5 rounded text-xs ${statusBadge(s.status)}`}>
                    {s.status}
                  </span>
                </div>
                <p className="text-gray-600 mt-1">
                  Area: {s.serviceArea} · Model: {s.pricingModel}
                  {s.pricingApproach ? ` · ${s.pricingApproach}` : ""}
                  {s.skills ? ` · Skills: ${s.skills}` : ""}
                </p>
                {s.statusReason && <p className="text-gray-500 mt-1">Reason: {s.statusReason}</p>}
                <form
                  onSubmit={(e) => changeServiceStatus(s.id, e)}
                  className="mt-2 flex gap-2 items-center"
                >
                  <select name="status" className="border rounded p-1 text-xs">
                    {PROVIDER_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                  <input
                    name="reason"
                    placeholder="Reason"
                    className="border rounded p-1 text-xs flex-1"
                  />
                  <button className="text-xs bg-gray-800 text-white px-2 py-1 rounded">
                    Set
                  </button>
                </form>
              </div>
            ))}
          </div>

          <form onSubmit={addService} className="bg-white p-4 rounded border mt-4 space-y-3">
            <h3 className="text-sm font-semibold">Add service</h3>
            <div className="grid grid-cols-2 gap-2">
              <select name="trade" className="border rounded p-1.5 text-sm">
                {TRADES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select name="pricingModel" className="border rounded p-1.5 text-sm">
                {PRICING_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <input
                name="serviceArea"
                placeholder="Service area *"
                className="border rounded p-1.5 text-sm"
              />
              <input
                name="pricingApproach"
                placeholder="Pricing approach"
                className="border rounded p-1.5 text-sm"
              />
              <input
                name="skills"
                placeholder="Skills"
                className="border rounded p-1.5 text-sm col-span-2"
              />
            </div>
            <button className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm">
              Add service
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
