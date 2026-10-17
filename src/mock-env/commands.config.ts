// ILLUSTRATIVE command syntax — verify against HPE NonStop docs and edit here only.
// `pattern` is matched after trimming, collapsing whitespace and uppercasing.

export type CommandId = "status_cpu" | "status_tmf" | "status_disk" | "restart_process";
export type Risk = "read-only" | "high-risk";

export interface CommandDef {
  id: CommandId;
  pattern: string;
  risk: Risk;
  description: string;
}

export const COMMANDS: CommandDef[] = [
  { id: "status_cpu", pattern: "SCF STATUS CPU *", risk: "read-only", description: "Per-CPU state and load" },
  { id: "status_tmf", pattern: "TMFCOM STATUS TMF", risk: "read-only", description: "TMF subsystem status" },
  { id: "status_disk", pattern: "SCF STATUS DISK $*", risk: "read-only", description: "Disk volume status" },
  { id: "restart_process", pattern: "SCF RESTART PROCESS $PAYAUTH", risk: "high-risk", description: "Restart the payment authorization process" },
];

export const normalize = (cmd: string) => cmd.trim().replace(/\s+/g, " ").toUpperCase();

export function matchCommand(cmd: string): CommandDef | undefined {
  const n = normalize(cmd);
  return COMMANDS.find((c) => c.pattern === n);
}
