import { FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { get, patch, post } from "../api";
import { Company, PROVIDER_STATUSES, PRICING_MODELS, TRADES, statusBadge } from "../types";
import { availabilityLabel } from "../availabilityLabel";

type Declaration = {
  id: string;
  trade: string;
  workersCount: number;
  dateFrom: string;
  dateTo: string;
  channel: string;
  lastConfirmedAt: string;
  freshness: string;
};

type AvailabilityData = {
  declarations: Declaration[];
  summary: { confirmedWorkers: number; hasFreshDeclarations: boolean };
};

const toneClass: Record<string, string> = {
  confirmed: "bg-green-100 text-green-800",
  reconfirm: "bg-yellow-100 text-yellow-800",
  unconfirmed: "bg-gray-200 text-gray-700",
};

type VerificationBadge = {
  displayable: boolean;
  status: string;
  checkedAt: string;
  sourceDataset: string;
  sourceLicence: string;
};

type VerificationData = {
  badges: {
    registryActive: VerificationBadge | null;
    trades: Record<string, VerificationBadge>;
  };
  mtrBadgesEnabled: boolean;
};

async function fetchProvider(id: string): Promise<Company> {
  return get<Company>(`/providers/${id}`);
}

async function fetchAvailability(id: string): Promise<AvailabilityData> {
  return get<AvailabilityData>(`/providers/${id}/availability`);
}

async function fetchVerifications(id: string): Promise<VerificationData> {
  return get<VerificationData>(`/providers/${id}/verifications`);
}

export default function ProviderDetail() {
  const { id } = useParams<{ id: string }>();
  const [provider, setProvider] = useState<Company | null>(null);
  const [availability, setAvailability] = useState<AvailabilityData | null>(null);
  const [verifications, setVerifications] = useState<VerificationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  async function load() {
    if (!id) return;
    try {
      setProvider(await fetchProvider(id));
      setAvailability(await fetchAvailability(id));
      setVerifications(await fetchVerifications(id));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      const loadedProvider = await fetchProvider(id);
      if (!alive) return;
      setProvider(loadedProvider);
      const loadedAvailability = await fetchAvailability(id);
      if (!alive) return;
      setAvailability(loadedAvailability);
      const loadedVerifications = await fetchVerifications(id);
      if (!alive) return;
      setVerifications(loadedVerifications);
      setError(null);
    })().catch((e: unknown) => {
      if (alive) setError(String(e));
    });
    return () => {
      alive = false;
    };
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

  async function addDeclaration(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!id) return;
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await post(`/providers/${id}/availability`, {
        ...data,
        workersCount: Number((data as Record<string, string>).workersCount),
      });
      (e.target as HTMLFormElement).reset();
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

          <h2 className="font-semibold mb-2 mt-6">Verification</h2>
          <div className="space-y-2 text-sm">
            {(() => {
              const b = verifications?.badges;
              if (!b || (!b.registryActive && Object.keys(b.trades).length === 0)) {
                return (
                  <p className="bg-white p-3 rounded border text-gray-500">
                    No register checks imported yet — run the offline import scripts.
                  </p>
                );
              }
              const items: { label: string; badge: VerificationBadge; note?: string }[] = [];
              if (b.registryActive) {
                items.push({
                  label: "✓ Registered & active",
                  badge: b.registryActive,
                  note: b.registryActive.displayable
                    ? undefined
                    : "invalid or unknown registry status",
                });
              }
              for (const [trade, badge] of Object.entries(b.trades)) {
                items.push({
                  label: `✓ Trade notification valid — ${trade}`,
                  badge,
                  note: !badge.displayable
                    ? "hidden in views until TTJA licence confirmation (MTR_BADGES_ENABLED)"
                    : badge.status !== "valid"
                      ? "not currently valid"
                      : undefined,
                });
              }
              return items.map(({ label, badge, note }) => (
                <div key={label} className="bg-white p-3 rounded border">
                  <div className="flex items-center justify-between gap-2">
                    <span className={badge.status === "valid" ? "font-medium text-green-800" : "font-medium text-gray-500"}>
                      {label}
                    </span>
                    <span className="text-xs text-gray-500">
                      checked {badge.checkedAt.slice(0, 10)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {badge.sourceDataset} · {badge.sourceLicence}
                    {note ? ` · ${note}` : ""}
                  </p>
                </div>
              ));
            })()}
          </div>

          <h2 className="font-semibold mb-2 mt-6">
            Availability{" "}
            {availability && (
              <span className="text-xs font-normal text-gray-500">
                {availability.summary.hasFreshDeclarations
                  ? `${availability.summary.confirmedWorkers} workers confirmed fresh`
                  : "no confirmed capacity"}
              </span>
            )}
          </h2>
          <div className="space-y-2">
            {(availability?.declarations ?? []).map((d) => {
              const lbl = availabilityLabel(d);
              return (
                <div key={d.id} className="bg-white p-3 rounded border text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{d.trade}</span>
                    <span className={`px-2 py-0.5 rounded text-xs ${toneClass[lbl.tone]}`}>
                      {lbl.label}
                    </span>
                  </div>
                  <p className="text-gray-600 mt-1">
                    {d.workersCount} workers · {d.dateFrom} → {d.dateTo} · {d.channel} · confirmed{" "}
                    {d.lastConfirmedAt.slice(0, 10)}
                  </p>
                </div>
              );
            })}
            {availability && availability.declarations.length === 0 && (
              <p className="text-sm text-gray-500 bg-white p-3 rounded border">
                No availability declared — shown to staff as{" "}
                <span className={`px-1.5 py-0.5 rounded text-xs ${toneClass.unconfirmed}`}>
                  Unconfirmed
                </span>
              </p>
            )}
          </div>
          <form onSubmit={addDeclaration} className="bg-white p-4 rounded border mt-3 space-y-3">
            <h3 className="text-sm font-semibold">Declare availability</h3>
            <div className="grid grid-cols-2 gap-2">
              <select name="trade" className="border rounded p-1.5 text-sm" required>
                {TRADES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <input
                name="workersCount"
                type="number"
                min="1"
                placeholder="Workers *"
                className="border rounded p-1.5 text-sm"
                required
              />
              <input name="dateFrom" type="date" className="border rounded p-1.5 text-sm" required />
              <input name="dateTo" type="date" className="border rounded p-1.5 text-sm" required />
              <select name="channel" className="border rounded p-1.5 text-sm col-span-2">
                <option value="booking_system">booking_system</option>
                <option value="email_only">email_only</option>
              </select>
            </div>
            <button className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm">
              Record declaration
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
