import api from "./client";
import type { TimeSlot } from "@/types/models";

export async function fetchTimeSlots(schoolId: number): Promise<TimeSlot[]> {
  const { data } = await api.get<TimeSlot[]>("/timeslots", {
    params: { school_id: schoolId },
  });
  return data;
}

export async function generateTimeSlots(schoolId: number): Promise<TimeSlot[]> {
  const { data } = await api.post<TimeSlot[]>(
    `/timeslots/generate/${schoolId}`,
  );
  return data;
}

export async function updateTimeSlot(
  slotId: number,
  payload: { is_available: boolean },
): Promise<TimeSlot> {
  const { data } = await api.patch<TimeSlot>(`/timeslots/${slotId}`, payload);
  return data;
}

export async function batchUpdateTimeSlots(
  schoolId: number,
  updates: { id: number; is_available: boolean }[],
): Promise<TimeSlot[]> {
  const { data } = await api.patch<TimeSlot[]>(
    `/timeslots/batch/${schoolId}`,
    { updates },
  );
  return data;
}
