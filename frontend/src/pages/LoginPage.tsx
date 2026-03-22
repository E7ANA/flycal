import { useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { login } from "@/api/auth";
import { useAuthStore } from "@/stores/authStore";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await login(email, password);
      setAuth(res.access_token, res.user);
      toast.success(`שלום ${res.user.name}`);
      navigate("/", { replace: true });
    } catch {
      toast.error("אימייל או סיסמה שגויים");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm bg-card rounded-xl shadow-sm border p-8">
        <div className="flex items-center justify-center gap-3 mb-2">
          <img src="/logiclass.svg" alt="logiclass" className="h-7 w-7" />
          <h1 className="text-3xl font-semibold text-foreground tracking-tight">logiclass</h1>
        </div>
        <p className="text-muted-foreground text-center text-sm mb-6">
          התחברות למערכת
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium mb-1"
            >
              אימייל
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="email@example.com"
              required
              autoFocus
              dir="ltr"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium mb-1"
            >
              סיסמה
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="********"
              required
              dir="ltr"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? "מתחבר..." : "התחבר"}
          </button>
        </form>
      </div>
    </div>
  );
}
