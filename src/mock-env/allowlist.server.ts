// SERVER-ONLY allowlist of commands. The *.server.ts suffix keeps it out of browser bundles.
// Risk tier comes ONLY from this table — never from the AI model.
// Syntax is ILLUSTRATIVE; verify against HPE NonStop docs and edit here.

export type RiskTier = "read-only" | "low-risk" | "high-risk";
export type CommandId = "status_cpu" | "status_tmf" | "status_disk" | "measure_cpu" | "restart_process";

export interface AllowedCommand {
  id: CommandId;
  pattern: string; // matched after trim, whitespace-collapse, uppercase
  description: string;
  risk: RiskTier;
  blastRadius?: string; // required for high-risk
}

export const ALLOWLIST: readonly AllowedCommand[] = [
  { id: "status_cpu", pattern: "SCF STATUS CPU *", description: "Per-CPU state and load", risk: "read-only" },
  { id: "status_tmf", pattern: "TMFCOM STATUS TMF", description: "TMF subsystem status", risk: "read-only" },
  { id: "status_disk", pattern: "SCF STATUS DISK $*", description: "Disk volume status", risk: "read-only" },
  {
    id: "measure_cpu",
    pattern: "MEASCOM ADD CPU *",
    description: "Start a Measure performance collection on all CPUs",
    risk: "low-risk",
  },
  {
    id: "restart_process",
    pattern: "SCF RESTART PROCESS $PAYAUTH",
    description: "Restart the payment authorization process pair",
    risk: "high-risk",
    blastRadius:
      "Payment authorizations in flight may fail or time out for ~10-30s while the backup takes over. " +
      "Affects all ATM/POS card authorizations routed through $PAYAUTH. If the backup is unhealthy, payments stop entirely until manual recovery.",
  },
];
