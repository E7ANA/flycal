import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuthStore } from "@/stores/authStore";
import LandingPage from "@/pages/LandingPage";
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import ClassesPage from "@/pages/ClassesPage";
import TeachersPage from "@/pages/TeachersPage";
import GroupingsPage from "@/pages/GroupingsPage";
import SolverPage from "@/pages/SolverPage";
import ResultsPage from "@/pages/ResultsPage";
import MeetingsPage from "@/pages/MeetingsPage";
import ScenariosPage from "@/pages/ScenariosPage";
import TimeSlotsPage from "@/pages/TimeSlotsPage";
import GalionPage from "@/pages/GalionPage";
import ConstraintSheetPage from "@/pages/ConstraintSheetPage";
import BrainPage from "@/pages/BrainPage";
import AdminPage from "@/pages/AdminPage";
import ImportShahafPage from "@/pages/ImportShahafPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (user?.role !== "SUPER_ADMIN") {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="/welcome" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/" element={<DashboardPage />} />
              <Route path="/classes" element={<ClassesPage />} />
              <Route path="/teachers" element={<TeachersPage />} />
              <Route path="/meetings" element={<MeetingsPage />} />
              <Route path="/subjects" element={<GroupingsPage />} />
              <Route path="/groupings" element={<Navigate to="/subjects" replace />} />
              <Route path="/galion" element={<GalionPage />} />
              <Route path="/global-constraints" element={<Navigate to="/brain" replace />} />
              <Route path="/constraint-sheet" element={<ConstraintSheetPage />} />
              <Route path="/timeslots" element={<TimeSlotsPage />} />
              <Route path="/brain" element={<BrainPage />} />
              <Route path="/import-shahaf" element={<ImportShahafPage />} />
              <Route path="/solver" element={<SuperAdminRoute><SolverPage /></SuperAdminRoute>} />
              <Route path="/results" element={<SuperAdminRoute><ResultsPage /></SuperAdminRoute>} />
              <Route path="/scenarios" element={<SuperAdminRoute><ScenariosPage /></SuperAdminRoute>} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster
          position="bottom-left"
          toastOptions={{
            style: { direction: "rtl" },
          }}
        />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
