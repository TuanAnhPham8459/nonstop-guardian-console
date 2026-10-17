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

describe("RMXCI commands", () => {
  beforeEach(() => resetScenario());
  it("GET STATISTICS requires SET STATISTICS ON first", () => {
    expect(runCommand("GET STATISTICS").output[0]).toMatch(/SET STATISTICS ON/);
    runCommand("SET STATISTICS ON");
    expect(runCommand("GET STATISTICS").exitCode).toBe(0);
  });
  it("GET STATISTICS prints the expected layout", () => {
    runCommand("SET STATISTICS ON");
    const out = runCommand("GET STATISTICS").output;
    expect(out[0]).toMatch(/^Start Time:/);
    expect(out[1]).toMatch(/^End Time:/);
    expect(out[2]).toMatch(/^Elapsed Time:/);
    expect(out[4]).toMatch(/Table Name.*Records Accessed.*Records Used.*Disk I\/Os.*Message Count.*Message Bytes.*Lock Escl.*Lock Wait.*Disk Process Busy Time/);
  });
  it("transaction backlog shows high Lock Wait/Lock Escl, normal Disk I/Os", () => {
    resetScenario("txn-backlog");
    runCommand("SET STATISTICS ON");
    const out = runCommand("GET STATISTICS").output.join("\n");
    expect(out).toMatch(/PAYAUTH_TXN\s+52100\s+51230\s+3340\s+104200\s+52100000\s+148\s+26800/);
  });
  it("disk degradation shows high Disk I/Os and Disk Process Busy Time, low Lock Wait", () => {
    resetScenario("disk-degradation");
    runCommand("SET STATISTICS ON");
    const out = runCommand("GET STATISTICS").output.join("\n");
    expect(out).toMatch(/CARD_LEDGER\s+24100\s+23890\s+41200\s+48200\s+24100000\s+3\s+110\s+38400/);
  });
  it("SHOW SESSION reflects SET STATISTICS ON and SPOOL", () => {
    runCommand("SET STATISTICS ON");
    runCommand("SPOOL $SPOOL.OUT01");
    const out = runCommand("SHOW SESSION").output.join("\n");
    expect(out).toMatch(/STATISTICS\s+ON/);
    expect(out).toMatch(/SPOOL\s+\$SPOOL\.OUT01/);
  });
  it("RMXCI commands carry read-only/low-risk tiers", () => {
    expect(runCommand("GET STATISTICS").risk).toBe("read-only");
    expect(runCommand("SPOOL $SPOOL.OUT01").risk).toBe("low-risk");
  });
});
