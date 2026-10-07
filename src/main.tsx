import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";

// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing.tsx"));
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const Tasks = lazy(() => import("./pages/Tasks.tsx"));
const Entries = lazy(() => import("./pages/Entries.tsx"));
const Invoices = lazy(() => import("./pages/Invoices.tsx"));
const EntryDetail = lazy(() => import("./pages/EntryDetail.tsx"));
const Students = lazy(() => import("./pages/Students.tsx"));
const Providers = lazy(() => import("./pages/Providers.tsx"));
const StudentDetail = lazy(() => import("./pages/StudentDetail.tsx"));
const Approvals = lazy(() => import("./pages/Approvals.tsx"));
const Sheets = lazy(() => import("./pages/Sheets.tsx"));
const Docs = lazy(() => import("./pages/Docs.tsx"));
const Assistant = lazy(() => import("./pages/Assistant.tsx"));
const Admin = lazy(() => import("./pages/Admin.tsx"));
const ImportStudents = lazy(() => import("./pages/ImportStudents.tsx"));
const Calendar = lazy(() => import("./pages/Calendar.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

// Simple loading fallback for route transitions
function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

/** New pages open at the top instead of keeping the previous page's scroll. */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in the browser runtime). */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[Preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Preview runtime error</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            {this.state.stack && (
              <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
                {this.state.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

// Installable Android app (PWA): register the offline shell. The service
// worker only exists in production builds; dev serves no /sw.js.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("[PWA] Service worker registration failed:", error);
    });
  });
}



function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}


createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <ScrollToTop />
          <RouteSyncer />
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route
                path="/auth"
                element={<AuthPage redirectAfterAuth="/dashboard" />}
              />
              <Route
                path="/dashboard"
                element={
                  <RequireAuth>
                    <Tasks />
                  </RequireAuth>
                }
              />
              <Route
                path="/entries"
                element={
                  <RequireAuth>
                    <Entries />
                  </RequireAuth>
                }
              />
              <Route
                path="/invoices"
                element={
                  <RequireAuth>
                    <Invoices />
                  </RequireAuth>
                }
              />
              <Route
                path="/entries/:entryId"
                element={
                  <RequireAuth>
                    <EntryDetail />
                  </RequireAuth>
                }
              />
              <Route
                path="/students"
                element={
                  <RequireAuth>
                    <Students />
                  </RequireAuth>
                }
              />
              <Route
                path="/providers"
                element={
                  <RequireAuth>
                    <Providers />
                  </RequireAuth>
                }
              />
              <Route
                path="/students/:studentId"
                element={
                  <RequireAuth>
                    <StudentDetail />
                  </RequireAuth>
                }
              />
              <Route
                path="/approvals"
                element={
                  <RequireAuth>
                    <Approvals />
                  </RequireAuth>
                }
              />
              <Route
                path="/sheets"
                element={
                  <RequireAuth>
                    <Sheets />
                  </RequireAuth>
                }
              />
              <Route
                path="/docs"
                element={
                  <RequireAuth
                    title="Sign in to view the docs"
                    description="School-year Google Docs are for signed-in team members."
                  >
                    <Docs />
                  </RequireAuth>
                }
              />
              <Route
                path="/import"
                element={
                  <RequireAuth>
                    <ImportStudents />
                  </RequireAuth>
                }
              />
              <Route
                path="/calendar"
                element={
                  <RequireAuth>
                    <Calendar />
                  </RequireAuth>
                }
              />
              <Route
                path="/assistant"
                element={
                  <RequireAuth>
                    <Assistant />
                  </RequireAuth>
                }
              />
              <Route
                path="/admin"
                element={
                  <RequireAuth>
                    <Admin />
                  </RequireAuth>
                }
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster />
      </ConvexAuthProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
