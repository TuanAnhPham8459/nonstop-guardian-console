import type { CommandResult, SystemState } from "@/adapters/types";
import { ALLOWLIST } from "./allowlist.server";
import { validateCommand } from "./validate.server";
import { SCENARIOS, paymentSlowdown, type Scenario } from "./scenarios/payment-slowdown";

// Stateful simulation engine. Pure TS, no I/O — runs inside the mock-env backend.
interface EnvState {
  scenario: Scenario;
  tick: number;
  remediated: boolean;
  startedAt: number;
}

let s: EnvState = fresh("payment-slowdown");

function fresh(id: string): EnvState {
  return { scenario: SCENARIOS[id] ?? paymentSlowdown, tick: 0, remediated: false, startedAt: Date.now() - 12 * 60_000 };
}

export function resetScenario(id = "payment-slowdown") {
  s = fresh(id);
}

function responseMs() {
  const r = s.scenario.responseMs;
  if (s.remediated) return r.recovered;
  const f = Math.min(1, s.tick / s.scenario.rampTicks);
  return Math.round(r.start + (r.peak - r.start) * f);
}

function busy() {
  return s.remediated ? s.scenario.recoveredBusy : s.scenario.degradedBusy;
}

export function getState(): SystemState {
  s.tick++;
  const sc = s.scenario;
  const b = busy();
  const alerts = [...sc.alerts];
  if (s.remediated)
    alerts.push({ time: "now", source: "APM", text: "Latency recovering after $PAYAUTH restart", level: "info" as never });
  return {
    node: sc.node,
    cpus: b.map((v, id) => ({
      id,
      busy: v,
      status: id === sc.cpuFailure.cpu ? "down" : v >= 85 ? "crit" : v >= 70 ? "warn" : "ok",
    })),
    tps: s.remediated ? sc.tps.recovered : sc.tps.degraded,
    responseMs: responseMs(),
    incident: { ...sc.incident, firstAlertAt: s.startedAt, alerts },
  };
}

export function runCommand(cmd: string): CommandResult & { risk?: string } {
  const v = validateCommand(cmd);
  const sc = s.scenario;
  if (!v.ok) return { command: cmd, output: [v.reason], exitCode: 1 };
  const def = v.entry;

  switch (def.id) {
    case "status_cpu":
      return {
        command: cmd, risk: def.risk, exitCode: 0,
        output: [
          `SCF STATUS CPU ${sc.node}`,
          "CPU  STATE   BUSY%",
          ...busy().map((v, i) =>
            `${String(i).padEnd(4)} ${(i === sc.cpuFailure.cpu ? "DOWN" : "UP").padEnd(7)} ${i === sc.cpuFailure.cpu ? "--" : v}`),
          `CPU ${sc.cpuFailure.cpu} DOWN since ${sc.cpuFailure.at}`,
        ],
      };
    case "status_tmf":
      return {
        command: cmd, risk: def.risk, exitCode: 0,
        output: [
          `TMF Status: ${sc.tmf.state}`,
          `Audit trail capacity used: ${sc.tmf.auditUsed}%`,
          `Avg payment txn response: ${responseMs()} ms`,
        ],
      };
    case "status_disk":
      return {
        command: cmd, risk: def.risk, exitCode: 0,
        output: ["VOLUME     STATE     PATH", ...sc.disks.map((d) => `${d.vol.padEnd(10)} ${d.state.padEnd(9)} ${d.path}`)],
      };
    case "measure_cpu":
      return { command: cmd, risk: def.risk, exitCode: 0, output: ["MEASCOM: CPU entity added for CPUs 0-7", "Collection running (interval 60s)"] };
    case "restart_process":
      s.remediated = true;
      return {
        command: cmd, risk: def.risk, exitCode: 0,
        output: ["$PAYAUTH: STOP requested", "$PAYAUTH: backup takeover complete", "$PAYAUTH: restarted on CPU 5, work rebalanced"],
      };
  }
}

export const commandHelp = () => ALLOWLIST.map((c) => `${c.pattern.padEnd(32)} [${c.risk}] ${c.description}`);
