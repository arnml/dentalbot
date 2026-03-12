import {
  buildSessionSummary,
  createInitialChatSession,
  getQuickRepliesForSession,
} from "@/lib/chat-domain";
import { runChatTurnGraph } from "@/lib/chat-graph";
import { ChatSession } from "@/lib/types";

export {
  buildSessionSummary,
  createInitialChatSession,
  getQuickRepliesForSession,
};

export async function processChatTurn(
  session: ChatSession,
  userText: string,
): Promise<{ session: ChatSession; quickReplies: string[] }> {
  return runChatTurnGraph(session, userText);
}
