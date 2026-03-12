import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  BookOpen,
  Clock,
  Play,
  Calendar,
  FlaskConical,
  Handshake,
  Table2,
  Sheet,
  Brain,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";

const navItems = [
  { to: "/", label: "לוח בקרה", icon: LayoutDashboard },
  { to: "/classes", label: "כיתות", icon: GraduationCap },
  { to: "/teachers", label: "מורים", icon: Users },
  { to: "/meetings", label: "ישיבות", icon: Handshake },
  { to: "/subjects", label: "מקצועות", icon: BookOpen },
  { to: "/galion", label: "גליון", icon: Table2 },
  { to: "/constraint-sheet", label: "גליון אילוצים", icon: Sheet },
  { to: "/timeslots", label: "שעות פעילות", icon: Clock },
  { to: "/brain", label: "מח ואילוצים כלליים", icon: Brain },
  { to: "/solver", label: "יצירת מערכת", icon: Play },
  { to: "/results", label: "תוצאות", icon: Calendar },
  { to: "/scenarios", label: "תרחישים", icon: FlaskConical },
];

export function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const isSchoolAdmin = user?.role === "SCHOOL_ADMIN";

  const filteredNavItems = isSchoolAdmin
    ? navItems.filter(({ to }) => to !== "/solver" && to !== "/scenarios" && to !== "/results")
    : navItems;

  return (
    <aside className="w-56 border-s bg-card flex flex-col shrink-0">
      <div className="p-4 border-b flex items-center gap-2.5">
        <img src="/flycal.svg" alt="flycal" className="h-4 w-4" />
        <h1 className="text-lg font-bold text-primary tracking-wide">flycal</h1>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {isSuperAdmin && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )
            }
          >
            <ShieldCheck className="h-4 w-4" />
            ניהול מערכת
          </NavLink>
        )}
        {isSuperAdmin && (
          <div className="border-b my-1" />
        )}
        {filteredNavItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
