import { useQuery } from "@tanstack/react-query";
import { fetchSchools, fetchSchool } from "@/api/schools";
import { useSchoolStore } from "@/stores/schoolStore";

export function useSchools() {
  return useQuery({
    queryKey: ["schools"],
    queryFn: fetchSchools,
  });
}

export function useActiveSchool() {
  const activeSchoolId = useSchoolStore((s) => s.activeSchoolId);
  return useQuery({
    queryKey: ["school", activeSchoolId],
    queryFn: () => fetchSchool(activeSchoolId!),
    enabled: activeSchoolId !== null,
  });
}
