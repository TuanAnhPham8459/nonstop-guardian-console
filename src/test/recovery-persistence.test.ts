import { describe, expect, it, vi } from "vitest";
import { createEngine } from "@/mock-env/engine.server";
import { readConversations, saveConversation, reconcileMessages, type Conversation } from "@/lib/conversation-store";
import { createPipeline } from "@/core/pipeline";
import { isCurrentSnapshot } from "@/lib/simulation-version";

describe("incident recovery", () => {
  it("stale polling cannot overwrite a newer command or reset result", () => {
    const s = createEngine().getState();
    expect(isCurrentSnapshot({ ...s, revision: 12 }, { ...s, revision: 11 })).toBe(false);
    expect(isCurrentSnapshot({ ...s, sessionId: "new-incident", revision: 12 }, { ...s, sessionId: "old-incident", revision: 11 })).toBe(false);
    expect(isCurrentSnapshot({ ...s, revision: 12 }, { ...s, revision: 13 })).toBe(true);
  });
  it("C6 heals CPUs 4–6 once, keeps CPU 3 offline and redundancy reduced", () => {
    const e = createEngine();
    e.runCommand("STATUS PROCESS $ZZKRN.#*");
    expect(e.runCommand("ABORT PROCESS $ZZKRN.#RPTGEN").exitCode).toBe(0);
    expect(e.getState().cpus.slice(4, 7).map(c => c.status)).toEqual(["ok", "ok", "ok"]);
    expect(e.getState().cpus[3]?.status).toBe("down");
    expect(e.getState().redundancy).toBe("REDUCED");
    expect(e.getState().responseMs).toBe(280);
    expect(e.getState().queueDepth).toBe(500);
    expect(e.getState().tps).toBe(1420);
    const before = e.getState();
    expect(e.runCommand("ABORT PROCESS $ZZKRN.#RPTGEN").exitCode).toBe(1);
    expect(e.getState()).toEqual(before);
  });
  it("maintenance runs 45 minutes after ticket creation, exactly once", () => {
    const e = createEngine();
    e.advanceTime(30);
    e.runCommand("OPEN HARDWARE TICKET + NOTIFY ON-CALL");
    e.advanceTime(15);
    expect(e.getState().maintenance?.elapsedMinutes).toBe(15);
    expect(e.getState().cpus[3]?.status).toBe("down");
    // Reopening the ticket must not postpone the timer.
    e.runCommand("OPEN HARDWARE TICKET + NOTIFY ON-CALL");
    e.advanceTime(15);
    expect(e.getState().cpus[3]?.status).toBe("down");
    expect(e.getState().maintenance?.elapsedMinutes).toBe(30);
    e.advanceTime(15);
    expect(e.getState().cpus[3]?.status).toBe("ok");
    expect(e.getState().maintenance?.status).toBe("COMPLETED");
    expect(e.events).toHaveLength(2);
    expect(e.advanceTime(15).messages).toEqual([]);
    expect(e.events).toHaveLength(2);
    expect(e.runCommand("RESTORE CPU 3").output.join(" ")).toContain("already online");
  });
  it("combined recovery is healthy and survives serialized worker replacement", () => {
    const e = createEngine();
    e.runCommand("STATUS PROCESS $ZZKRN.#*"); e.runCommand("ABORT PROCESS $ZZKRN.#RPTGEN");
    e.runCommand("OPEN HARDWARE TICKET + NOTIFY ON-CALL"); e.advanceTime(45);
    const restored = createEngine(JSON.parse(JSON.stringify(e.snapshot())));
    expect(restored.getState()).toEqual(e.getState());
    expect(restored.getState().cpus.map(c => c.status)).toEqual(Array(8).fill("ok"));
    expect(restored.getState().redundancy).toBe("FULL");
    expect(restored.getState().unprotected).toBe(0);
    expect(restored.endState()?.id).toBe("RESOLVED");
  });
  it("independent sessions and reset have clean execution timestamps", () => {
    const a = createEngine(); const b = createEngine();
    a.runCommand("OPEN HARDWARE TICKET + NOTIFY ON-CALL"); a.advanceTime(45);
    expect(b.getState().cpus[3]?.status).toBe("down");
    const oldId = a.getState().sessionId;
    a.resetScenario();
    expect(a.getState().sessionId).not.toBe(oldId);
    expect(a.snapshot().optionMinutes).toEqual({});
    expect(a.advanceTime(45).messages).toEqual([]);
  });
  it("failed diagnostics do not unlock prerequisites and second operator cannot be skipped", () => {
    const e = createEngine(); e.resetScenario("txn-backlog");
    e.runCommand("GET STATISTICS");
    expect(e.runCommand("TMFCOM STATUS TRANSACTIONS").exitCode).toBe(1);
    e.resetScenario(); e.runCommand("OPEN HARDWARE TICKET + NOTIFY ON-CALL");
    expect(e.runCommand("RESTORE CPU 3").status).toBe("awaiting-second-operator");
    expect(e.runCommand("RESTORE CPU 3").status).toBe("awaiting-second-operator");
    expect(e.getState().responseMs).toBe(900);
  });
});

