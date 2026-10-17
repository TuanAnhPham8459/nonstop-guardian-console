import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// SERVER-ONLY access to the knowledge_notes table. Source IDs are authoritative here.
export type NoteRow = Database["public"]["Tables"]["knowledge_notes"]["Row"];
export interface KnowledgeNote {
  id: string;
  title: string;
  body: string;
  source_type: string;
  contributed_by: string;
}

function db() {
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient<Database>(url, key, {
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

export const toNote = (r: NoteRow): KnowledgeNote => ({
  id: r.id,
  title: r.title,
  body: `Symptoms: ${r.symptoms} Cause: ${r.cause} Check first: ${r.what_to_check_first}`,
  source_type: r.source_type,
  contributed_by: r.contributed_by,
});

export async function allNotes(): Promise<KnowledgeNote[]> {
  const { data, error } = await db().from("knowledge_notes").select("*").order("created_at");
  if (error) {
    console.error("knowledge_notes read failed", error);
    return [];
  }
  return data.map(toNote);
}

const STOP = new Set(["the", "and", "what", "why", "how", "should", "this", "that", "with", "for", "are", "high", "now"]);

// Simple keyword scoring.
export function rankNotes(notes: KnowledgeNote[], query: string, limit = 4): KnowledgeNote[] {
  const words = query.toLowerCase().split(/[^a-z0-9$]+/).filter((w) => w.length > 2 && !STOP.has(w));
  const scored = notes.map((n) => {
    const hay = `${n.title} ${n.body}`.toLowerCase();
    return { n, score: words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0) };
  });
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.n);
}

export async function searchKnowledge(query: string, limit = 4) {
  const notes = await allNotes();
  return { hits: rankNotes(notes, query, limit), ids: new Set(notes.map((n) => n.id)) };
}

export async function getNote(id: string): Promise<KnowledgeNote | null> {
  const { data } = await db().from("knowledge_notes").select("*").eq("id", id).maybeSingle();
  return data ? toNote(data) : null;
}

export async function addExpertNote(n: {
  title: string;
  symptoms: string;
  cause: string;
  what_to_check_first: string;
  contributed_by: string;
}): Promise<{ id: string } | { error: string }> {
  const id = `KN-${Date.now().toString(36).toUpperCase()}`;
  const { error } = await db()
    .from("knowledge_notes")
    .insert({ ...n, id, source_type: "expert-note" });
  if (error) {
    console.error("debrief insert failed", error);
    return { error: "Could not save the debrief." };
  }
  return { id };
}
