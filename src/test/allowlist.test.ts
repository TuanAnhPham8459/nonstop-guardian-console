import { describe, expect, it } from "vitest";
import { validateCommand } from "@/mock-env/validate.server";
import { ALLOWLIST } from "@/mock-env/allowlist.server";

describe("command allowlist", () => {
  it("allows a listed read-only command", () => {
    const v = validateCommand("scf status cpu *");
    expect(v.ok && v.entry.risk).toBe("read-only");
  });
  it("restart is high-risk", () => {
    const v = validateCommand("SCF RESTART PROCESS $PAYAUTH");
    expect(v.ok && v.entry.risk).toBe("high-risk");
  });
  it("rejects unlisted commands with a reason", () => {
    const v = validateCommand("PURGE $SYSTEM.*");
    expect(v.ok).toBe(false);
    expect(!v.ok && v.reason).toMatch(/not on the allowlist/);
  });
  it("rejects chaining", () => expect(validateCommand("SCF STATUS CPU *; PURGE x").ok).toBe(false));
  it("every high-risk command has a blast radius", () =>
    ALLOWLIST.filter((c) => c.risk === "high-risk").forEach((c) => expect(c.blastRadius).toBeTruthy()));
});
