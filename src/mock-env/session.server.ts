import { getCookie, setCookie } from "@tanstack/react-start/server";
import { createEngine, type SerializedSimulation } from "./engine.server";
import type { CommandResult } from "@/adapters/types";

// A server-issued HttpOnly capability isolates anonymous demo browsers. Only its
// hash is stored; neither the capability nor private snapshots are exposed by MCP.
async function sessionDb() {
  let capability = getCookie("guardian-simulation");
  if (!capability || !/^[a-f0-9]{64}$/.test(capability)) {
    capability = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
    setCookie("guardian-simulation", capability, { httpOnly: true, sameSite: "lax", secure: process.env["NODE_ENV"] === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(capability));
  const owner = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  // Privileged persistence is restricted to the verified browser capability.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { db: supabaseAdmin, owner };
}

export async function simulationSession(action: "read" | "run" | "reset" | "advance" = "read", input?: { command?: string; scenario?: string | undefined; operationId?: string | undefined }) {
  const { db, owner } = await sessionDb();
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data: row, error } = await db.from("simulation_sessions").select("snapshot,revision").eq("owner_hash", owner).maybeSingle();
    if (error) throw new Error("Simulation state could not be loaded. Progress was not reset.");
    if (!row) {
      const snapshot = createEngine().snapshot();
      const { error: insertError } = await db.from("simulation_sessions").upsert({ owner_hash: owner, snapshot: JSON.parse(JSON.stringify(snapshot)) }, { onConflict: "owner_hash", ignoreDuplicates: true });
      if (insertError) throw new Error("Simulation session could not be created.");
      continue;
    }
    const engine = createEngine(row.snapshot as unknown as SerializedSimulation);
    const state = () => ({ ...engine.getState(), revision: row.revision });
    if (action === "read") return { state: state(), executed: engine.executedOptionIds(), result: null, clock: engine.getState().clock ?? "", messages: [] as string[] };
    let result: CommandResult | null = null;
    let messages: string[] = [];
    if (action === "reset") engine.resetScenario(input?.scenario);
    if (action === "advance") messages = engine.advanceTime(15).messages;
    if (action === "run") {
      const id = input?.operationId;
      const prior = id ? engine.getState().receipts?.[id] : undefined;
      if (prior) return { state: state(), result: { ...prior, state: state() }, executed: engine.executedOptionIds(), clock: engine.getState().clock ?? "", messages };
      const command = input?.command ?? "";
      result = command.trim().toLowerCase() === "help" ? { command, output: engine.commandHelp(), exitCode: 0 } : engine.runCommand(command);
      result.status ??= result.exitCode === 0 ? "succeeded" : "failed";
      const snapshot = engine.snapshot();
      if (id) snapshot.receipts[id] = result;
      engine.events.push({ command, output: result.output.join("\n"), detail: `Simulated execution ${result.status}; exit code ${result.exitCode}; operation ${id ?? "manual"}` });
    }
    const snapshot = engine.snapshot();
    const { data: committed, error: commitError } = await db.rpc("commit_simulation", {
      p_owner: owner, p_revision: row.revision,
      p_snapshot: JSON.parse(JSON.stringify(snapshot)), p_events: JSON.parse(JSON.stringify(engine.events)),
    });
    if (commitError) throw new Error("Simulation update could not be saved. Execution is unconfirmed; refresh to reconcile.");
    if (!committed) continue; // Recompute pure transitions after another tab wins; no external execution.
    const nextState = { ...engine.getState(), revision: row.revision + 1 };
    return { state: nextState, result: result ? { ...result, state: nextState } : null, executed: engine.executedOptionIds(), clock: nextState.clock ?? "", messages };
  }
  throw new Error("Simulation is busy in another tab. No command was confirmed; refresh before retrying.");
}