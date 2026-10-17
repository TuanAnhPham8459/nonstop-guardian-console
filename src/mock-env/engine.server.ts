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
  scfPrompt = 1;
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
    queueDepth: s.remediated ? sc.queue.recovered : sc.queue.degraded,
    unprotected: s.remediated ? sc.unprotected.recovered : sc.unprotected.degraded,
    redundancy: s.remediated ? sc.redundancy.recovered : sc.redundancy.degraded,
    incident: { ...sc.incident, firstAlertAt: s.startedAt, alerts },
  };
}

// RMXCI session flags (reset with the scenario).
let timing = false;
let statistics = false;
let spooling: string | null = null;
// SCF-style numbered prompt, incremented per command.
let scfPrompt = 1;
const prompt = () => `${scfPrompt++}->`;

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

function tmfSnapshot() {
  const sc = s.scenario;
  return s.remediated && sc.tmfRecovered ? sc.tmfRecovered : sc.tmf;
}

export function runCommand(cmd: string): CommandResult & { risk?: string } {
  const v = validateCommand(cmd);
  const sc = s.scenario;
  if (!v.ok) return { command: cmd, output: [v.reason], exitCode: 1 };
  const def = v.entry;
  const p = prompt();
  const node = sc.node;

  switch (def.id) {
    // --- Confirmed: SCF process commands ---
    case "status_process": {
      const down = sc.cpuFailure != null && !s.remediated;
      return {
        command: cmd, risk: def.risk, exitCode: 0,
        output: [
          `${p}STATUS PROCESS $ZZKRN.#*`,
          `NONSTOP KERNEL - Status PROCESS ${node}.$ZZKRN.#PAYAUTH1`,
          `  PRIMARY  CPU ${down ? "3 (DOWN)" : "3"}  STATE: ${down ? "RUNNING ON BACKUP" : "RUNNING"}`,
          `  BACKUP   CPU 5  STATE: ${down ? "PRIMARY (TAKEOVER)" : "RUNNING"}`,
          `NONSTOP KERNEL - Status PROCESS ${node}.$ZZKRN.#PAYAUTH2`,
          `  PRIMARY  CPU 6  STATE: RUNNING   BACKUP CPU 7  STATE: RUNNING`,
          down ? "WARNING: 3 processes running without backup" : "All process pairs protected",
        ],
      };
    }
    case "abort_process":
      return {
        command: cmd, risk: def.risk, exitCode: 0,
        output: [
          `${p}ABORT PROCESS $ZZKRN.#PAYAUTH1`,
          `NONSTOP KERNEL - ${node}.$ZZKRN.#PAYAUTH1 ABORTED`,
          "Backup on CPU 5 is now primary. Process is running WITHOUT backup.",
        ],
      };
    case "start_process":
      return {
        command: cmd, risk: def.risk, exitCode: 0,
        output: [`${p}START PROCESS $ZZKRN.#PAYAUTH2`, `NONSTOP KERNEL - ${node}.$ZZKRN.#PAYAUTH2 STARTED on CPU 6`],
      };

    // --- Confirmed: TMFCOM ---
    case "tmf_status": {
      const t = tmfSnapshot();
      return {
        command: cmd, risk: def.risk, exitCode: 0,
        output: [
          `${p}TMFCOM STATUS TMF`,
          `TMF Status: ${t.state}`,
          `Audit trail capacity used: ${t.auditUsed}%`,
          ...(t.extra ?? []),
          `Avg payment txn response: ${responseMs()} ms`,
        ],
      };
    }
    case "tmf_status_transactions": {
      const t = tmfSnapshot();
      const active = s.remediated ? 640 : sc.id === "txn-backlog" ? 4812 : 312;
      return {
        command: cmd, risk: def.risk, exitCode: 0,
        output: [
          `${p}TMFCOM STATUS TRANSACTIONS`,
          `Active transactions: ${active}`,
          s.remediated ? "Oldest transaction age: 00:00:03" : sc.id === "txn-backlog" ? "Oldest transaction age: 00:07:41 ($PAYAUTH)" : "Oldest transaction age: 00:00:41",
          `Audit trail capacity used: ${t.auditUsed}%`,
        ],
      };
    }
    case "tmf_status_audittrail": {
      const t = tmfSnapshot();
      return {
        command: cmd, risk: def.risk, exitCode: 0,
        output: [
          `${p}TMFCOM STATUS AUDITTRAIL`,
          `Audit trail: $AUDIT  State: ${t.state}`,
          `Capacity used: ${t.auditUsed}%`,
        ],
      };
    }
    case "tmf_status_datavols":
      return {
        command: cmd, risk: def.risk, exitCode: 0,
        output: [
          `${p}TMFCOM STATUS DATAVOLS`,
          "VOLUME     STATE     PATH",
          ...(s.remediated && sc.disksRecovered ? sc.disksRecovered : sc.disks).map((d) => `${d.vol.padEnd(10)} ${d.state.padEnd(9)} ${d.path}`),
        ],
      };

    // --- Confirmed: RMXCI ---
    case "show_session":
      return {
        command: cmd, risk: def.risk, exitCode: 0,
        output: [
          "SQL> SHOW SESSION;",
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
        output: ["SQL> SHOW TABLES;", "Tables referenced in this session:", "  BANKPRD.OPS.PAYAUTH_TXN", "  BANKPRD.OPS.CARD_LEDGER", "  BANKPRD.OPS.AUTH_CODES"],
      };
    case "show_lasterror":
      return { command: cmd, risk: def.risk, exitCode: 0, output: ["SQL> SHOW LASTERROR;", "No error. Last statement completed successfully (SQLCODE 0)."] };
    case "set_timing":
      timing = true;
      return { command: cmd, risk: def.risk, exitCode: 0, output: ["SQL> SET TIMING ON;", "Timing is ON."] };
    case "set_statistics":
      statistics = true;
      return { command: cmd, risk: def.risk, exitCode: 0, output: ["SQL> SET STATISTICS ON;", "Statistics collection is ON."] };
    case "get_statistics":
      if (!statistics)
        return { command: cmd, risk: def.risk, exitCode: 1, output: ["SQL> GET STATISTICS;", "*** ERROR[15001] Statistics are not enabled. Issue SET STATISTICS ON first."] };
      return { command: cmd, risk: def.risk, exitCode: 0, output: ["SQL> GET STATISTICS;", ...statsOutput()] };
    case "spool":
      spooling = "$SPOOL.OUT01";
      return { command: cmd, risk: def.risk, exitCode: 0, output: ["SQL> SPOOL $SPOOL.OUT01;", "Spooling to $SPOOL.OUT01 (simulated — no file is written)."] };

    // --- Illustrative commands ---
    case "throttle_batch":
      return { command: cmd, risk: def.risk, exitCode: 0, output: [`${p}THROTTLE BATCH QUEUE`, "Batch queue throttled to 40% of normal rate.", "Payment transactions now have scheduling priority."] };
    case "start_backup":
      return { command: cmd, risk: def.risk, exitCode: 0, output: [`${p}START BACKUP FOR $ZZKRN.#PAYAUTH1 ON CPU 6`, `NONSTOP KERNEL - backup for ${node}.$ZZKRN.#PAYAUTH1 started on CPU 6`, "Process pair protected again."] };
    case "restore_cpu":
      if (sc.fix === "restore_cpu") {
        s.remediated = true;
        return { command: cmd, risk: def.risk, exitCode: 0, output: [`${p}RESTORE CPU 3`, "CPU 3 rejoining the system...", "CPU 3 UP. Load rebalancing across CPUs 0-7.", ...sc.restartOutput] };
      }
      return { command: cmd, risk: def.risk, exitCode: 0, output: [`${p}RESTORE CPU 3`, "CPU 3 is already UP. No change."] };
    case "switch_path":
      if (sc.fix === "switch_path") {
        s.remediated = true;
        return { command: cmd, risk: def.risk, exitCode: 0, output: [`${p}SWITCH STORAGE PATH $DATA02`, "$DATA02 switched to alternate path.", "I/O queue draining. Redundancy remains REDUCED until the primary path is repaired.", ...sc.restartOutput] };
      }
      return { command: cmd, risk: def.risk, exitCode: 0, output: [`${p}SWITCH STORAGE PATH $DATA02`, "$DATA02 paths are healthy. No change."] };
    case "revive_mirror":
      return { command: cmd, risk: def.risk, exitCode: 0, output: [`${p}REVIVE MIRROR $DATA02`, "Mirror revive started for $DATA02.", "WARNING: heavy I/O while the volume re-syncs."] };
    case "promote_standby":
      return { command: cmd, risk: def.risk, exitCode: 0, output: [`${p}PROMOTE STANDBY VOLUME $DATA03`, "$DATA03 promoted to ACTIVE.", "Re-point applications before decommissioning the old volume."] };
    case "stop_disk":
      return { command: cmd, risk: def.risk, exitCode: 0, output: [`${p}STOP DISK $DATA02`, "$DATA02 STOPPED. All data on the volume is offline."] };
    case "abort_transaction":
      if (sc.fix === "abort_transaction") {
        s.remediated = true;
        return { command: cmd, risk: def.risk, exitCode: 0, output: [`${p}ABORT TRANSACTION 4821`, "Transaction 4821 ($PAYAUTH) backing out...", "Backout complete. Locks released; audit trail draining.", ...sc.restartOutput] };
      }
      return { command: cmd, risk: def.risk, exitCode: 0, output: [`${p}ABORT TRANSACTION 4821`, "Transaction 4821 backed out. Locks released."] };
    case "restart_tmf":
      return { command: cmd, risk: def.risk, exitCode: 0, output: [`${p}RESTART TMF`, "TMF restarting... all in-flight transactions backed out.", "TMF Status: STARTED. New transactions accepted."] };
    case "open_ticket":
      return { command: cmd, risk: def.risk, exitCode: 0, output: [`${p}OPEN HARDWARE TICKET CPU 3`, "Hardware ticket HW-88412 opened for CPU 3.", "Field service notified (simulated)."] };
  }
}

export const commandHelp = () => [
  "Confirmed commands (documented by HPE):",
  ...ALLOWLIST.filter((c) => c.syntaxStatus === "confirmed").map((c) => `  ${c.pattern.padEnd(42)} [${c.risk}] ${c.description}`),
  "Illustrative commands (invented for the demo):",
  ...ALLOWLIST.filter((c) => c.syntaxStatus === "illustrative").map((c) => `  ${c.pattern.padEnd(42)} [${c.risk}] ${c.description}`),
];

export const listScenarios = () => Object.values(SCENARIOS).map((x) => ({ id: x.id, label: x.label, title: x.incident.title }));
export const currentScenarioId = () => s.scenario.id;
