import type { CheckedCommand, CommandResult } from "@/adapters/types";

export type ExecutionState = "pending" | "approved" | "running" | "succeeded" | "failed" | "rejected" | "awaiting-second-operator" | "uncertain";
export type ConversationMessage =
  | { role: "op" | "ai" | "err" | "uncertain"; text: string }
  | { role: "blocked"; items: { command: string; reason: string }[] }
  | { role: "proposal"; cls: CheckedCommand; state: ExecutionState; operationId?: string }
  | { role: "result"; cmd: string; output: string[] }
  | { role: "playbook"; text: string; conflicts: string[] };
export interface Conversation { id: string; title: string; msgs: ConversationMessage[]; input: string; briefed: boolean }
export const CHAT_KEY = "guardian-conversations-v1";
export function readConversations(storage: Pick<Storage, "getItem">): Conversation[] {
  try {
    const value = JSON.parse(storage.getItem(CHAT_KEY) ?? "null");
    return value?.version === 1 && Array.isArray(value.conversations) ? value.conversations.filter((c: Conversation) => typeof c.id === "string" && Array.isArray(c.msgs) && typeof c.input === "string") : [];
  } catch { return []; }
}
export function saveConversation(storage: Pick<Storage, "getItem" | "setItem">, conversation: Conversation) {
  const others = readConversations(storage).filter(c => c.id !== conversation.id);
  storage.setItem(CHAT_KEY, JSON.stringify({ version: 1, conversations: [...others, conversation] }));
}
export function reconcileMessages(msgs: ConversationMessage[], receipts: Record<string, CommandResult> = {}): ConversationMessage[] {
  const restoredOutputs: ConversationMessage[] = [];
  const reconciled = msgs.map(m => {
    if (m.role !== "proposal" || !["running", "approved", "uncertain"].includes(m.state)) return m;
    const receipt = m.operationId ? receipts[m.operationId] : undefined;
    if (receipt && !msgs.some(item => item.role === "result" && item.cmd === receipt.command && item.output.join("\n") === receipt.output.join("\n"))) {
      restoredOutputs.push({ role: "result", cmd: receipt.command, output: receipt.output });
    }
    return { ...m, state: receipt ? receipt.status === "awaiting-second-operator" ? receipt.status : receipt.exitCode === 0 ? "succeeded" : "failed" : "uncertain" };
  });
  return [...reconciled, ...restoredOutputs] as ConversationMessage[];
}