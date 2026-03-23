import api from "./client";
import type { ClusterType, PinnedSlot, Track } from "@/types/models";
import type { SlotStatus } from "@/api/subjects";

export interface TrackSummary {
  id: number;
  name: string;
  teacher_id: number | null;
  hours_per_week: number;
}

export interface ClusterResponse {
  id: number;
  school_id: number;
  name: string;
  subject_id: number;
  grade_id: number | null;
  source_class_ids: number[];
  cluster_type: ClusterType;
  tracks: TrackSummary[];
}

// ─── Clusters ────────────────────────────────────────────

export async function fetchGroupingClusters(
  schoolId: number,
  clusterType?: ClusterType,
): Promise<ClusterResponse[]> {
  const params: Record<string, unknown> = { school_id: schoolId };
  if (clusterType) params.cluster_type = clusterType;
  const { data } = await api.get<ClusterResponse[]>("/grouping-clusters", {
    params,
  });
  return data;
}

export async function createGroupingCluster(payload: {
  school_id: number;
  name: string;
  subject_id: number;
  grade_id?: number;
  source_class_ids?: number[];
  cluster_type?: ClusterType;
  teacher_id?: number | null;
  hours_per_week?: number | null;
}): Promise<ClusterResponse> {
  const { data } = await api.post<ClusterResponse>(
    "/grouping-clusters",
    payload,
  );
  return data;
}

export async function updateGroupingCluster(
  id: number,
  payload: Partial<{
    name: string;
    subject_id: number;
    grade_id: number;
    source_class_ids: number[];
    cluster_type: ClusterType;
    teacher_id: number | null;
    hours_per_week: number | null;
    consecutive_count: number | null;
    consecutive_mode: string | null;
  }>,
): Promise<ClusterResponse> {
  const { data } = await api.put<ClusterResponse>(
    `/grouping-clusters/${id}`,
    payload,
  );
  return data;
}

export async function deleteGroupingCluster(id: number): Promise<void> {
  await api.delete(`/grouping-clusters/${id}`);
}

// ─── Tracks ──────────────────────────────────────────────

export async function fetchTracks(clusterId?: number): Promise<Track[]> {
  const { data } = await api.get<Track[]>("/tracks", {
    params: clusterId != null ? { cluster_id: clusterId } : {},
  });
  return data;
}

export async function createTrack(payload: {
  name: string;
  cluster_id: number;
  teacher_id: number | null;
  hours_per_week: number;
}): Promise<Track> {
  const { data } = await api.post<Track>("/tracks", payload);
  return data;
}

export async function updateTrack(
  id: number,
  payload: Partial<{
    name: string;
    teacher_id: number | null;
    hours_per_week: number;
    link_group: number | null;
    source_class_id: number | null;
    pinned_slots: PinnedSlot[] | null;
    blocked_slots: PinnedSlot[] | null;
    allow_overlap: boolean;
  }>,
): Promise<Track> {
  const { data } = await api.put<Track>(`/tracks/${id}`, payload);
  return data;
}

export async function fetchTrackAvailableSlots(
  trackId: number,
): Promise<SlotStatus[]> {
  const { data } = await api.get<SlotStatus[]>(
    `/tracks/${trackId}/available-slots`,
  );
  return data;
}

export async function deleteTrack(id: number): Promise<void> {
  await api.delete(`/tracks/${id}`);
}

export async function createTrackFromRequirement(payload: {
  cluster_id: number;
  requirement_id: number;
}): Promise<Track> {
  const { data } = await api.post<Track>("/tracks/from-requirement", payload);
  return data;
}

export async function convertTrackToRequirement(
  trackId: number,
  classGroupId?: number,
): Promise<{ detail: string; requirement_id: number | null }> {
  const { data } = await api.post<{ detail: string; requirement_id: number | null }>(
    `/tracks/${trackId}/to-requirement`,
    { class_group_id: classGroupId ?? null },
  );
  return data;
}
