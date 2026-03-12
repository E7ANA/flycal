import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, School, Users, Shield, ShieldCheck } from "lucide-react";
import toast from "react-hot-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/common/Card";
import { Button } from "@/components/common/Button";
import { Input } from "@/components/common/Input";
import { Label } from "@/components/common/Label";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/common/Dialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Badge } from "@/components/common/Badge";
import { fetchSchools, createSchool, updateSchool, deleteSchool } from "@/api/schools";
import {
  fetchUsers,
  createUser,
  updateUser,
  deleteUser,
  type UserCreatePayload,
} from "@/api/users";
import { useAuthStore, type AuthUser } from "@/stores/authStore";

// ─── Schools Section ───

function SchoolsSection() {
  const qc = useQueryClient();
  const { data: schools } = useQuery({
    queryKey: ["schools"],
    queryFn: fetchSchools,
  });
  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: fetchUsers,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [schoolName, setSchoolName] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editSchool, setEditSchool] = useState<{ id: number; name: string } | null>(null);

  const createMut = useMutation({
    mutationFn: () =>
      createSchool({
        name: schoolName,
        days_per_week: 6,
        periods_per_day: 8,
        period_duration_minutes: 45,
        break_slots: [],
        week_start_day: "SUNDAY",
        periods_per_day_map: null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schools"] });
      toast.success("בית ספר נוצר");
      setDialogOpen(false);
      setSchoolName("");
    },
    onError: () => toast.error("שגיאה ביצירת בית ספר"),
  });

  const renameMut = useMutation({
    mutationFn: () => updateSchool(editSchool!.id, { name: editSchool!.name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schools"] });
      toast.success("שם בית הספר עודכן");
      setEditSchool(null);
    },
    onError: () => toast.error("שגיאה בעדכון שם"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteSchool(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schools"] });
      toast.success("בית ספר נמחק");
    },
    onError: () => toast.error("שגיאה במחיקת בית ספר"),
  });

  const getUsersForSchool = (schoolId: number) =>
    users?.filter((u) => u.school_id === schoolId) ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <School className="h-5 w-5" />
            בתי ספר
          </CardTitle>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            בית ספר חדש
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!schools?.length ? (
          <p className="text-sm text-muted-foreground">אין בתי ספר עדיין</p>
        ) : (
          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-muted-foreground">
                  <th className="px-3 py-2 text-start font-medium">שם</th>
                  <th className="px-3 py-2 text-start font-medium">משתמשים</th>
                  <th className="px-3 py-2 text-start font-medium">ימים</th>
                  <th className="px-3 py-2 text-start font-medium">שיעורים/יום</th>
                  <th className="px-3 py-2 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {schools.map((s) => (
                  <tr key={s.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{s.name}</td>
                    <td className="px-3 py-2">
                      {getUsersForSchool(s.id).map((u) => (
                        <Badge key={u.id} variant="outline" className="ml-1">
                          {u.name}
                        </Badge>
                      ))}
                      {getUsersForSchool(s.id).length === 0 && (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{s.days_per_week}</td>
                    <td className="px-3 py-2">{s.periods_per_day}</td>
                    <td className="px-3 py-2 flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditSchool({ id: s.id, name: s.name })}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteId(s.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <DialogHeader>
          <DialogTitle>בית ספר חדש</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMut.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="new-school-name">שם</Label>
            <Input
              id="new-school-name"
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              placeholder="לדוגמה: אולפנת תאיר"
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? "יוצר..." : "צור"}
            </Button>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              ביטול
            </Button>
          </DialogFooter>
        </form>
      </Dialog>

      <Dialog
        open={editSchool !== null}
        onClose={() => setEditSchool(null)}
      >
        <DialogHeader>
          <DialogTitle>עריכת שם בית ספר</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            renameMut.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="edit-school-name">שם</Label>
            <Input
              id="edit-school-name"
              value={editSchool?.name ?? ""}
              onChange={(e) =>
                setEditSchool((prev) =>
                  prev ? { ...prev, name: e.target.value } : null,
                )
              }
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={renameMut.isPending}>
              {renameMut.isPending ? "שומר..." : "שמור"}
            </Button>
            <Button variant="outline" onClick={() => setEditSchool(null)}>
              ביטול
            </Button>
          </DialogFooter>
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleteId !== null}
        title="מחיקת בית ספר"
        message="האם למחוק את בית הספר? כל הנתונים ימחקו."
        onConfirm={() => {
          if (deleteId) deleteMut.mutate(deleteId);
          setDeleteId(null);
        }}
        onCancel={() => setDeleteId(null)}
      />
    </Card>
  );
}

// ─── Users Section ───

function UsersSection() {
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: fetchUsers,
  });
  const { data: schools } = useQuery({
    queryKey: ["schools"],
    queryFn: fetchSchools,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editUser, setEditUser] = useState<AuthUser | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  // Form state
  const [form, setForm] = useState<UserCreatePayload>({
    email: "",
    password: "",
    name: "",
    role: "SCHOOL_ADMIN",
    school_id: null,
  });

  const resetForm = () =>
    setForm({ email: "", password: "", name: "", role: "SCHOOL_ADMIN", school_id: null });

  const createMut = useMutation({
    mutationFn: () => createUser(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success("משתמש נוצר");
      setDialogOpen(false);
      resetForm();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail ?? "שגיאה ביצירת משתמש";
      toast.error(msg);
    },
  });

  const updateMut = useMutation({
    mutationFn: () =>
      updateUser(editUser!.id, {
        name: form.name,
        email: form.email,
        role: form.role,
        school_id: form.school_id,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success("משתמש עודכן");
      setEditUser(null);
      resetForm();
    },
    onError: () => toast.error("שגיאה בעדכון משתמש"),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      updateUser(id, { is_active }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteUser(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success("משתמש נמחק");
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail ?? "שגיאה במחיקת משתמש";
      toast.error(msg);
    },
  });

  const openEdit = (u: AuthUser) => {
    setEditUser(u);
    setForm({
      email: u.email,
      password: "",
      name: u.name,
      role: u.role,
      school_id: u.school_id,
    });
  };

  const schoolName = (id: number | null) =>
    schools?.find((s) => s.id === id)?.name ?? "—";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            משתמשים
          </CardTitle>
          <Button
            size="sm"
            onClick={() => {
              resetForm();
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            משתמש חדש
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!users?.length ? (
          <p className="text-sm text-muted-foreground">אין משתמשים</p>
        ) : (
          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-muted-foreground">
                  <th className="px-3 py-2 text-start font-medium">שם</th>
                  <th className="px-3 py-2 text-start font-medium">אימייל</th>
                  <th className="px-3 py-2 text-start font-medium">תפקיד</th>
                  <th className="px-3 py-2 text-start font-medium">בית ספר</th>
                  <th className="px-3 py-2 text-start font-medium">סטטוס</th>
                  <th className="px-3 py-2 w-24"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{u.name}</td>
                    <td className="px-3 py-2 text-muted-foreground" dir="ltr">
                      {u.email}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        variant={u.role === "SUPER_ADMIN" ? "default" : "outline"}
                      >
                        {u.role === "SUPER_ADMIN" ? (
                          <span className="flex items-center gap-1">
                            <ShieldCheck className="h-3 w-3" />
                            מנהל ראשי
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <Shield className="h-3 w-3" />
                            מנהל בית ספר
                          </span>
                        )}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">{schoolName(u.school_id)}</td>
                    <td className="px-3 py-2">
                      <button
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          u.is_active
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                        }`}
                        onClick={() =>
                          toggleMut.mutate({
                            id: u.id,
                            is_active: !u.is_active,
                          })
                        }
                        disabled={u.id === currentUser?.id}
                      >
                        {u.is_active ? "פעיל" : "מושבת"}
                      </button>
                    </td>
                    <td className="px-3 py-2 flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(u)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {u.id !== currentUser?.id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteId(u.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {/* Create / Edit Dialog */}
      <Dialog
        open={dialogOpen || editUser !== null}
        onClose={() => {
          setDialogOpen(false);
          setEditUser(null);
          resetForm();
        }}
      >
        <DialogHeader>
          <DialogTitle>{editUser ? "עריכת משתמש" : "משתמש חדש"}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            editUser ? updateMut.mutate() : createMut.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="user-name">שם</Label>
            <Input
              id="user-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div>
            <Label htmlFor="user-email">אימייל</Label>
            <Input
              id="user-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              dir="ltr"
            />
          </div>
          {!editUser && (
            <div>
              <Label htmlFor="user-password">סיסמה</Label>
              <Input
                id="user-password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                dir="ltr"
              />
            </div>
          )}
          <div>
            <Label htmlFor="user-role">תפקיד</Label>
            <select
              id="user-role"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              <option value="SCHOOL_ADMIN">מנהל בית ספר</option>
              <option value="SUPER_ADMIN">מנהל ראשי</option>
            </select>
          </div>
          {form.role === "SCHOOL_ADMIN" && (
            <div>
              <Label htmlFor="user-school">בית ספר</Label>
              <select
                id="user-school"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={form.school_id ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    school_id: e.target.value ? Number(e.target.value) : null,
                  })
                }
              >
                <option value="">בחר בית ספר</option>
                {schools?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <DialogFooter>
            <Button
              type="submit"
              disabled={createMut.isPending || updateMut.isPending}
            >
              {editUser ? "שמור" : "צור"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDialogOpen(false);
                setEditUser(null);
                resetForm();
              }}
            >
              ביטול
            </Button>
          </DialogFooter>
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleteId !== null}
        title="מחיקת משתמש"
        message="האם למחוק את המשתמש?"
        onConfirm={() => {
          if (deleteId) deleteMut.mutate(deleteId);
          setDeleteId(null);
        }}
        onCancel={() => setDeleteId(null)}
      />
    </Card>
  );
}

// ─── Admin Page ───

export default function AdminPage() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold flex items-center gap-2">
        <ShieldCheck className="h-6 w-6" />
        ניהול מערכת
      </h2>
      <SchoolsSection />
      <UsersSection />
    </div>
  );
}
