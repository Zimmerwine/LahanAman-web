"use client";

/**
 * app/page.jsx
 * ============================================================================
 * ENTRY POINT UTAMA NEXT.JS (100% PURE JAVASCRIPT / JSX)
 * LahanAman GeoAnalytics DIY
 * ============================================================================
 */

import dynamic from "next/dynamic";

const DashboardPage = dynamic(() => import("../components/DashboardPage"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center bg-slate-100 text-sm font-semibold text-slate-700">
      ⏳ Memuat LahanAman GeoAnalytics DIY...
    </div>
  ),
});

export default function Page() {
  return <DashboardPage />;
}
