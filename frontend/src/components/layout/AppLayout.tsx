import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { useAuthStore } from "@/stores/authStore";
import { useSchoolStore } from "@/stores/schoolStore";

export function AppLayout() {
  const user = useAuthStore((s) => s.user);
  const setActiveSchoolId = useSchoolStore((s) => s.setActiveSchoolId);

  // SCHOOL_ADMIN: auto-select their school
  useEffect(() => {
    if (user?.role === "SCHOOL_ADMIN" && user.school_id) {
      setActiveSchoolId(user.school_id);
    }
  }, [user, setActiveSchoolId]);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
