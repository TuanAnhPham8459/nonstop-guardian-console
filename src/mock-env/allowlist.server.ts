// SERVER-ONLY allowlist of commands. The *.server.ts suffix keeps it out of browser bundles.
// Risk tier comes ONLY from this table — never from the AI model.
//
// Two groups:
// - "rmxci": REAL HPE SQL/MX RMXCI commands (RMXCI Guide 4.0.1). Output values are fictional.
// - "simulated": SCF/TMF/MEASCOM commands with ILLUSTRATIVE, unverified syntax — verify against
//   HPE NonStop docs and edit here.

export type RiskTier = "read-only" | "low-risk" | "high-risk";
export type CommandGroup = "rmxci" | "simulated";
export type CommandId =
  | "show_session"
  | "show_tables"
  | "show_lasterror"
  | "set_timing"
  | "set_statistics"
  | "get_statistics"
  | "spool"
  | "status_cpu"
  | "status_tmf"
  | "status_disk"
  | "measure_cpu"
  | "restart_process";

export interface AllowedCommand {
  id: CommandId;
  pattern: string; // matched after trim, whitespace-collapse, uppercase
  description: string;
  risk: RiskTier;
  group: CommandGroup;
  blastRadius?: string; // required for high-risk
}

export const ALLOWLIST: readonly AllowedCommand[] = [
  // --- Real RMXCI commands (HPE SQL/MX RMXCI Guide 4.0.1) ---
  { id: "show_session", pattern: "SHOW SESSION", description: "Show current RMXCI session attributes", risk: "read-only", group: "rmxci" },
  { id: "show_tables", pattern: "SHOW TABLES", description: "List tables referenced in the current session", risk: "read-only", group: "rmxci" },
  { id: "show_lasterror", pattern: "SHOW LASTERROR", description: "Show details of the last SQL error", risk: "read-only", group: "rmxci" },
  { id: "set_timing", pattern: "SET TIMING ON", description: "Enable timing information for executed statements", risk: "read-only", group: "rmxci" },
  { id: "set_statistics", pattern: "SET STATISTICS ON", description: "Enable statistics collection for executed statements", risk: "read-only", group: "rmxci" },
  { id: "get_statistics", pattern: "GET STATISTICS", description: "Show per-table access statistics: I/Os, lock waits, disk process busy time", risk: "read-only", group: "rmxci" },
  {
    id: "spool",
    pattern: "SPOOL $SPOOL.OUT01",
    description: "Spool session output to a file (illustrative target file)",
    risk: "low-risk",
    group: "rmxci",
  },

  // --- Simulated syntax (unverified — check HPE NonStop docs) ---
  { id: "status_cpu", pattern: "SCF STATUS CPU *", description: "Per-CPU state and load", risk: "read-only", group: "simulated" },
  { id: "status_tmf", pattern: "TMFCOM STATUS TMF", description: "TMF subsystem status", risk: "read-only", group: "simulated" },
  { id: "status_disk", pattern: "SCF STATUS DISK $*", description: "Disk volume status", risk: "read-only", group: "simulated" },
  {
    id: "measure_cpu",
    pattern: "MEASCOM ADD CPU *",
    description: "Start a Measure performance collection on all CPUs",
    risk: "low-risk",
    group: "simulated",
  },
  {
    id: "restart_process",
    pattern: "SCF RESTART PROCESS $PAYAUTH",
    description: "Restart the payment authorization process pair",
    risk: "high-risk",
    group: "simulated",
    blastRadius:
      "Payment authorizations in flight may fail or time out for ~10-30s while the backup takes over. " +
      "Affects all ATM/POS card authorizations routed through $PAYAUTH. If the backup is unhealthy, payments stop entirely until manual recovery.",
  },
];
