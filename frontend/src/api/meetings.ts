import api from "./client";
import type { Meeting } from "@/types/models";
import type { SlotStatus } from "@/api/subjects";

export async function fetchMeetings(schoolId: number): Promise<Meeting[]> {
  const { data } = await api.get<Meeting[]>("/meetings", {
    params: { school_id: schoolId },
  });
  return data;
}

export async function createMeeting(
  payload: Omit<Meeting, "id">,
): Promise<Meeting> {
  const { data } = await api.post<Meeting>("/meetings", payload);
  return data;
}

export async function updateMeeting(
  id: number,
  payload: Partial<Meeting>,
): Promise<Meeting> {
  const { data } = await api.put<Meeting>(`/meetings/${id}`, payload);
  return data;
}

export async function deleteMeeting(id: number): Promise<void> {
  await api.delete(`/meetings/${id}`);
}

export async function refreshMeetingTeachers(id: number): Promise<Meeting> {
  const { data } = await api.post<Meeting>(`/meetings/${id}/refresh-teachers`);
  return data;
}

export async function fetchMeetingAvailableSlots(
  meetingId: number,
): Promise<SlotStatus[]> {
  const { data } = await api.get<SlotStatus[]>(
    `/meetings/${meetingId}/available-slots`,
  );
  return data;
}
