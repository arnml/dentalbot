import { ChatResponse, ChatSession } from "@/lib/types";

declare global {
  var __auroraChatSessions: Map<string, ChatSession> | undefined;
}

const sessions = globalThis.__auroraChatSessions ?? new Map<string, ChatSession>();

if (!globalThis.__auroraChatSessions) {
  globalThis.__auroraChatSessions = sessions;
}

export function createChatSession(session: ChatSession): ChatSession {
  sessions.set(session.id, session);
  return session;
}

export function getChatSession(sessionId: string): ChatSession | undefined {
  return sessions.get(sessionId);
}

export function saveChatSession(session: ChatSession): ChatSession {
  sessions.set(session.id, session);
  return session;
}

export function deleteChatSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export function toChatResponse(
  session: ChatSession,
  quickReplies: string[],
): ChatResponse {
  return {
    sessionId: session.id,
    messages: session.messages,
    stage: session.stage,
    quickReplies,
    recommendation: session.recommendation,
    offeredSlots: session.offeredSlots,
    selectedSlot: session.selectedSlot,
  };
}
