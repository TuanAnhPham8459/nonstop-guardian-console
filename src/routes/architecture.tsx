import { createFileRoute } from "@tanstack/react-router";
import { SimBanner } from "@/components/SimBanner";

export const Route = createFileRoute("/architecture")({
  head: () => ({
    meta: [
      { title: "Architecture — NonStop Ops Assistant" },
      { name: "description", content: "Host system, swappable adapters and core pipeline of the ops assistant prototype." },
      { property: "og:title", content: "Architecture — NonStop Ops Assistant" },
      { property: "og:description", content: "How the assistant plugin, adapters and core pipeline fit together." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Arch,
});

function Box({ title, sub, items, tone }: { title: string; sub: string; items: string[]; tone: string }) {
  return (
    <div className={`arch-box arch-${tone}`}>
      <div className="text-sm font-semibold">{title}</div>
      <div className="mb-2 text-[11px] text-muted-foreground">{sub}</div>
      <ul className="space-y-1 font-mono text-[11px]">{items.map((i) => <li key={i}>{i}</li>)}</ul>
    </div>
  );
}

const Arrow = ({ label }: { label: string }) => (
  <div className="flex flex-col items-center py-2 font-mono text-[10px] text-muted-foreground">
    <span>│</span><span>{label}</span><span>▼</span>
  </div>
);

function Arch() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SimBanner />
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="mb-6 text-xl font-semibold">Architecture</h1>
        <Box tone="host" title="Host system" sub="Customer's existing operations tool (simulated Host Terminal)"
          items={["Terminal prompt + scrolling output", "Monitoring tiles", "Exposes HostBridge only"]} />
        <Arrow label="getSessionContext() · sendCommand(cmd) after approval" />
        <Box tone="core" title="Assistant panel + Core pipeline" sub="Plugin docked to the host; calls adapters through interfaces only"
          items={["ask(question) → knowledge.search → model.complete", "approveAndRun(cmd) → host.sendCommand → model.complete", "every step → audit.log"]} />
        <Arrow label="interface calls" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Box tone="adapter" title="EnvironmentAdapter" sub="runCommand · getState" items={["impl: MockEnvironment"]} />
          <Box tone="adapter" title="KnowledgeAdapter" sub="search" items={["impl: mock runbooks"]} />
          <Box tone="adapter" title="ModelAdapter" sub="complete" items={["impl: placeholder (no AI)"]} />
          <Box tone="adapter" title="AuditAdapter" sub="log" items={["impl: in-memory log"]} />
        </div>
        <p className="note mt-6">Production deployment replaces EnvironmentAdapter with a real connection.</p>
      </div>
    </div>
  );
}
