// SERVER-ONLY allowlist of commands. The *.server.ts suffix keeps it out of browser bundles.
// Risk tier comes ONLY from this table — never from the AI model.
// syntaxStatus "confirmed" = names/syntax documented by HPE; "illustrative" = invented for the demo.
// Every scenario option action in scenarios.json must appear here.

export type RiskTier = "read-only" | "low-risk" | "high-risk";
export type SyntaxStatus = "confirmed" | "illustrative";
export type CommandId =
  | "status_process" | "tmf_status" | "tmf_status_transactions" | "tmf_status_audittrail" | "tmf_status_datavols"
  | "show_session" | "show_tables" | "show_lasterror" | "set_timing" | "set_statistics" | "get_statistics" | "spool"
  | "option"; // scenario option actions dispatched by the engine

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

  // --- Scenario options (cpu-failure) ---
  { id: "option", pattern: "OPEN HARDWARE TICKET + NOTIFY ON-CALL", description: "Open a hardware ticket and page the on-call engineer", risk: "read-only", syntaxStatus: "illustrative" },
  { id: "option", pattern: "THROTTLE BATCH QUEUE LOW", description: "Slow batch work to free capacity for payments", risk: "low-risk", syntaxStatus: "illustrative" },
  { id: "option", pattern: "START BACKUP FOR $PAYAUTH1 ON CPU 7", description: "Start a backup for a process on another CPU", risk: "low-risk", syntaxStatus: "illustrative" },
  {
    id: "option", pattern: "ABORT PROCESS $ZZKRN.#RPTGEN", description: "Abort the report generator process", risk: "high-risk", syntaxStatus: "confirmed",
    blastRadius: "The report generator stops and in-progress reports are lost; the business must re-run them later.",
  },
  {
    id: "option", pattern: "RESTORE CPU 3", description: "Restore a CPU after repair (second operator required)", risk: "high-risk", syntaxStatus: "illustrative",
    blastRadius: "Restoring an unrepaired CPU can fail again mid-reintegration, forcing another takeover cycle and a worse outage window.",
  },
  {
    id: "option", pattern: "RESTART TMF", description: "Restart the transaction manager (TRAP — causes an outage)", risk: "high-risk", syntaxStatus: "illustrative",
    blastRadius: "Affects EVERY transaction on the node: all in-flight transactions are backed out and new ones are blocked until TMF is back. Last resort only.",
  },

  // --- Scenario options (disk-degraded) ---
  { id: "option", pattern: "SCF STATUS DISK $DATA01, DETAIL", description: "Detailed disk status (one-time)", risk: "read-only", syntaxStatus: "illustrative" },
  { id: "option", pattern: "SWITCH STORAGE PATH $DATA01", description: "Switch a volume to its alternate path", risk: "low-risk", syntaxStatus: "illustrative" },
  { id: "option", pattern: "PAUSE REPORTING JOBS ON $DATA01", description: "Pause reporting jobs to ease disk load", risk: "low-risk", syntaxStatus: "illustrative" },
  {
    id: "option", pattern: "REVIVE MIRROR $DATA01", description: "Re-sync a mirrored volume", risk: "high-risk", syntaxStatus: "illustrative",
    blastRadius: "Revive copies the whole volume and adds heavy I/O for its duration. At full load this can slow every application using $DATA01, including card ledger writes.",
  },
  {
    id: "option", pattern: "MOVE HOT FILES TO $DATA02", description: "Move hot files off the degraded volume", risk: "high-risk", syntaxStatus: "illustrative",
    blastRadius: "$DATA02 is 91% full; moving hot files there risks filling it and blocking writes.",
  },
  {
    id: "option", pattern: "PROMOTE STANDBY VOLUME $DATA01S", description: "Promote a standby volume to active (second operator required)", risk: "high-risk", syntaxStatus: "illustrative",
    blastRadius: "Applications pointing at the old volume must be re-pointed; until they are, reads and writes fail. The standby becomes a single point of failure.",
  },
  {
    id: "option", pattern: "STOP DISK $DATA01", description: "Take a disk volume offline (TRAP — causes an outage)", risk: "high-risk", syntaxStatus: "illustrative",
    blastRadius: "Takes $DATA01 offline: all data on it becomes unavailable to every application until it is started again.",
  },

  // --- Scenario options (txn-backlog) ---
  { id: "option", pattern: "PAUSE BATCH FEEDER", description: "Stop new batch work entering the queue", risk: "low-risk", syntaxStatus: "illustrative" },
  { id: "option", pattern: "NOTIFY APPLICATION OWNER", description: "Page the owner of the blocking transaction", risk: "read-only", syntaxStatus: "illustrative" },
  { id: "option", pattern: "ADD PAYAUTH SERVER INSTANCES (+2)", description: "Add payment server instances", risk: "low-risk", syntaxStatus: "illustrative" },
  {
    id: "option", pattern: "ABORT TRANSACTION 4821", description: "Back out a specific long-running transaction", risk: "high-risk", syntaxStatus: "illustrative",
    blastRadius: "Rolls back all work done by the transaction. If it is a legitimate settlement run, that work is lost and must be re-run; its locks are released only after backout completes.",
  },
];
