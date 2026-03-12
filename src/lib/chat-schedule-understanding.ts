import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import {
  formatSlot,
  getApproximateTimeWindowByKey,
  hasParsedPreferenceSignal,
  parsePreference,
  ParsedPreference,
} from "@/lib/chat-domain";
import { demoConfig } from "@/lib/config";
import { ChatSession } from "@/lib/types";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeSchema = z.string().regex(/^\d{2}:\d{2}$/);

const scheduleInterpretationSchema = z.object({
  intent: z.enum(["schedule_request", "not_schedule", "unclear"]),
  requestKind: z.enum([
    "none",
    "first_available",
    "specific_date",
    "date_range",
    "weekday",
    "period_only",
    "time_window",
    "exact_time",
    "mixed_preference",
  ]),
  date: dateSchema.nullable(),
  startDate: dateSchema.nullable(),
  endDate: dateSchema.nullable(),
  weekday: z.number().int().min(0).max(6).nullable(),
  weekdayOccurrence: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal("last"),
  ]).nullable(),
  exactTime: timeSchema.nullable(),
  period: z.enum(["morning", "afternoon", "evening"]).nullable(),
  timeWindowKey: z
    .enum([
      "near_noon",
      "midday",
      "late_morning",
      "early_afternoon",
      "after_lunch",
    ])
    .nullable(),
  weekendRequested: z.boolean(),
  confidence: z.enum(["low", "medium", "high"]),
});

export type ScheduleInterpretation = {
  source: "llm" | "heuristic";
  intent: z.infer<typeof scheduleInterpretationSchema>["intent"];
  requestKind: z.infer<typeof scheduleInterpretationSchema>["requestKind"];
  confidence: z.infer<typeof scheduleInterpretationSchema>["confidence"];
  preference: ParsedPreference;
};

const scheduleInterpreterModel = demoConfig.hasAnthropicKey
  ? new ChatAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: demoConfig.anthropicModel,
      temperature: 0,
      maxTokens: 260,
      maxRetries: 2,
    }).withStructuredOutput(scheduleInterpretationSchema, {
      method: "jsonSchema",
    })
  : null;

function getLastAssistantMessage(session: ChatSession): string {
  const assistantMessages = session.messages.filter(
    (message) => message.role === "assistant",
  );

  return assistantMessages.at(-1)?.text ?? "sem mensagem anterior";
}

function formatOfferedSlots(session: ChatSession): string {
  if (session.offeredSlots.length === 0) {
    return "nenhum slot listado";
  }

  return session.offeredSlots
    .slice(0, 4)
    .map((slot, index) => `${index + 1}. ${formatSlot(slot)}`)
    .join("\n");
}

function mapInterpretationPreference(
  result: z.infer<typeof scheduleInterpretationSchema>,
): ParsedPreference {
  return {
    date: result.date ?? undefined,
    startDate: result.startDate ?? undefined,
    endDate: result.endDate ?? undefined,
    weekday: result.weekday ?? undefined,
    weekdayOccurrence: result.weekdayOccurrence ?? undefined,
    exactTime: result.exactTime ?? undefined,
    period: result.period ?? undefined,
    timeWindow: getApproximateTimeWindowByKey(result.timeWindowKey),
    weekendRequested: result.weekendRequested || undefined,
  };
}

function fallbackRequestKind(preference: ParsedPreference): ScheduleInterpretation["requestKind"] {
  if (!hasParsedPreferenceSignal(preference)) {
    return "none";
  }

  if (preference.startDate || preference.endDate) {
    return "date_range";
  }

  if (preference.date && preference.exactTime) {
    return "mixed_preference";
  }

  if (preference.date) {
    return "specific_date";
  }

  if (preference.weekday !== undefined) {
    return "weekday";
  }

  if (preference.timeWindow) {
    return "time_window";
  }

  if (preference.exactTime) {
    return "exact_time";
  }

  if (preference.period) {
    return "period_only";
  }

  return "mixed_preference";
}

function buildHeuristicFallback(userText: string): ScheduleInterpretation {
  const preference = parsePreference(userText);

  return {
    source: "heuristic",
    intent: hasParsedPreferenceSignal(preference) ? "schedule_request" : "not_schedule",
    requestKind: fallbackRequestKind(preference),
    confidence: hasParsedPreferenceSignal(preference) ? "medium" : "low",
    preference,
  };
}

export async function resolveScheduleUnderstanding(
  session: ChatSession,
  userText: string,
): Promise<ScheduleInterpretation> {
  const model = scheduleInterpreterModel;
  if (!userText.trim()) {
    return buildHeuristicFallback(userText);
  }

  if (!model) {
    return buildHeuristicFallback(userText);
  }

  const systemPrompt = `
<role>Classifique apenas o significado de agenda da mensagem do paciente em um chat odontológico.</role>
<task>Retorne só a estrutura pedida pelo schema, sem texto extra.</task>
<rules>
- Entenda português informal, erros de digitação, misturas com espanhol e frases incompletas.
- Se a pessoa pedir o horário mais próximo, o primeiro disponível, o mais cedo, o que tiver primeiro, ou algo equivalente, use intent="schedule_request" e requestKind="first_available".
- Só preencha date, startDate, endDate, weekday, weekdayOccurrence, exactTime, period ou timeWindowKey quando estiver claro o suficiente.
- Use weekday com 0=domingo, 1=segunda, 2=terça, 3=quarta, 4=quinta, 5=sexta, 6=sábado.
- Use date, startDate e endDate em formato YYYY-MM-DD.
- Use exactTime em formato HH:MM de 24 horas.
- Se a pessoa disser "essa semana", "nesta semana" ou equivalente, devolva startDate e endDate para a semana corrente.
- Se a pessoa disser "próxima semana", "semana que vem" ou equivalente, devolva startDate e endDate para a próxima semana.
- Se não for um pedido de agenda, use intent="not_schedule".
- Se houver contexto de agenda e a mensagem parecer uma continuação curta como "o mais próximo?" ou "qual período mais próximo?", trate como schedule_request.
</rules>
  `.trim();

  const userPrompt = `
<today>${new Date().toISOString().slice(0, 10)}</today>
<context>
<stage>${session.stage}</stage>
<assistant_last_message>${getLastAssistantMessage(session)}</assistant_last_message>
<selected_slot>${session.selectedSlot ? formatSlot(session.selectedSlot) : "nenhum"}</selected_slot>
<offered_slots>
${formatOfferedSlots(session)}
</offered_slots>
</context>
<user_message>${userText}</user_message>
  `.trim();

  try {
    const result = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ]);

    return {
      source: "llm",
      intent: result.intent,
      requestKind: result.requestKind,
      confidence: result.confidence,
      preference: mapInterpretationPreference(result),
    };
  } catch {
    return buildHeuristicFallback(userText);
  }
}
