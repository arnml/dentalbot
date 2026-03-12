"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ChatMessage, ChatResponse, DemoBudgetStatus } from "@/lib/types";

interface ChatApiResponse extends ChatResponse {
  summary: string;
}

interface ChatApiError {
  error?: string;
  demoBudget?: DemoBudgetStatus;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

export function ChatBookingAssistant() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [summary, setSummary] = useState("Carregando conversa...");
  const [demoBudget, setDemoBudget] = useState<DemoBudgetStatus | null>(null);
  const [input, setInput] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void fetch("/api/chat")
      .then((response) => response.json())
      .then((payload: ChatApiResponse) => {
        setSessionId(payload.sessionId);
        setMessages(payload.messages);
        setSummary(payload.summary);
        setDemoBudget(payload.demoBudget ?? null);
      })
      .catch(() => {
        setErrorMessage("Não consegui iniciar a conversa agora.");
      });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function applyPayload(payload: ChatApiResponse) {
    setSessionId(payload.sessionId);
    setMessages(payload.messages);
    setSummary(payload.summary);
    setDemoBudget(payload.demoBudget ?? null);
  }

  function createOptimisticMessage(text: string): ChatMessage {
    return {
      id: `optimistic-${crypto.randomUUID()}`,
      role: "user",
      text,
      createdAt: new Date().toISOString(),
    };
  }

  function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || demoBudget?.exhausted) {
      if (demoBudget?.exhausted) {
        setErrorMessage(
          "O orçamento diário desta demo acabou por hoje. Volte amanhã para testar de novo.",
        );
      }
      return;
    }

    const previousMessages = messages;
    setErrorMessage(null);
    setMessages((current) => [...current, createOptimisticMessage(trimmed)]);
    setInput("");

    startTransition(() => {
      void fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId,
          message: trimmed,
        }),
      })
        .then(async (response) => {
          const payload = (await response.json()) as ChatApiResponse | ChatApiError;

          if ("demoBudget" in payload && payload.demoBudget) {
            setDemoBudget(payload.demoBudget);
          }

          if (!response.ok) {
            const message = "error" in payload ? payload.error : undefined;
            throw new Error(message ?? "Não consegui processar sua mensagem.");
          }

          applyPayload(payload as ChatApiResponse);
        })
        .catch((error: Error) => {
          setMessages(previousMessages);
          setErrorMessage(error.message);
        });
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendMessage(input);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage(input);
    }
  }

  function handleReset() {
    setErrorMessage(null);

    startTransition(() => {
      void fetch(`/api/chat${sessionId ? `?sessionId=${sessionId}` : ""}`, {
        method: "DELETE",
      })
        .then((response) => response.json())
        .then((payload: ChatApiResponse) => {
          applyPayload(payload);
        })
        .catch(() => {
          setErrorMessage("Não consegui reiniciar a conversa agora.");
        });
      });
  }

  const budgetUsageWidth = `${Math.min(100, demoBudget?.usagePercent ?? 0)}%`;
  const isBudgetExhausted = demoBudget?.exhausted ?? false;
  const isBudgetLoaded = demoBudget !== null;
  const budgetToneClass = !isBudgetLoaded
    ? "border-white/10 bg-black/55 text-slate-200"
    : isBudgetExhausted
      ? "border-rose-400/30 bg-rose-500/12 text-rose-100"
      : "border-emerald-400/20 bg-emerald-500/10 text-emerald-100";
  const budgetStatusLabel = !isBudgetLoaded
    ? "Carregando"
    : !demoBudget.enabled
      ? "Local"
      : isBudgetExhausted
        ? "Encerrado"
        : `${Math.round(demoBudget.usagePercent)}%`;
  const budgetSecondaryLabel = !isBudgetLoaded
    ? "orçamento"
    : !demoBudget.enabled
      ? "sem custo"
      : isBudgetExhausted
        ? "volta amanhã"
        : `${formatUsd(demoBudget.remainingUsd)} restante`;

  return (
    <section className="panel h-full p-4 md:p-5">
      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <div className="pointer-events-none absolute right-0 top-0 z-20">
          <div
            className={`pointer-events-auto flex min-w-[132px] items-center gap-3 rounded-bl-[20px] rounded-tr-[14px] border px-3 py-2 shadow-[0_18px_40px_rgba(0,0,0,0.35)] backdrop-blur-md ${budgetToneClass}`}
          >
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em]">
                Demo
              </p>
              <p className="mt-1 text-sm leading-none text-white">{budgetStatusLabel}</p>
              <p className="mt-1 text-[11px] leading-none text-current/75">
                {budgetSecondaryLabel}
              </p>
            </div>
            {demoBudget?.enabled ? (
              <div className="h-8 w-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`w-full rounded-full transition-all duration-300 ${
                    isBudgetExhausted ? "bg-rose-300" : "bg-emerald-300"
                  }`}
                  style={{ height: budgetUsageWidth }}
                />
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-col gap-4 border-b border-white/8 pb-4 pr-28 md:flex-row md:items-center md:justify-between md:pr-36">
            <div>
              <h2 className="font-display text-2xl text-white md:text-3xl">
                Aurora Dental Atelier
              </h2>
              <p className="mt-2 text-[13px] leading-6 text-slate-300 md:text-sm">
                Agendamento dental.
              </p>
            </div>
            <button
              className="secondary-button self-start md:self-auto"
              disabled={isPending}
              onClick={handleReset}
              type="button"
            >
              Reiniciar
            </button>
          </div>

          <div className="mt-4 rounded-[22px] border border-white/8 bg-white/[0.04] px-4 py-3 text-[13px] leading-6 text-slate-300 md:text-sm">
            {summary}
          </div>

          <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex flex-col gap-3">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-[78%] rounded-sm px-4 py-1 text-[13px] leading-6 md:max-w-[72%] md:text-sm ${
                    message.role === "assistant"
                      ? "bg-white/[0.05] text-[#f5f5f5]"
                      : "ml-auto bg-[#f5f5f5] text-[#080808]"
                  }`}
                >
                  {message.text.split("\n").map((line, index) => (
                    <p key={`${message.id}-${index}`}>{line}</p>
                  ))}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          </div>

          <form className="mt-4" onSubmit={handleSubmit}>
            <div className="relative">
              <textarea
                className="input-shell min-h-8 resize-none pb-3 text-[13px] leading-6 md:text-sm"
                disabled={isPending || isBudgetExhausted}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  isBudgetExhausted
                    ? "O orçamento diário desta demo acabou. Volte amanhã."
                    : "Ex.: Oi, sou a Camila e estou com dor e sensibilidade do lado direito."
                }
                value={input}
              />
              <button
                type="submit"
                disabled={isPending || isBudgetExhausted || !input.trim()}
                className="absolute right-3 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-sm bg-[#f5f5f5] text-[#080808] transition duration-150 hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor">
                  <path d="M1 1l10 6-10 6V1z" />
                </svg>
              </button>
            </div>
          </form>

          {errorMessage ? (
            <div className="mt-4 rounded-[24px] border border-rose-400/20 bg-rose-500/10 px-5 py-4 text-[13px] leading-6 text-rose-200 md:text-sm">
              {errorMessage}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
