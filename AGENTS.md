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
