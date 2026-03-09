import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  BookOpen,
  Layers,
  Clock,
  Play,
  Calendar,
  FlaskConical,
  Handshake,
  Table2,
  Sheet,
  Brain,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "לוח בקרה", icon: LayoutDashboard },
  { to: "/classes", label: "כיתות", icon: GraduationCap },
  { to: "/teachers", label: "מורים", icon: Users },
  { to: "/meetings", label: "ישיבות", icon: Handshake },
  { to: "/subjects", label: "מקצועות", icon: BookOpen },
  { to: "/groupings", label: "הקבצות", icon: Layers },
  { to: "/galion", label: "גליון", icon: Table2 },
  { to: "/constraint-sheet", label: "גליון אילוצים", icon: Sheet },
  { to: "/timeslots", label: "שעות פעילות", icon: Clock },
  { to: "/brain", label: "מח ואילוצים כלליים", icon: Brain },
  { to: "/solver", label: "יצירת מערכת", icon: Play },
  { to: "/results", label: "תוצאות", icon: Calendar },
  { to: "/scenarios", label: "תרחישים", icon: FlaskConical },
];

export function Sidebar() {
  return (
    <aside className="w-56 border-s bg-card flex flex-col shrink-0">
      <div className="p-4 border-b">
        <h1 className="text-lg font-bold text-primary">מערכת שעות</h1>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {navItems.map(({ to, label, icon: Icon }) => (
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
