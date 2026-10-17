// SERVER-ONLY allowlist of commands. The *.server.ts suffix keeps it out of browser bundles.
// Risk tier comes ONLY from this table — never from the AI model.
// syntaxStatus "confirmed" = names/syntax documented by HPE; "illustrative" = invented for the demo.

export type RiskTier = "read-only" | "low-risk" | "high-risk";
export type SyntaxStatus = "confirmed" | "illustrative";
export type CommandId =
  | "status_process" | "abort_process" | "start_process"
  | "tmf_status" | "tmf_status_transactions" | "tmf_status_audittrail" | "tmf_status_datavols"
  | "show_session" | "show_tables" | "show_lasterror" | "set_timing" | "set_statistics" | "get_statistics" | "spool"
  | "throttle_batch" | "start_backup" | "restore_cpu" | "switch_path" | "revive_mirror"
  | "promote_standby" | "stop_disk" | "abort_transaction" | "restart_tmf" | "open_ticket";

export interface AllowedCommand {
  id: CommandId;
  pattern: string; // matched after trim, whitespace-collapse, uppercase
  description: string;
  risk: RiskTier;
  syntaxStatus: SyntaxStatus;
  blastRadius?: string; // required for high-risk
}

export const ALLOWLIST: readonly AllowedCommand[] = [
  // --- Confirmed: documented by HPE ---
  { id: "status_process", pattern: "STATUS PROCESS $ZZKRN.#*", description: "State of the $ZZKRN process pair (run inside SCF)", risk: "read-only", syntaxStatus: "confirmed" },
  {
    id: "abort_process", pattern: "ABORT PROCESS $ZZKRN.#PAYAUTH1", description: "Abort the named process immediately", risk: "high-risk", syntaxStatus: "confirmed",
    blastRadius:
      "Aborts $ZZKRN.#PAYAUTH1 without a clean takeover. Payment authorizations in flight fail or time out, and if the backup is unhealthy all ATM/POS authorizations through this pair stop until manual recovery.",
  },
  { id: "start_process", pattern: "START PROCESS $ZZKRN.#PAYAUTH2", description: "Start the named process under $ZZKRN", risk: "low-risk", syntaxStatus: "confirmed" },
  { id: "tmf_status", pattern: "TMFCOM STATUS TMF", description: "TMF subsystem status", risk: "read-only", syntaxStatus: "confirmed" },
  { id: "tmf_status_transactions", pattern: "TMFCOM STATUS TRANSACTIONS", description: "List active transactions and owners", risk: "read-only", syntaxStatus: "confirmed" },
  { id: "tmf_status_audittrail", pattern: "TMFCOM STATUS AUDITTRAIL", description: "Audit trail capacity and usage", risk: "read-only", syntaxStatus: "confirmed" },
  { id: "tmf_status_datavols", pattern: "TMFCOM STATUS DATAVOLS", description: "Data volumes known to TMF", risk: "read-only", syntaxStatus: "confirmed" },
  { id: "show_session", pattern: "SHOW SESSION", description: "RMXCI session attributes", risk: "read-only", syntaxStatus: "confirmed" },
  { id: "show_tables", pattern: "SHOW TABLES", description: "Tables referenced in this RMXCI session", risk: "read-only", syntaxStatus: "confirmed" },
  { id: "show_lasterror", pattern: "SHOW LASTERROR", description: "Last RMXCI error", risk: "read-only", syntaxStatus: "confirmed" },
  { id: "set_timing", pattern: "SET TIMING ON", description: "Enable timing display for statements", risk: "read-only", syntaxStatus: "confirmed" },
  { id: "set_statistics", pattern: "SET STATISTICS ON", description: "Enable statistics collection for the session", risk: "read-only", syntaxStatus: "confirmed" },
  { id: "get_statistics", pattern: "GET STATISTICS", description: "Show collected query statistics", risk: "read-only", syntaxStatus: "confirmed" },
  { id: "spool", pattern: "SPOOL $SPOOL.OUT01", description: "Log session output to a spool file", risk: "low-risk", syntaxStatus: "confirmed" },

  // --- Illustrative: invented for the demo, unverified syntax ---
  { id: "throttle_batch", pattern: "THROTTLE BATCH QUEUE", description: "Slow batch work to free capacity for payments", risk: "low-risk", syntaxStatus: "illustrative" },
  { id: "start_backup", pattern: "START BACKUP FOR $ZZKRN.#PAYAUTH1 ON CPU 6", description: "Start a backup for a process on another CPU", risk: "low-risk", syntaxStatus: "illustrative" },
  { id: "restore_cpu", pattern: "RESTORE CPU 3", description: "Restore a CPU after repair", risk: "low-risk", syntaxStatus: "illustrative" },
  { id: "switch_path", pattern: "SWITCH STORAGE PATH $DATA02", description: "Switch a volume to its alternate path", risk: "low-risk", syntaxStatus: "illustrative" },
  {
    id: "revive_mirror", pattern: "REVIVE MIRROR $DATA02", description: "Re-sync a mirrored volume", risk: "high-risk", syntaxStatus: "illustrative",
    blastRadius: "Revive copies the whole volume and adds heavy I/O for its duration. At peak this can slow every application using $DATA02, including card ledger writes.",
  },
  {
    id: "promote_standby", pattern: "PROMOTE STANDBY VOLUME $DATA03", description: "Promote a standby volume to active", risk: "high-risk", syntaxStatus: "illustrative",
    blastRadius: "Applications pointing at the old volume must be re-pointed; until they are, reads and writes fail. The standby becomes a single point of failure.",
  },
  {
    id: "stop_disk", pattern: "STOP DISK $DATA02", description: "Take a disk volume offline", risk: "high-risk", syntaxStatus: "illustrative",
    blastRadius: "Takes $DATA02 offline: all data on it becomes unavailable to every application until it is started again.",
  },
  {
    id: "abort_transaction", pattern: "ABORT TRANSACTION 4821", description: "Back out a specific long-running transaction", risk: "high-risk", syntaxStatus: "illustrative",
    blastRadius: "Rolls back all work done by transaction 4821. If it is a legitimate batch job, that work is lost and must be re-run; its locks are released only after backout completes.",
  },
  {
    id: "restart_tmf", pattern: "RESTART TMF", description: "Restart the transaction manager", risk: "high-risk", syntaxStatus: "illustrative",
    blastRadius: "Affects EVERY transaction on the node: all in-flight transactions are backed out and new ones are blocked until TMF is back. Last resort only.",
  },
  { id: "open_ticket", pattern: "OPEN HARDWARE TICKET CPU 3", description: "Open a hardware repair ticket", risk: "read-only", syntaxStatus: "illustrative" },
];
