import { ALLOWLIST, type AllowedCommand } from "./allowlist.server";

// Shared validation used by EVERY backend function that touches a command.
export type Validation =
  | { ok: true; entry: AllowedCommand; normalized: string }
  | { ok: false; reason: string; normalized: string };

export const normalize = (cmd: string) => cmd.trim().replace(/\s+/g, " ").toUpperCase();

const MAX_LEN = 200;
const FORBIDDEN = /[;|&`<>\n\r]/;

export function validateCommand(raw: unknown): Validation {
  if (typeof raw !== "string") return { ok: false, reason: "Command must be a string", normalized: "" };
  const normalized = normalize(raw);
  if (!normalized) return { ok: false, reason: "Command is empty", normalized };
  if (raw.length > MAX_LEN) return { ok: false, reason: `Command exceeds ${MAX_LEN} characters`, normalized };
  if (FORBIDDEN.test(raw)) return { ok: false, reason: "Command chaining or redirection characters are not allowed", normalized };
  const entry = ALLOWLIST.find((c) => c.pattern === normalized);
  if (!entry) return { ok: false, reason: "command not recognized: not on the allowlist", normalized };
  return { ok: true, entry, normalized };
}
