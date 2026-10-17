import { describe, expect, it } from "vitest";
import { enforce, runAssistant } from "@/assistant/assistant.server";

const ids = new Set(["KB-101"]);
const base = { explanation: "x", uncertainty: "y" };

describe("assistant enforcement", () => {
  it("drops non-allowlisted commands and reports them as blocked", () => {
    const r = enforce({ ...base, proposed_commands: [{ command: "PURGE $SYSTEM.*", reason: "", sources: [], confidence: 0.9 }] }, ids);
    expect(r.proposed_commands).toHaveLength(0);
    expect(r.blocked[0]?.command).toBe("PURGE $SYSTEM.*");
  });
  it("attaches risk tier from the lookup table", () => {
    const r = enforce({ ...base, proposed_commands: [{ command: "abort process $zzkrn.#rptgen", reason: "", sources: [], confidence: 0.5 }] }, ids);
    expect(r.proposed_commands[0]?.risk).toBe("high-risk");
  });
  it("marks illustrative commands as simulated and confirmed ones as documented", () => {
    const r = enforce({ ...base, proposed_commands: [
      { command: "RESTORE CPU 3", reason: "", sources: [], confidence: 0.5 },
      { command: "STATUS PROCESS $ZZKRN.#*", reason: "", sources: [], confidence: 0.5 },
    ] }, ids);
    expect(r.proposed_commands[0]?.simulated).toBe(true);
    expect(r.proposed_commands[1]?.simulated).toBe(false);
  });
  it("removes unknown source IDs and flags them", () => {
    const r = enforce({ ...base, proposed_commands: [{ command: "TMFCOM STATUS TMF", reason: "", sources: ["KB-101", "KB-999"], confidence: 1 }] }, ids);
    expect(r.proposed_commands[0]?.sources).toEqual(["KB-101"]);
    expect(r.proposed_commands[0]?.unknown_sources).toEqual(["KB-999"]);
  });
  it("retries once on invalid JSON then returns a safe error", async () => {
    let calls = 0;
    const r = await runAssistant("q", {}, [], ids, async () => { calls++; return "not json"; });
    expect(calls).toBe(2);
    expect(r.ok).toBe(false);
  });
  it("succeeds on retry when second response is valid", async () => {
    let calls = 0;
    const r = await runAssistant("q", {}, [], ids, async () =>
      ++calls === 1 ? "{bad" : JSON.stringify({ ...base, proposed_commands: [] }));
    expect(r.ok).toBe(true);
  });
});

import { rankNotes } from "@/knowledge/notes.server";
describe("knowledge retrieval", () => {
  const notes = [
    { id: "KN-001", title: "CPU down", body: "failover load", source_type: "hpe-doc", contributed_by: "x" },
    { id: "KN-009", title: "Debrief: payment latency", body: "check TMF before restart", source_type: "expert-note", contributed_by: "op" },
  ];
  it("ranks the matching note first by keyword", () =>
    expect(rankNotes(notes, "payment latency restart")[0]?.id).toBe("KN-009"));
});
