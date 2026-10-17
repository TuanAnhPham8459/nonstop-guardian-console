import { describe, expect, it } from "vitest";
import { validateCommand } from "@/mock-env/validate.server";
import { ALLOWLIST } from "@/mock-env/allowlist.server";

describe("command allowlist", () => {
  it("allows a listed read-only command", () => {
    const v = validateCommand("status process $zzkrn.#*");
    expect(v.ok && v.entry.risk).toBe("read-only");
  });
  it("abort process is high-risk", () => {
    const v = validateCommand("ABORT PROCESS $ZZKRN.#PAYAUTH1");
    expect(v.ok && v.entry.risk).toBe("high-risk");
  });
  it("rejects unlisted commands with a reason", () => {
    const v = validateCommand("PURGE $SYSTEM.*");
    expect(v.ok).toBe(false);
    expect(!v.ok && v.reason).toMatch(/not on the allowlist/);
  });
  it("rejects chaining", () => expect(validateCommand("STATUS PROCESS $ZZKRN.#*; PURGE x").ok).toBe(false));
  it("every high-risk command has a blast radius", () =>
    ALLOWLIST.filter((c) => c.risk === "high-risk").forEach((c) => expect(c.blastRadius).toBeTruthy()));
  it("RMXCI commands are read-only except SPOOL (low-risk)", () => {
    const rmxci = ALLOWLIST.filter((c) => ["show_session", "show_tables", "show_lasterror", "set_timing", "set_statistics", "get_statistics", "spool"].includes(c.id));
    expect(rmxci.length).toBe(7);
    for (const c of rmxci) expect(c.risk).toBe(c.id === "spool" ? "low-risk" : "read-only");
  });
  it("every entry has a syntax status of confirmed or illustrative", () => {
    for (const c of ALLOWLIST) expect(["confirmed", "illustrative"]).toContain(c.syntaxStatus);
  });
  it("the 10 illustrative commands from the spec are present", () => {
    const illustrative = ALLOWLIST.filter((c) => c.syntaxStatus === "illustrative").map((c) => c.id);
    for (const id of ["throttle_batch", "start_backup", "restore_cpu", "switch_path", "revive_mirror", "promote_standby", "stop_disk", "abort_transaction", "restart_tmf", "open_ticket"])
      expect(illustrative).toContain(id);
  });
  it("real RMXCI commands validate", () => {
    for (const cmd of ["SHOW SESSION", "SHOW TABLES", "SHOW LASTERROR", "SET TIMING ON", "SET STATISTICS ON", "GET STATISTICS"])
      expect(validateCommand(cmd).ok).toBe(true);
  });
  it("confirmed TMFCOM variants validate", () => {
    for (const cmd of ["TMFCOM STATUS TMF", "TMFCOM STATUS TRANSACTIONS", "TMFCOM STATUS AUDITTRAIL", "TMFCOM STATUS DATAVOLS"])
      expect(validateCommand(cmd).ok).toBe(true);
  });
});
