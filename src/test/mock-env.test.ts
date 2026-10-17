import { beforeEach, describe, expect, it } from "vitest";
import { getState, resetScenario, runCommand } from "@/mock-env/engine";

describe("mock-env payment-slowdown", () => {
  beforeEach(() => resetScenario());
  it("CPU 3 is down", () => expect(getState().cpus[3]?.status).toBe("down"));
  it("response time climbs to 900ms", () => {
    let r = 0;
    for (let i = 0; i < 20; i++) r = getState().responseMs;
    expect(r).toBe(900);
  });
  it("unknown commands are rejected", () =>
    expect(runCommand("FOO").output).toEqual(["command not recognized"]));
  it("restart lowers CPU 4-7 load and latency; reset restores", () => {
    expect(runCommand("scf  restart process $payauth").risk).toBe("high-risk");
    const s = getState();
    expect(Math.max(...s.cpus.slice(4).map((c) => c.busy))).toBeLessThan(70);
    expect(s.responseMs).toBe(180);
    resetScenario();
    expect(getState().cpus[5]?.busy).toBe(91);
  });
});
