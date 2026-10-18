import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import "./index.css";
import Providers from "./pages/Providers";
import ProviderDetail from "./pages/ProviderDetail";
import Requests from "./pages/Requests";
import RequestDetail from "./pages/RequestDetail";
import Dashboard from "./pages/Dashboard";

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-6">
        <span className="font-bold text-gray-900">Concierge Cockpit</span>
        <NavLink
          to="/providers"
          className={({ isActive }) =>
            `text-sm ${isActive ? "text-blue-600 font-semibold" : "text-gray-600 hover:text-gray-900"}`
          }
        >
          Providers
        </NavLink>
        <NavLink
          to="/requests"
          className={({ isActive }) =>
            `text-sm ${isActive ? "text-blue-600 font-semibold" : "text-gray-600 hover:text-gray-900"}`
          }
        >
          Requests
        </NavLink>
        <NavLink
          to="/dashboard"
          className={({ isActive }) =>
            `text-sm ${isActive ? "text-blue-600 font-semibold" : "text-gray-600 hover:text-gray-900"}`
          }
        >
          Dashboard
        </NavLink>
      </nav>
      <main className="max-w-6xl mx-auto p-6">{children}</main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Providers />} />
          <Route path="/providers" element={<Providers />} />
          <Route path="/providers/:id" element={<ProviderDetail />} />
          <Route path="/requests" element={<Requests />} />
          <Route path="/requests/:id" element={<RequestDetail />} />
          <Route path="/dashboard" element={<Dashboard />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
