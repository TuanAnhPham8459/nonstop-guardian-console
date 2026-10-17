import { describe, expect, it } from "vitest";
import { enforce, runAssistant } from "@/assistant/assistant.server";

const base = { explanation: "x", uncertainty: "y" };

describe("assistant enforcement", () => {
  it("drops non-allowlisted commands and reports them as blocked", () => {
    const r = enforce({ ...base, proposed_commands: [{ command: "PURGE $SYSTEM.*", reason: "", sources: [], confidence: 0.9 }] });
    expect(r.proposed_commands).toHaveLength(0);
    expect(r.blocked[0]?.command).toBe("PURGE $SYSTEM.*");
  });
  it("attaches risk tier from the lookup table", () => {
    const r = enforce({ ...base, proposed_commands: [{ command: "scf restart process $payauth", reason: "", sources: [], confidence: 0.5 }] });
    expect(r.proposed_commands[0]?.risk).toBe("high-risk");
  });
  it("removes unknown source IDs and flags them", () => {
    const r = enforce({ ...base, proposed_commands: [{ command: "SCF STATUS CPU *", reason: "", sources: ["KB-101", "KB-999"], confidence: 1 }] });
    expect(r.proposed_commands[0]?.sources).toEqual(["KB-101"]);
    expect(r.proposed_commands[0]?.unknown_sources).toEqual(["KB-999"]);
  });
  it("retries once on invalid JSON then returns a safe error", async () => {
    let calls = 0;
    const r = await runAssistant("q", {}, [], async () => { calls++; return "not json"; });
    expect(calls).toBe(2);
    expect(r.ok).toBe(false);
  });
  it("succeeds on retry when second response is valid", async () => {
    let calls = 0;
    const r = await runAssistant("q", {}, [], async () =>
      ++calls === 1 ? "{bad" : JSON.stringify({ ...base, proposed_commands: [] }));
    expect(r.ok).toBe(true);
  });
});
