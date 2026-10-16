import type { Photo } from "./types.ts";
import { groupName } from "./reports.ts";
// All entry points edit the same report title; identity, ordering and crop stay untouched.
export function setReportName(
  photos: Photo[],
  reportId: string,
  value: string,
) {
  const members = photos.filter(
    (p) => (p.reportId || "unassigned") === reportId,
  );
  const title =
    value.trim().slice(0, 100) ||
    members.find((p) => p.reportTitle)?.reportTitle ||
    groupName(members);
  for (const p of members) p.reportTitle = title;
  return title;
}
export function suggestReportNameForGroup(photos: Photo[], reportId: string) {
  return setReportName(
    photos,
    reportId,
    groupName(
      photos.filter(
        (p) => (p.reportId || "unassigned") === reportId && !p.excluded,
      ),
    ),
  );
}
