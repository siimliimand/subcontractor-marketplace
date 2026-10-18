import { useEffect, useState } from "react";
import { get } from "../api";
import { TRADES } from "../types";
import { Link } from "react-router-dom";

type Metrics = {
  eligibleRequests: number;
  numerator: { qualifiedWithin24h: number; booked: number };
  denominators: { successRate: number; conversion: number };
  successRate: number | null;
  conversion: number | null;
  medianHoursToFirstQualified: number | null;
  email?: {
    sent: number;
    delivered: number;
    bounced: number;
    opened: number;
    automatedQualified: number;
    manualQualified: number;
  };
};

type SupplyRow = {
  trade: string;
  minimum: number;
  activeProviders: number;
  met: boolean;
};

type EffortData = {
  perRequest: {
    id: string;
    title: string;
    status: string;
    createdAt: string;
    totalMinutes: number;
    manualEvents: number;
  }[];
  weekly: { week: string; minutes: number; interventions: number }[];
};

function pct(n: number | null) {
  if (n === null) return "—";
  return `${Math.round(n * 100)}%`;
}

export default function Dashboard() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [supply, setSupply] = useState<SupplyRow[]>([]);
  const [effort, setEffort] = useState<EffortData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(
      Object.entries({ from, to }).filter(([, v]) => v !== ""),
    ).toString();
    Promise.all([
      get<Metrics>(`/dashboard/overview${params ? `?${params}` : ""}`),
      get<SupplyRow[]>("/dashboard/supply"),
      get<EffortData>("/dashboard/effort"),
    ])
      .then(([m, s, e]) => {
        setMetrics(m);
        setSupply(s);
        setEffort(e);
      })
      .catch((e) => setError(String(e)));
  }, [from, to]);

  const maxWeeklyMinutes = Math.max(1, ...(effort?.weekly.map((w) => w.minutes) ?? [1]));

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Funnel dashboard</h1>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}

      <div className="flex gap-3 mb-6 text-sm">
        <label>
          From{" "}
          <input
            type="date"
            className="border rounded p-1.5"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          To{" "}
          <input
            type="date"
            className="border rounded p-1.5"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>

      {metrics && (
        <div className="grid grid-cols-4 gap-4 mb-8">
          <MetricCard
            title="Eligible requests"
            value={String(metrics.eligibleRequests)}
            detail="requests that reached approval"
          />
          <MetricCard
            title="Qualified response ≤ 24h"
            value={pct(metrics.successRate)}
            detail={`${metrics.numerator.qualifiedWithin24h} of ${metrics.denominators.successRate} (customer-cancelled excluded)`}
          />
          <MetricCard
            title="Median time to first qualified response"
            value={
              metrics.medianHoursToFirstQualified === null
                ? "—"
                : `${metrics.medianHoursToFirstQualified.toFixed(1)} h`
            }
            detail="business hours, Europe/Tallinn; automated responses excluded"
          />
          <MetricCard
            title="Booking conversion"
            value={pct(metrics.conversion)}
            detail={`${metrics.numerator.booked} of ${metrics.denominators.conversion} (open requests excluded)`}
          />
        </div>
      )}

      {metrics?.email && (
        <section className="mb-8">
          <h2 className="font-semibold mb-2">Email pipeline</h2>
          <div className="bg-white p-4 rounded border text-sm">
            <p>
              Sent <span className="font-semibold">{metrics.email.sent}</span> · Delivered{" "}
              <span className="font-semibold">{metrics.email.delivered}</span> · Bounced{" "}
              <span className="font-semibold">{metrics.email.bounced}</span> · Opened{" "}
              <span className="font-semibold">{metrics.email.opened}</span>
            </p>
            <p className="text-gray-600 mt-1">
              Responses: {metrics.email.automatedQualified} automated ·{" "}
              {metrics.email.manualQualified} manual
            </p>
          </div>
        </section>
      )}

      <section className="mb-8">
        <h2 className="font-semibold mb-2">Supply — active providers by trade</h2>
        <table className="w-full bg-white rounded border text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="p-2">Trade</th>
              <th className="p-2">Active providers</th>
              <th className="p-2">Pilot minimum</th>
              <th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {TRADES.map((trade) => {
              const row = supply.find((s) => s.trade === trade);
              if (!row) return null;
              return (
                <tr key={trade} className="border-t">
                  <td className="p-2">{trade}</td>
                  <td className="p-2">{row.activeProviders}</td>
                  <td className="p-2">{row.minimum}</td>
                  <td className="p-2">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${
                        row.met ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                      }`}
                    >
                      {row.met ? "met" : "unmet"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {effort && (
        <section>
          <h2 className="font-semibold mb-2">Manual effort</h2>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm text-gray-600 mb-2">Weekly trend</h3>
              <div className="bg-white p-4 rounded border space-y-2 text-sm">
                {effort.weekly.map((w) => (
                  <div key={w.week} className="flex items-center gap-2">
                    <span className="w-20 text-gray-500">{w.week}</span>
                    <div className="flex-1 bg-gray-100 rounded">
                      <div
                        className="bg-blue-500 h-4 rounded"
                        style={{ width: `${(w.minutes / maxWeeklyMinutes) * 100}%` }}
                      />
                    </div>
                    <span className="w-24 text-right">
                      {w.minutes} min · {w.interventions} int.
                    </span>
                  </div>
                ))}
                {effort.weekly.length === 0 && <p className="text-gray-500">No data yet</p>}
              </div>
            </div>
            <div>
              <h3 className="text-sm text-gray-600 mb-2">Per request</h3>
              <table className="w-full bg-white rounded border text-sm">
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    <th className="p-2">Request</th>
                    <th className="p-2">Minutes</th>
                    <th className="p-2">Interventions</th>
                  </tr>
                </thead>
                <tbody>
                  {effort.perRequest.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="p-2">
                        <Link to={`/requests/${r.id}`} className="text-blue-600 hover:underline">
                          {r.title}
                        </Link>
                      </td>
                      <td className="p-2">{r.totalMinutes}</td>
                      <td className="p-2">{r.manualEvents}</td>
                    </tr>
                  ))}
                  {effort.perRequest.length === 0 && (
                    <tr>
                      <td colSpan={3} className="p-4 text-center text-gray-500">
                        No requests yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function MetricCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <div className="bg-white p-4 rounded border">
      <h3 className="text-xs text-gray-500 uppercase tracking-wide">{title}</h3>
      <p className="text-2xl font-bold mt-1">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{detail}</p>
    </div>
  );
}
