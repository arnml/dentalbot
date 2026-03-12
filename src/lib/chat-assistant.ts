import {
  buildSessionSummary,
  createInitialChatSession,
  getQuickRepliesForSession,
} from "@/lib/chat-domain";
import { processChatTurnWithAgent } from "@/lib/chat-agent";
import { demoConfig } from "@/lib/config";
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
  if (!demoConfig.hasAnthropicKey) {
    return runChatTurnGraph(session, userText);
  }

  try {
    return await processChatTurnWithAgent(session, userText);
  } catch {
    return runChatTurnGraph(session, userText);
  }
}
