"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ChatMessage, ChatResponse } from "@/lib/types";

interface ChatApiResponse extends ChatResponse {
  summary: string;
}

export function ChatBookingAssistant() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [summary, setSummary] = useState("Carregando conversa...");
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
        setQuickReplies(payload.quickReplies);
        setSummary(payload.summary);
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
    setQuickReplies(payload.quickReplies);
    setSummary(payload.summary);
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
    if (!trimmed) {
      return;
    }

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
          const payload = (await response.json()) as
            | ChatApiResponse
            | { error?: string };

          if (!response.ok) {
            const message = "error" in payload ? payload.error : undefined;
            throw new Error(message ?? "Não consegui processar sua mensagem.");
          }

          applyPayload(payload as ChatApiResponse);
        })
        .catch((error: Error) => {
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

  return (
    <section className="panel h-full p-4 md:p-5">
      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-col gap-4 border-b border-white/8 pb-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-display text-2xl text-white md:text-3xl">
                Aurora Dental Atelier
              </h2>
              <p className="mt-2 text-[13px] leading-6 text-slate-300 md:text-sm">
                Fala do seu jeito. O assistente entende os sintomas, indica o especialista e fecha o horário.
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

          <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="flex flex-col gap-3">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-[78%] rounded-sm px-4 py-3 text-[13px] leading-6 md:max-w-[72%] md:text-sm ${
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

          <div className="mt-4 flex flex-wrap gap-2">
            {quickReplies.map((reply) => (
              <button
                key={reply}
                className="secondary-button px-4 py-2 text-[11px]"
                disabled={isPending}
                onClick={() => sendMessage(reply)}
                type="button"
              >
                {reply}
              </button>
            ))}
          </div>

          <form className="mt-4 flex flex-col gap-3" onSubmit={handleSubmit}>
            <textarea
              className="input-shell min-h-24 resize-none text-[13px] leading-6 md:text-sm"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ex.: Oi, sou a Camila e estou com dor e sensibilidade do lado direito."
              value={input}
            />
            <p className="text-[12px] text-slate-400">
              Enter envia. Shift+Enter quebra linha.
            </p>
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