describe("conversation persistence", () => {
  const cmd = { command: "SHOW SESSION", reason: "inspect", sources: [], unknown_sources: [], confidence: 1, risk: "read-only" as const, description: "session", blast_radius: null, simulated: false };
  it("preserves messages, proposals, outputs, interpretations and unsent draft", () => {
    localStorage.clear();
    const record: Conversation = { id: "one", title: "CPU", input: "unsent", briefed: true, msgs: [{ role: "op", text: "why?" }, { role: "proposal", cls: cmd, state: "rejected" }, { role: "result", cmd: "SHOW SESSION", output: ["ON"] }, { role: "ai", text: "result meaning" }] };
    saveConversation(localStorage, record);
    expect(readConversations(localStorage)).toEqual([record]);
  });
  it("new incident retains previous conversation", () => {
    localStorage.clear();
    saveConversation(localStorage, { id: "one", title: "CPU", input: "draft1", msgs: [], briefed: true });
    saveConversation(localStorage, { id: "two", title: "Disk", input: "draft2", msgs: [], briefed: false });
    expect(readConversations(localStorage).map(c => c.id)).toEqual(["one", "two"]);
  });
  it("restored running operations require authoritative receipts, never replay", () => {
    const running = { role: "proposal" as const, cls: cmd, state: "running" as const, operationId: "op1" };
    expect(reconcileMessages([running])[0]).toMatchObject({ state: "uncertain" });
    expect(reconcileMessages([running], { op1: { command: cmd.command, exitCode: 1, output: ["blocked"] } })[0]).toMatchObject({ state: "failed" });
    expect(reconcileMessages([running], { op1: { command: cmd.command, exitCode: 0, output: ["ok"] } })[0]).toMatchObject({ state: "succeeded" });
  });
});

it("pipeline separates human approval from failed simulated execution", async () => {
  const log = vi.fn();
  const pipeline = createPipeline({ audit: { log, list: async () => [] }, policy: { classify: async () => ({ allowed: true, risk: "read-only", description: "test", blastRadius: null, simulated: false }) }, knowledge: { search: async () => [], get: async () => null, contribute: async () => ({ id: "note" }) }, model: { complete: async () => ({ ok: true, explanation: "Failed", proposed_commands: [], blocked: [], uncertainty: "" }) } });
  const result = await pipeline.approveAndRun("SHOW SESSION", { getSessionContext: () => ({ recentOutput: [], state: {} }), sendCommand: async () => ({ command: "SHOW SESSION", output: ["denied"], exitCode: 1 }) });
  expect(result.status).toBe("failed");
  expect(log).toHaveBeenCalledWith(expect.objectContaining({ event_type: "approved" }));
  expect(log).toHaveBeenCalledWith(expect.objectContaining({ event_type: "output", detail: "Execution failed; exit code 1" }));
});