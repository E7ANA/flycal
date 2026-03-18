import type { SubjectRequirement } from "@/types/models";
import type { ClusterResponse } from "@/api/groupings";

export interface ClassHoursSummary {
  regular: number;
  grouped: number;
  shared: number;
  total: number;
}

/**
 * Compute per-class hours correctly.
 *
 * For clusters, use the TRACK hours (not requirement hours, which may be
 * out of sync). Each cluster contributes max(track.hours_per_week) to every
 * source class, since all tracks are scheduled simultaneously.
 */
export function computeAllClassHours(
  requirements: SubjectRequirement[],
  clusters: ClusterResponse[],
): Record<number, ClassHoursSummary> {
  const summary: Record<number, ClassHoursSummary> = {};

  // Build set of cluster subject_ids per class to avoid double-counting
  const clusterSubjectsPerClass: Record<number, Set<number>> = {};
  for (const c of clusters) {
    for (const classId of c.source_class_ids) {
      if (!clusterSubjectsPerClass[classId]) clusterSubjectsPerClass[classId] = new Set();
      clusterSubjectsPerClass[classId].add(c.subject_id);
    }
  }

  // Regular (non-grouped) requirements
  for (const req of requirements) {
    if (req.is_grouped) continue;
    const cid = req.class_group_id;
    if (!summary[cid]) summary[cid] = { regular: 0, grouped: 0, shared: 0, total: 0 };
    summary[cid].regular += req.hours_per_week;
  }

  // Cluster hours — use tracks directly, not requirements
  for (const cluster of clusters) {
    const maxHours = cluster.tracks.length > 0
      ? Math.max(...cluster.tracks.filter((t) => t.teacher_id != null).map((t) => t.hours_per_week))
      : 0;
    if (maxHours === 0) continue;

    for (const classId of cluster.source_class_ids) {
      if (!summary[classId]) summary[classId] = { regular: 0, grouped: 0, shared: 0, total: 0 };
      if (cluster.cluster_type === "SHARED_LESSON") {
        summary[classId].shared += maxHours;
      } else {
        summary[classId].grouped += maxHours;
      }
    }
  }

  // Compute totals
  for (const s of Object.values(summary)) {
    s.total = s.regular + s.grouped + s.shared;
  }

  return summary;
}
