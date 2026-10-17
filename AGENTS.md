<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Backend access goes through adapter interfaces in src/adapters/types.ts; core pipeline (src/core) never imports concrete adapters — keeps backends swappable.
- The assistant panel talks to the host only via HostBridge (getSessionContext, sendCommand) — keeps it a detachable plugin.
- The simulated NonStop environment lives in src/mock-env (scenario data + server-only allowlist.server.ts) and is served via src/lib/mock-env.functions.ts; every command-handling function calls validateCommand() and risk tiers come only from the allowlist, never the model — keeps policy authoritative and server-side.
- AI calls go through the single callModel() in src/assistant/model.server.ts (swap provider there); src/assistant/assistant.server.ts enforces schema (1 retry), allowlist, known source IDs and risk tier in code; served by src/lib/assistant.functions.ts.
- Knowledge notes live in the knowledge_notes table (Lovable Cloud), accessed only via src/knowledge/notes.server.ts with a publishable server client; anon may only read and insert expert-note rows (RLS) — no accounts in this prototype.
- The app's MCP server lives in src/lib/mcp (one defineTool per file, registered in index.ts, mcpPlugin in vite.config.ts); it is public read-only, uses only the anon client, and exposes no command execution — keeps outside agents unable to change the simulation or bypass operator approval.
- Rehearsal mode is a ModelAdapter wrapper (src/adapters/rehearsal-model.ts) that replays cached/scripted replies but re-reads risk tiers from the policy adapter — keeps the offline fallback inside the adapter boundary.
- Playbooks live in the playbooks table (Lovable Cloud), accessed only via src/playbooks/playbooks.server.ts; trigger matching, never_do ranking, provenance and conflict-skipping run in code (applyPlaybooks), never in the model; only approved playbooks influence the assistant and approval requires a different name than the author.
