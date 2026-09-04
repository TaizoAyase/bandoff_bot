import type { Actor } from "../domain/permissions";
import type { Viewer } from "../env";

/** cookie から解決した viewer から、permissions.ts が扱う Actor を組み立てる。 */
export function actorFromViewer(viewer: Viewer): Actor {
  return {
    participantId: viewer.participant?.id ?? null,
    isOrganizer: viewer.isOrganizer,
  };
}
