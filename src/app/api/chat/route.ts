import { NextRequest, NextResponse } from "next/server";
import {
  buildSessionSummary,
  createInitialChatSession,
  getQuickRepliesForSession,
  processChatTurn,
} from "@/lib/chat-assistant";
import {
  getDailyDemoBudgetStatus,
  getDailyDemoBudgetMessage,
  previewDailyDemoBudget,
  recordBlockedDailyDemoRequest,
  recordDailyDemoBudgetUsage,
} from "@/lib/demo-budget";
import {
  createChatSession,
  deleteChatSession,
  getChatSession,
  saveChatSession,
  toChatResponse,
} from "@/lib/chat-store";

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  const existing = sessionId ? getChatSession(sessionId) : undefined;
  const session = existing ?? createChatSession(createInitialChatSession());

  return NextResponse.json({
    ...toChatResponse(session, getQuickRepliesForSession(session)),
    summary: await buildSessionSummary(session),
    demoBudget: getDailyDemoBudgetStatus(),
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    sessionId?: string;
    message?: string;
  };

  if (!body.message?.trim()) {
    return NextResponse.json(
      { error: "A mensagem do chat é obrigatória." },
      { status: 400 },
    );
  }

  const session =
    (body.sessionId ? getChatSession(body.sessionId) : undefined) ??
    createChatSession(createInitialChatSession());

  const budgetPreview = previewDailyDemoBudget(session, body.message);
  if (!budgetPreview.allowed) {
    recordBlockedDailyDemoRequest();

    return NextResponse.json(
      {
        error: getDailyDemoBudgetMessage(),
        demoBudget: getDailyDemoBudgetStatus(),
      },
      { status: 429 },
    );
  }

  const result = await processChatTurn(session, body.message);
  recordDailyDemoBudgetUsage(budgetPreview.estimate);
  saveChatSession(result.session);

  return NextResponse.json({
    ...toChatResponse(result.session, result.quickReplies),
    summary: await buildSessionSummary(result.session),
    demoBudget: getDailyDemoBudgetStatus(),
  });
}

export function DELETE(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");

  if (sessionId) {
    deleteChatSession(sessionId);
  }

  const session = createChatSession(createInitialChatSession());

  return NextResponse.json({
    ...toChatResponse(session, getQuickRepliesForSession(session)),
    summary: "Conversa reiniciada.",
    demoBudget: getDailyDemoBudgetStatus(),
  });
}
