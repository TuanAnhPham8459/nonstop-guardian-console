import { beforeEach, describe, expect, it } from "vitest";
import { advanceTime, endState, getState, resetScenario, runCommand } from "@/mock-env/engine.server";

describe("cpu-failure scenario", () => {
  beforeEach(() => resetScenario("cpu-failure"));
  it("CPU 3 is down, 4 processes unprotected, latency 900", () => {
    const s = getState();
    expect(s.cpus[3]?.status).toBe("down");
    expect(s.unprotected).toBe(4);
    expect(s.responseMs).toBe(900);
    expect(s.queueDepth).toBe(1850);
    expect(s.redundancy).toBe("REDUCED");
  });
  it("unknown commands are rejected", () =>
    expect(runCommand("FOO").output[0]).toMatch(/^command not recognized/));
  it("STATUS PROCESS uses SCF-style numbered prompts", () => {
    const out = runCommand("STATUS PROCESS $ZZKRN.#*").output;
    expect(out[0]).toMatch(/^\d+->STATUS PROCESS/);
    expect(out.join("\n")).toMatch(/NONSTOP KERNEL - Status PROCESS \\BANKPRD1\.\$ZZKRN\.#PAYAUTH1/);
  });
  it("C5 requires C1 first", () => {
    expect(runCommand("START BACKUP FOR $PAYAUTH1 ON CPU 7").output.join("\n")).toMatch(/requires C1/);
    runCommand("STATUS PROCESS $ZZKRN.#*");
    expect(runCommand("START BACKUP FOR $PAYAUTH1 ON CPU 7").exitCode).toBe(0);
    expect(getState().unprotected).toBe(3);
  });
  it("RESTORE CPU 3 needs the ticket, a second operator, and repaired hardware", () => {
    expect(runCommand("RESTORE CPU 3").output.join("\n")).toMatch(/requires C3/);
    runCommand("OPEN HARDWARE TICKET + NOTIFY ON-CALL");
    expect(runCommand("RESTORE CPU 3").output.join("\n")).toMatch(/second operator/);
    // Confirmed before repair -> BAD outcome
    expect(runCommand("RESTORE CPU 3 CONFIRMED").exitCode).toBe(1);
    expect(getState().responseMs).toBe(1400);
    resetScenario("cpu-failure");
    runCommand("OPEN HARDWARE TICKET + NOTIFY ON-CALL");
    advanceTime(15); advanceTime(15); advanceTime(15); // 45 min -> hardware repaired
    expect(runCommand("RESTORE CPU 3").output.join("\n")).toContain("already online");
    expect(runCommand("RESTORE CPU 3 CONFIRMED").exitCode).toBe(0);
    const s = getState();
    expect(s.cpus[3]?.status).not.toBe("down");
    expect(s.responseMs).toBe(130);
    expect(s.unprotected).toBe(0);
    expect(endState()?.id).toBe("RESOLVED");
  });
  it("RESTART TMF is a trap that causes an outage", () => {
    expect(runCommand("RESTART TMF").exitCode).toBe(1);
    expect(endState()?.id).toBe("OUTAGE");
    expect(getState().tps).toBe(0);
  });
  it("STABLE_AT_RISK when latency is fine but processes are unprotected", () => {
    runCommand("STATUS PROCESS $ZZKRN.#*");
    runCommand("ABORT PROCESS $ZZKRN.#RPTGEN");
    expect(getState().responseMs).toBe(280);
    expect(endState()?.id).toBe("STABLE_AT_RISK");
  });
});

describe("disk-degraded scenario", () => {
  beforeEach(() => resetScenario("disk-degraded"));
  it("no CPU down; SCF STATUS DISK is one-time and unlocks D2", () => {
    expect(getState().cpus.some((c) => c.status === "down")).toBe(false);
    expect(runCommand("SWITCH STORAGE PATH $DATA01").output.join("\n")).toMatch(/requires D1/);
    expect(runCommand("SCF STATUS DISK $DATA01, DETAIL").exitCode).toBe(0);
    expect(runCommand("SCF STATUS DISK $DATA01, DETAIL").output.join("\n")).toMatch(/one-time/);
    expect(runCommand("SWITCH STORAGE PATH $DATA01").exitCode).toBe(0);
    expect(getState().responseMs).toBe(300);
    expect(endState()?.id).toBe("STABLE_DEGRADED");
  });
  it("REVIVE MIRROR succeeds only after pausing reporting jobs", () => {
    runCommand("SCF STATUS DISK $DATA01, DETAIL");
    runCommand("SWITCH STORAGE PATH $DATA01");
    expect(runCommand("REVIVE MIRROR $DATA01").exitCode).toBe(1); // D3 not done
    expect(getState().responseMs).toBe(780);
    resetScenario("disk-degraded");
    runCommand("SCF STATUS DISK $DATA01, DETAIL");
    runCommand("SWITCH STORAGE PATH $DATA01");
    runCommand("PAUSE REPORTING JOBS ON $DATA01");
    expect(runCommand("REVIVE MIRROR $DATA01").exitCode).toBe(0);
    expect(endState()?.id).toBe("RESOLVED");
  });
  it("STOP DISK $DATA01 is a trap", () => {
    runCommand("STOP DISK $DATA01");
    expect(endState()?.id).toBe("OUTAGE");
  });
});

describe("txn-backlog scenario", () => {
  beforeEach(() => resetScenario("txn-backlog"));
  it("GET STATISTICS shows a lock problem; T2 requires T1", () => {
    expect(runCommand("TMFCOM STATUS TRANSACTIONS").output.join("\n")).toMatch(/requires T1/);
    runCommand("SET STATISTICS ON");
    runCommand("GET STATISTICS");
    expect(runCommand("TMFCOM STATUS TRANSACTIONS").output.join("\n")).toMatch(/BATCH-SETTLE/);
  });
  it("ABORT TRANSACTION succeeds only after owner approves (10 min after T4)", () => {
    runCommand("SET STATISTICS ON");
    runCommand("GET STATISTICS");
    runCommand("TMFCOM STATUS TRANSACTIONS");
    expect(runCommand("ABORT TRANSACTION 4821").exitCode).toBe(1); // owner UNKNOWN
    runCommand("NOTIFY APPLICATION OWNER");
    advanceTime(15);
    expect(runCommand("ABORT TRANSACTION 4821").exitCode).toBe(0);
    expect(getState().queueDepth).toBe(50);
    expect(endState()?.id).toBe("RESOLVED");
  });
  it("PAUSE BATCH FEEDER contains the queue", () => {
    runCommand("PAUSE BATCH FEEDER");
    expect(getState().queueDepth).toBe(1500);
    expect(endState()?.id).toBe("CONTAINED");
  });
});

describe("RMXCI commands", () => {
  beforeEach(() => resetScenario("cpu-failure"));
  it("GET STATISTICS requires SET STATISTICS ON first", () => {
    expect(runCommand("GET STATISTICS").output.join("\n")).toMatch(/SET STATISTICS ON/);
    runCommand("SET STATISTICS ON");
    expect(runCommand("GET STATISTICS").exitCode).toBe(0);
  });
  it("GET STATISTICS prints the expected layout with SQL> prompt", () => {
    runCommand("SET STATISTICS ON");
    const out = runCommand("GET STATISTICS").output;
    expect(out[0]).toMatch(/^SQL> GET STATISTICS/);
    expect(out[1]).toMatch(/^Start Time:/);
    expect(out[2]).toMatch(/^End Time:/);
    expect(out[3]).toMatch(/^Elapsed Time:/);
    expect(out[5]).toMatch(/Table Name.*Records Accessed.*Records Used.*Disk I\/Os.*Message Count.*Message Bytes.*Lock Escl.*Lock Wait.*Disk Process Busy Time/);
  });
  it("transaction backlog shows high Lock Wait/Lock Escl, normal Disk I/Os", () => {
    resetScenario("txn-backlog");
    runCommand("SET STATISTICS ON");
    const out = runCommand("GET STATISTICS").output.join("\n");
    expect(out).toMatch(/PAYAUTH_TXN\s+52100\s+51230\s+3340\s+104200\s+52100000\s+148\s+26800/);
  });
  it("disk degradation shows high Disk I/Os and Disk Process Busy Time, low Lock Wait", () => {
    resetScenario("disk-degraded");
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
