import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { Intro } from "../components/ui/Intro";
import { ToastProvider } from "../components/ui/Toast";
import { Skeleton } from "../components/ui/primitives";
import { DataProvider } from "../hooks/useData";

const Overview = lazy(() => import("../pages/Overview"));
const Theatre = lazy(() => import("../pages/Theatre"));
const Missions = lazy(() => import("../pages/Missions"));
const Timeline = lazy(() => import("../pages/Timeline"));
const Retasking = lazy(() => import("../pages/Retasking"));
const Fusion = lazy(() => import("../pages/Fusion"));
const Benchmarks = lazy(() => import("../pages/Benchmarks"));
const Settings = lazy(() => import("../pages/Settings"));
const Diagnostics = lazy(() => import("../pages/Diagnostics"));

export default function App() {
  return (
    <ToastProvider>
      <DataProvider>
        <BrowserRouter>
          <Intro />
          <Suspense fallback={<div className="p-4"><Skeleton className="h-40" /></div>}>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<Overview />} />
                <Route path="theatre" element={<Theatre />} />
                <Route path="missions" element={<Missions />} />
                <Route path="timeline" element={<Timeline />} />
                <Route path="retasking" element={<Retasking />} />
                <Route path="fusion" element={<Fusion />} />
                <Route path="benchmarks" element={<Benchmarks />} />
                <Route path="settings" element={<Settings />} />
                <Route path="diagnostics" element={<Diagnostics />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </DataProvider>
    </ToastProvider>
  );
}
