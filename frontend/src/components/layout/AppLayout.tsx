import { useEffect } from "react";
import { Outlet, useSearchParams } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { useAuthStore } from "@/stores/authStore";
import { useSchoolStore } from "@/stores/schoolStore";

export function AppLayout() {
  const user = useAuthStore((s) => s.user);
  const setActiveSchoolId = useSchoolStore((s) => s.setActiveSchoolId);
  const [searchParams] = useSearchParams();

  // Set school from URL ?sid=X or from user's assigned school
  useEffect(() => {
    const sid = searchParams.get("sid");
    if (sid) {
      setActiveSchoolId(Number(sid));
    } else if (user?.role === "SCHOOL_ADMIN" && user.school_id) {
      setActiveSchoolId(user.school_id);
    }
  }, [searchParams, user, setActiveSchoolId]);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
