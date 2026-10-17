import type { SystemState } from "@/adapters/types";
export function isCurrentSnapshot(previous: SystemState, next: SystemState) {
  // Revision belongs to the browser session row, not the resettable incident.
  return (next.revision ?? 0) >= (previous.revision ?? 0);
}