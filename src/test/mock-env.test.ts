import { beforeEach, describe, expect, it } from "vitest";
import { getState, resetScenario, runCommand } from "@/mock-env/engine.server";

describe("mock-env payment-slowdown", () => {
  beforeEach(() => resetScenario());
  it("CPU 3 is down", () => expect(getState().cpus[3]?.status).toBe("down"));
  it("response time climbs to 900ms", () => {
    let r = 0;
    for (let i = 0; i < 20; i++) r = getState().responseMs;
    expect(r).toBe(900);
  });
  it("unknown commands are rejected", () =>
    expect(runCommand("FOO").output[0]).toMatch(/^command not recognized/));
  it("restart lowers CPU 4-7 load and latency; reset restores", () => {
    expect(runCommand("scf  restart process $payauth").risk).toBe("high-risk");
    const s = getState();
    expect(Math.max(...s.cpus.slice(4).map((c) => c.busy))).toBeLessThan(70);
    expect(s.responseMs).toBe(180);
    resetScenario();
    expect(getState().cpus[5]?.busy).toBe(91);
  });
});

describe("fault injection scenarios", () => {
  it("disk degradation: no CPU down, $DATA02 mirror only", () => {
    resetScenario("disk-degradation");
    expect(getState().cpus.some((c) => c.status === "down")).toBe(false);
    expect(runCommand("SCF STATUS DISK $*").output.join("\n")).toMatch(/\$DATA02.*MIRROR ONLY/);
  });
  it("transaction backlog: audit trail 91%, drops after restart", () => {
    resetScenario("txn-backlog");
    expect(runCommand("TMFCOM STATUS TMF").output[1]).toMatch(/91%/);
    runCommand("SCF RESTART PROCESS $PAYAUTH");
    expect(runCommand("TMFCOM STATUS TMF").output[1]).toMatch(/74%/);
  });
  it("each scenario has its own alerts", () => {
    resetScenario("txn-backlog");
    expect(getState().incident.alerts[0]?.text).toMatch(/Audit trail/);
  });
});
