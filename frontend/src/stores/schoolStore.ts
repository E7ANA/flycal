import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SchoolState {
  activeSchoolId: number | null;
  setActiveSchoolId: (id: number | null) => void;
}

export const useSchoolStore = create<SchoolState>()(
  persist(
    (set) => ({
      activeSchoolId: null,
      setActiveSchoolId: (id) => set({ activeSchoolId: id }),
    }),
    { name: "school-store" },
  ),
);
