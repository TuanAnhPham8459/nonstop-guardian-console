import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AuditEvent, AuditRecord } from "@/adapters/types";

type Insert = Database["public"]["Tables"]["audit_log"]["Insert"];

function db() {
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient<Database>(process.env["SUPABASE_URL"]!, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

export async function appendAudit(e: AuditEvent & { session_id: string }) {
  const row: Insert = {
    session_id: e.session_id,
    actor: e.actor,
    event_type: e.event_type,
    question: e.question ?? null,
    command: e.command ?? null,
    risk: e.risk ?? null,
    output: e.output ?? null,
    interpretation: e.interpretation ?? null,
    detail: e.detail ?? null,
  };
  const { error } = await db().from("audit_log").insert(row);
  if (error) console.error("audit insert failed", error);
  return { ok: !error };
}

export async function listAudit(): Promise<AuditRecord[]> {
  const { data, error } = await db().from("audit_log").select("*").order("created_at", { ascending: false }).limit(500);
  if (error) {
    console.error("audit read failed", error);
    return [];
  }
  return data.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    session_id: r.session_id,
    actor: r.actor as AuditRecord["actor"],
    event_type: r.event_type as AuditRecord["event_type"],
    question: r.question ?? undefined,
    command: r.command ?? undefined,
    risk: r.risk ?? undefined,
    output: r.output ?? undefined,
    interpretation: r.interpretation ?? undefined,
    detail: r.detail ?? undefined,
  }));
}
