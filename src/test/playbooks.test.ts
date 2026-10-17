import { describe, expect, it } from "vitest";
import { applyPlaybooks, stateMetrics, triggerMatches, type Playbook } from "@/playbooks/playbooks.server";
import type { SystemState } from "@/adapters/types";

const pb = (over: Partial<Playbook> = {}): Playbook => ({
  id: "PB-1",
  title: "CPU failure — restore redundancy",
  author: "R. Patel",
  status: "approved",
  version: 2,
  trigger: [{ metric: "cpus_down", operator: ">=", value: 1 }],
  steps: [
    { option_id: "C1", action: "STATUS PROCESS $ZZKRN.#*", why: "see pairs" },
    { option_id: "C3", action: "OPEN HARDWARE TICKET + NOTIFY ON-CALL", why: "start repair clock" },
    { option_id: "C7", action: "RESTORE CPU 3", why: "restore after repair" },
  ],
  stop_conditions: "",
  escalate_if: "",
  never_do: ["C8"],
  approved_by: "M. Chen",
  created_at: "2026-10-17T00:00:00Z",
  ...over,
});

const catalog = [
  { id: "C1", action: "STATUS PROCESS $ZZKRN.#*" },
  { id: "C3", action: "OPEN HARDWARE TICKET + NOTIFY ON-CALL" },
  { id: "C7", action: "RESTORE CPU 3", requires: ["C3"] },
  { id: "C8", action: "RESTART TMF" },
];

const state = (over: Partial<SystemState> = {}): SystemState => ({
  node: "\\BANKPRD1",
  cpus: [
    { id: 0, busy: 60, status: "ok" },
    { id: 3, busy: 0, status: "down" },
  ],
  tps: 410,
  responseMs: 900,
  queueDepth: 1850,
  unprotected: 4,
  redundancy: "REDUCED",
  incident: { id: "INC-1", title: "t", severity: "SEV2", firstAlertAt: 0, alerts: [] },
  ...over,
});

describe("playbook triggers", () => {
  it("matches only when ALL conditions hold", () => {
    const p = pb({ trigger: [{ metric: "cpus_down", operator: ">=", value: 1 }, { metric: "avg_response_ms", operator: ">", value: 400 }] });
    expect(triggerMatches(p, stateMetrics(state()))).toBe(true);
    expect(triggerMatches(p, stateMetrics(state({ responseMs: 200 })))).toBe(false);
  });
  it("compares string metrics like redundancy", () => {
    const p = pb({ trigger: [{ metric: "redundancy", operator: "=", value: "REDUCED" }] });
    expect(triggerMatches(p, stateMetrics(state()))).toBe(true);
    expect(triggerMatches(p, stateMetrics(state({ redundancy: "FULL" })))).toBe(false);
  });
  it("never matches an empty trigger", () => {
    expect(triggerMatches(pb({ trigger: [] }), stateMetrics(state()))).toBe(false);
  });
});

describe("applyPlaybooks", () => {
  const proposed = [{ command: "RESTORE CPU 3" }, { command: "STATUS PROCESS $ZZKRN.#*" }];

  it("reorders proposals to the playbook step order and attaches provenance", () => {
    const { commands, influence } = applyPlaybooks(proposed, [pb()], catalog, new Set(["C1", "C3"]));
    expect(commands[0]!.command).toBe("STATUS PROCESS $ZZKRN.#*");
    expect(influence!.provenance["STATUS PROCESS $ZZKRN.#*"]).toMatchObject({ playbook_id: "PB-1", step: 1, author: "R. Patel", approver: "M. Chen" });
    expect(influence!.followed).toBe("PB-1");
  });

  it("ranks never_do commands last with a warning", () => {
    const { commands, influence } = applyPlaybooks([{ command: "RESTART TMF" }, { command: "STATUS PROCESS $ZZKRN.#*" }], [pb()], catalog, new Set(["C1"]));
    expect(commands.at(-1)!.command).toBe("RESTART TMF");
    expect(influence!.never_do_warnings["RESTART TMF"]).toContain("never_do");
  });

  it("skips steps whose prerequisites are not met and reports a conflict", () => {
    const { influence } = applyPlaybooks(proposed, [pb()], catalog, new Set(["C1"])); // C3 not executed
    expect(influence!.conflicts.some((c) => c.includes("RESTORE CPU 3") && c.includes("C3"))).toBe(true);
    expect(influence!.provenance["RESTORE CPU 3"]).toBeUndefined();
  });

  it("skips steps not in the catalog with a conflict", () => {
    const bad = pb({ steps: [{ option_id: "X9", action: "FORMAT $EVERYTHING", why: "bad" }] });
    const { influence } = applyPlaybooks([], [bad], catalog, new Set());
    expect(influence!.conflicts.length).toBe(1);
  });

  it("reports both playbooks when more than one matches and says which is followed", () => {
    const second = pb({ id: "PB-2", title: "Other playbook" });
    const { influence } = applyPlaybooks(proposed, [pb(), second], catalog, new Set(["C1", "C3"]));
    expect(influence!.matched.map((m) => m.id)).toEqual(["PB-1", "PB-2"]);
    expect(influence!.followed).toBe("PB-1");
    expect(influence!.followed_reason).toContain("2 approved playbooks");
  });

  it("does nothing without playbooks", () => {
    const { commands, influence } = applyPlaybooks(proposed, [], catalog, new Set());
    expect(commands).toEqual(proposed);
    expect(influence).toBeNull();
  });
});
