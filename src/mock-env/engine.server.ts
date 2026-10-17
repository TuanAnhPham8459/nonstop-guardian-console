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
  timing = false;
  statistics = false;
  spooling = null;
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
    alerts.push({ time: "now", source: "APM", text: sc.recoveredAlert, level: "info" });
  return {
    node: sc.node,
    scenario: { id: sc.id, label: sc.label, opener: sc.opener },
    cpus: b.map((v, id) => ({
      id,
      busy: v,
      status: id === sc.cpuFailure?.cpu ? "down" : v >= 85 ? "crit" : v >= 70 ? "warn" : "ok",
    })),
    tps: s.remediated ? sc.tps.recovered : sc.tps.degraded,
    responseMs: responseMs(),
    incident: { ...sc.incident, firstAlertAt: s.startedAt, alerts },
  };
}

// RMXCI session flags (reset with the scenario).
let timing = false;
let statistics = false;
let spooling: string | null = null;

function statsOutput(): string[] {
  const sc = s.scenario;
  const snap = s.remediated ? sc.statsRecovered : sc.stats;
  const pad = (v: string | number, w: number) => String(v).padEnd(w);
  return [
    `Start Time: ${snap.start}`,
    `End Time:   ${snap.end}`,
    `Elapsed Time: ${snap.elapsed}`,
    "",
    `${pad("Table Name", 14)}${pad("Records Accessed", 17)}${pad("Records Used", 13)}${pad("Disk I/Os", 10)}${pad("Message Count", 14)}${pad("Message Bytes", 14)}${pad("Lock Escl", 10)}${pad("Lock Wait", 10)}Disk Process Busy Time`,
    ...snap.rows.map(
      (r) =>
        `${pad(r.table, 14)}${pad(r.recordsAccessed, 17)}${pad(r.recordsUsed, 13)}${pad(r.diskIOs, 10)}${pad(r.messageCount, 14)}${pad(r.messageBytes, 14)}${pad(r.lockEscl, 10)}${pad(r.lockWait, 10)}${r.diskProcBusy}`,
    ),
  ];
}

export function runCommand(cmd: string): CommandResult & { risk?: string } {
  const v = validateCommand(cmd);
  const sc = s.scenario;
  if (!v.ok) return { command: cmd, output: [v.reason], exitCode: 1 };
  const def = v.entry;

  switch (def.id) {
    // --- Real RMXCI commands ---
    case "show_session":
      return {
        command: cmd, risk: def.risk, exitCode: 0,
        output: [
          "Session attributes:",
          `  TIMING      ${timing ? "ON" : "OFF"}`,
          `  STATISTICS  ${statistics ? "ON" : "OFF"}`,
          `  SPOOL       ${spooling ?? "OFF"}`,
          `  CATALOG     BANKPRD`,
          `  SCHEMA      OPS`,
        ],
      };
    case "show_tables":
      return {
        command: cmd, risk: def.risk, exitCode: 0,
        output: ["Tables referenced in this session:", "  BANKPRD.OPS.PAYAUTH_TXN", "  BANKPRD.OPS.CARD_LEDGER", "  BANKPRD.OPS.AUTH_CODES"],
      };
    case "show_lasterror":
      return { command: cmd, risk: def.risk, exitCode: 0, output: ["No error. Last statement completed successfully (SQLCODE 0)."] };
    case "set_timing":
      timing = true;
      return { command: cmd, risk: def.risk, exitCode: 0, output: ["Timing is ON."] };
    case "set_statistics":
      statistics = true;
      return { command: cmd, risk: def.risk, exitCode: 0, output: ["Statistics collection is ON."] };
    case "get_statistics":
      if (!statistics)
        return { command: cmd, risk: def.risk, exitCode: 1, output: ["*** ERROR[15001] Statistics are not enabled. Issue SET STATISTICS ON first."] };
      return { command: cmd, risk: def.risk, exitCode: 0, output: statsOutput() };
    case "spool":
      spooling = "$SPOOL.OUT01";
      return { command: cmd, risk: def.risk, exitCode: 0, output: ["Spooling to $SPOOL.OUT01 (simulated — no file is written)."] };

    // --- Simulated syntax ---
    case "status_cpu":
      return {
        command: cmd, risk: def.risk, exitCode: 0,
        output: [
          `SCF STATUS CPU ${sc.node}`,
          "CPU  STATE   BUSY%",
          ...busy().map((v, i) =>
            `${String(i).padEnd(4)} ${(i === sc.cpuFailure?.cpu ? "DOWN" : "UP").padEnd(7)} ${i === sc.cpuFailure?.cpu ? "--" : v}`),
          sc.cpuFailure ? `CPU ${sc.cpuFailure.cpu} DOWN since ${sc.cpuFailure.at}` : "All CPUs UP",
        ],
      };
    case "status_tmf": {
      const t = s.remediated && sc.tmfRecovered ? sc.tmfRecovered : sc.tmf;
      return {
        command: cmd, risk: def.risk, exitCode: 0,
        output: [
          `TMF Status: ${t.state}`,
          `Audit trail capacity used: ${t.auditUsed}%`,
          ...(t.extra ?? []),
          `Avg payment txn response: ${responseMs()} ms`,
        ],
      };
    }
    case "status_disk":
      return {
        command: cmd, risk: def.risk, exitCode: 0,
        output: ["VOLUME     STATE     PATH", ...(s.remediated && sc.disksRecovered ? sc.disksRecovered : sc.disks).map((d) => `${d.vol.padEnd(10)} ${d.state.padEnd(9)} ${d.path}`)],
      };
    case "measure_cpu":
      return { command: cmd, risk: def.risk, exitCode: 0, output: ["MEASCOM: CPU entity added for CPUs 0-7", "Collection running (interval 60s)"] };
    case "restart_process":
      s.remediated = true;
      return {
        command: cmd, risk: def.risk, exitCode: 0,
        output: sc.restartOutput,
      };
  }
}

export const commandHelp = () => [
  "RMXCI commands (HPE SQL/MX RMXCI Guide 4.0.1):",
  ...ALLOWLIST.filter((c) => c.group === "rmxci").map((c) => `  ${c.pattern.padEnd(32)} [${c.risk}] ${c.description}`),
  "Simulated syntax (unverified):",
  ...ALLOWLIST.filter((c) => c.group === "simulated").map((c) => `  ${c.pattern.padEnd(32)} [${c.risk}] ${c.description}`),
];

export const listScenarios = () => Object.values(SCENARIOS).map((x) => ({ id: x.id, label: x.label, title: x.incident.title }));
export const currentScenarioId = () => s.scenario.id;
