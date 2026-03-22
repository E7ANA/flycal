import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
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
  Upload,
  LogOut,
  ChevronLeft,
  ChevronRight,
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
  { to: "/import-shahaf", label: "ייבוא משחף", icon: Upload },
];

export function Sidebar() {
  const [expanded, setExpanded] = useState(false);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const isSchoolAdmin = user?.role === "SCHOOL_ADMIN";

  const filteredNavItems = isSchoolAdmin
    ? navItems.filter(({ to }) => to !== "/solver" && to !== "/scenarios" && to !== "/results")
    : navItems;

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <aside
      className={cn(
        "border-s bg-sidebar flex flex-col shrink-0 transition-all duration-200",
        expanded ? "w-56" : "w-14",
      )}
    >
      {/* Logo + toggle */}
      <div className="border-b flex items-center min-h-[4rem] p-3">
        {expanded ? (
          <div className="flex items-center justify-between w-full">
            <img
              src="/logiclass-full.png"
              alt="logiclass"
              className="h-14 object-contain"
            />
            <button
              onClick={() => setExpanded(false)}
              className="p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
              title="כווץ תפריט"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setExpanded(true)}
            className="w-full flex items-center justify-center rounded-md hover:bg-accent transition-colors cursor-pointer"
            title="הרחב תפריט"
          >
            <img
              src="/logiclass.svg"
              alt="logiclass"
              className="h-6 w-6"
            />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-1.5 space-y-1 overflow-y-auto">
        {isSuperAdmin && (
          <>
            <NavLink
              to="/admin"
              title="ניהול מערכת"
              className={({ isActive }) =>
                cn(
                  "flex items-center rounded-md transition-colors",
                  expanded ? "gap-3 px-3 py-2 text-sm font-medium" : "justify-center p-2",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )
              }
            >
              <ShieldCheck className="h-4 w-4 shrink-0" />
              {expanded && "ניהול מערכת"}
            </NavLink>
            <div className="border-b my-1" />
          </>
        )}
        {filteredNavItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            title={label}
            className={({ isActive }) =>
              cn(
                "flex items-center rounded-md transition-colors",
                expanded ? "gap-3 px-3 py-2 text-sm font-medium" : "justify-center p-2",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {expanded && label}
          </NavLink>
        ))}
      </nav>

      {/* Bottom: user info */}
      <div className="border-t p-2">
        <div
          className={cn(
            "flex items-center",
            expanded ? "gap-3 px-1" : "justify-center",
          )}
        >
          {expanded ? (
            <>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user?.name}</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              </div>
              <button
                onClick={handleLogout}
                className="p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
                title="התנתק"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </>
          ) : (
            <button
              onClick={handleLogout}
              className="p-2 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
              title="התנתק"
            >
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
