import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { demoConfig } from "@/lib/config";
import {
  containsClinicalContext,
  extractName,
  extractSlotChoiceNumber,
  formatSlot,
  hasParsedPreferenceSignal,
  isCancellation,
  isNegative,
  isPositive,
  matchSlotChoice,
  normalize,
  parsePreference,
  ParsedPreference,
  resetRequested,
} from "@/lib/chat-domain";
import {
  resolveScheduleUnderstanding,
  ScheduleInterpretation,
} from "@/lib/chat-schedule-understanding";
import { ChatSession } from "@/lib/types";

export const chatIntentValues = [
  "restart",
  "greeting",
  "clinical_need",
  "provide_name",
  "schedule_request",
  "slot_selection",
  "confirm",
  "reject_or_change",
  "cancellation",
  "new_patient",
  "unclear",
] as const;

export const scheduleFitValues = [
  "not_applicable",
  "new_lookup",
  "contextual_lookup",
  "matches_listed_option",
  "confirm_current_slot",
  "change_current_slot",
  "clarify_needed",
] as const;

export type ChatIntent = (typeof chatIntentValues)[number];
export type ScheduleFit = (typeof scheduleFitValues)[number];

export interface ChatTurnAnalysis {
  intent: ChatIntent;
  scheduleFit: ScheduleFit;
  shouldReuseContextDate: boolean;
  selectedOptionNumber?: number;
  isUrgent?: boolean;
  parsedPreference: ParsedPreference;
}

const turnAnalysisSchema = z.object({
  intent: z.enum(chatIntentValues),
  scheduleFit: z.enum(scheduleFitValues),
  shouldReuseContextDate: z.boolean(),
  selectedOptionNumber: z.number().int().min(1).max(4).nullable(),
  confidence: z.enum(["low", "medium", "high"]),
});

const slotSelectionSchema = z.object({
  outcome: z.enum(["selected_slot", "not_selected", "ambiguous"]),
  selectedOptionNumber: z.number().int().min(1).max(4).nullable(),
  confidence: z.enum(["low", "medium", "high"]),
});

const classifierModel = demoConfig.hasAnthropicKey
  ? new ChatAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: demoConfig.anthropicModel,
      temperature: 0,
      maxTokens: 220,
      maxRetries: 2,
    }).withStructuredOutput(turnAnalysisSchema, {
      method: "jsonSchema",
    })
  : null;

const slotSelectionModel = demoConfig.hasAnthropicKey
  ? new ChatAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: demoConfig.anthropicModel,
      temperature: 0,
      maxTokens: 160,
      maxRetries: 2,
    }).withStructuredOutput(slotSelectionSchema, {
      method: "jsonSchema",
    })
  : null;

function formatAvailableSlots(session: ChatSession): string {
  if (session.offeredSlots.length === 0) {
    return "sem opções listadas no momento";
  }

  return session.offeredSlots
    .map((slot, index) => `${index + 1}. ${formatSlot(slot)}`)
    .join("\n");
}

function getLastAssistantMessage(session: ChatSession): string {
  const assistantMessages = session.messages.filter(
    (message) => message.role === "assistant",
  );

  return assistantMessages.at(-1)?.text ?? "sem mensagem anterior";
}

function getSelectedSlotContext(session: ChatSession): string {
  if (!session.selectedSlot) {
    return "nenhum horário selecionado";
  }

  return formatSlot(session.selectedSlot);
}

function getReusableContextDate(session: ChatSession): string | undefined {
  if (session.selectedSlot?.date) {
    return session.selectedSlot.date;
  }

  const uniqueDates = [...new Set(session.offeredSlots.map((slot) => slot.date))];
  return uniqueDates.length === 1 ? uniqueDates[0] : undefined;
}

function isAvailabilityQuestion(
  text: string,
  preference: ParsedPreference = parsePreference(text),
): boolean {
  const normalizedText = normalize(text);

  if (!hasParsedPreferenceSignal(preference)) {
    return false;
  }

  return (
    text.includes("?") ||
    [
      "tem ",
      "tem como",
      "teria",
      "existe",
      "consegue",
      "daria",
      "da pra",
      "dá pra",
      "perguntei se tem",
      "qual horario",
      "qual horário",
    ].some((term) => normalizedText.includes(term))
  );
}

function isBroadScheduleRequest(
  text: string,
  scheduleInterpretation?: ScheduleInterpretation,
): boolean {
  const normalizedText = normalize(text);

  return (
    scheduleInterpretation?.requestKind === "first_available" ||
    [
      "qualquer horario",
      "qualquer horário",
      "qualquer um",
      "o primeiro disponivel",
      "o primeiro disponível",
      "primeiro horario",
      "primeiro horário",
      "o que tiver",
      "tanto faz",
      "o proximo horario",
      "o próximo horário",
      "o proximo disponivel",
      "o próximo disponível",
    ].some((term) => normalizedText.includes(term))
  );
}

function detectUrgency(text: string): boolean {
  const normalizedText = normalize(text);

  const urgentTerms = [
    "dor",
    "urgencia",
    "urgente",
    "emergencia",
    "emergência",
    "inchaco",
    "inchado",
    "matando",
    "mata",
    "nao aguento",
    "não aguento",
    "impossivel",
    "impossível",
    "sangramento",
    "infeccao",
    "inflamacao",
    "inflamação",
    "quebrado",
    "quebrou",
    "lascou",
    "trincado",
    "abscessado",
    "gengivite",
  ];

  return urgentTerms.some((term) => normalizedText.includes(term));
}

export function isOffTopicQuestion(text: string): boolean {
  const normalizedText = normalize(text);

  const offTopicTerms = [
    "quanto custa",
    "qual o preco",
    "qual o preço",
    "valor",
    "caro",
    "aceita convênio",
    "convenio",
    "convênio",
    "cartão de credito",
    "pix",
    "como pago",
    "formas de pagamento",
    "horário de funcionamento",
    "endereço",
    "fica onde",
    "localização",
    "telefone",
  ];

  return offTopicTerms.some((term) => normalizedText.includes(term));
}

function getSelectedOptionFallback(
  session: ChatSession,
  userText: string,
): number | undefined {
  const optionNumber = extractSlotChoiceNumber(userText);
  if (!optionNumber) {
    const matchedSlot = matchSlotChoice(userText, session.offeredSlots);
    if (matchedSlot) {
      const matchedIndex = session.offeredSlots.findIndex(
        (slot) =>
          slot.date === matchedSlot.date &&
          slot.time === matchedSlot.time &&
          slot.doctorId === matchedSlot.doctorId,
      );

      if (matchedIndex >= 0) {
        return matchedIndex + 1;
      }
    }

    const normalizedText = normalize(userText);
    const isChoosingExpression = [
      "pode ser",
      "prefiro",
      "quero",
      "fica com",
      "vamos de",
      "fecho com",
    ].some((term) => normalizedText.includes(term));

    if (
      isChoosingExpression &&
      [
        "mais cedo",
        "primeiro horario",
        "primeiro horário",
        "primeira opcao",
        "primeira opção",
      ].some((term) => normalizedText.includes(term))
    ) {
      return session.offeredSlots[0] ? 1 : undefined;
    }

    if (
      isChoosingExpression &&
      [
        "mais tarde",
        "ultima",
        "última",
        "ultimo horario",
        "último horário",
        "ultima opcao",
        "última opção",
      ].some((term) => normalizedText.includes(term))
    ) {
      return session.offeredSlots.at(-1)
        ? session.offeredSlots.length
        : undefined;
    }

    return undefined;
  }

  return session.offeredSlots[optionNumber - 1] ? optionNumber : undefined;
}

async function resolveSelectedOptionWithLlm(
  session: ChatSession,
  userText: string,
): Promise<number | undefined> {
  const fallbackOptionNumber = getSelectedOptionFallback(session, userText);
  if (fallbackOptionNumber) {
    return fallbackOptionNumber;
  }

  if (
    !slotSelectionModel ||
    session.offeredSlots.length === 0 ||
    isAvailabilityQuestion(userText)
  ) {
    return undefined;
  }

  const systemPrompt = `
<role>Decida se a mensagem do paciente está escolhendo um dos horários listados.</role>
<task>Se a mensagem apontar para um slot específico da lista atual, retorne o número correspondente. Se não estiver escolhendo, retorne not_selected ou ambiguous.</task>
<rules>
- Mapeie referências naturais para o slot correto da lista atual.
- Considere que a lista está ordenada do horário mais cedo para o mais tarde.
- Exemplos de escolha válida: "1", "a segunda", "prefiro o de 12:30", "pode ser o mais cedo", "quero a última", "fica com o do meio-dia e meia".
- Se a pessoa estiver perguntando disponibilidade, como "tem 10h?", isso não é seleção.
- Se houver mais de um slot possível para a mesma descrição, marque ambiguous.
- Só retorne selectedOptionNumber quando houver correspondência clara com um item da lista.
</rules>
<examples>
<example>
<slots>
1. sex., 13 de mar., às 12:00
2. sex., 13 de mar., às 12:30
3. sex., 13 de mar., às 13:00
</slots>
<user>pode ser o mais cedo</user>
<outcome>selected_slot</outcome>
<selectedOptionNumber>1</selectedOptionNumber>
</example>
<example>
<slots>
1. sex., 13 de mar., às 12:00
2. sex., 13 de mar., às 12:30
3. sex., 13 de mar., às 13:00
</slots>
<user>prefiro o de 12:30</user>
<outcome>selected_slot</outcome>
<selectedOptionNumber>2</selectedOptionNumber>
</example>
<example>
<slots>
1. sex., 13 de mar., às 12:00
2. sex., 13 de mar., às 12:30
3. sex., 13 de mar., às 13:00
</slots>
<user>tem 10h?</user>
<outcome>not_selected</outcome>
<selectedOptionNumber>null</selectedOptionNumber>
</example>
</examples>
  `.trim();

  const userPrompt = `
<slots>
${formatAvailableSlots(session)}
</slots>
<user_message>${userText}</user_message>
  `.trim();

  try {
    const result = await slotSelectionModel.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ]);

    if (
      result.outcome === "selected_slot" &&
      result.selectedOptionNumber &&
      session.offeredSlots[result.selectedOptionNumber - 1]
    ) {
      return result.selectedOptionNumber;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

function inferScheduleFit(
  session: ChatSession,
  intent: ChatIntent,
  userText: string,
  preference: ParsedPreference = parsePreference(userText),
): ScheduleFit {
  if (intent === "slot_selection") {
    return "matches_listed_option";
  }

  if (intent === "confirm") {
    return "confirm_current_slot";
  }

  if (intent === "reject_or_change") {
    return session.stage === "confirmation" || session.stage === "slot_choice"
      ? "change_current_slot"
      : "clarify_needed";
  }

  if (intent !== "schedule_request") {
    return "not_applicable";
  }

  if (!hasParsedPreferenceSignal(preference)) {
    return "new_lookup";
  }

  const canReuseContextDate =
    !preference.date &&
    !preference.startDate &&
    !preference.endDate &&
    preference.weekday === undefined &&
    Boolean(getReusableContextDate(session)) &&
    (Boolean(preference.exactTime) ||
      Boolean(preference.period) ||
      Boolean(preference.timeWindow) ||
      isAvailabilityQuestion(userText, preference));

  return canReuseContextDate ? "contextual_lookup" : "new_lookup";
}

function stabilizeIntent(
  session: ChatSession,
  intent: ChatIntent,
  userText: string,
  selectedOptionNumber?: number,
  preference: ParsedPreference = parsePreference(userText),
  scheduleInterpretation?: ScheduleInterpretation,
): ChatIntent {
  if (
    isAvailabilityQuestion(userText, preference) ||
    isBroadScheduleRequest(userText, scheduleInterpretation) ||
    scheduleInterpretation?.intent === "schedule_request"
  ) {
    return "schedule_request";
  }

  if (selectedOptionNumber && session.offeredSlots[selectedOptionNumber - 1]) {
    return "slot_selection";
  }

  if (matchSlotChoice(userText, session.offeredSlots)) {
    return "slot_selection";
  }

  return intent;
}

function fallbackIntent(
  session: ChatSession,
  userText: string,
  preference: ParsedPreference = parsePreference(userText),
  scheduleInterpretation?: ScheduleInterpretation,
): ChatIntent {
  if (resetRequested(userText)) {
    return "restart";
  }

  if (isPositive(userText)) {
    return "confirm";
  }

  if (isCancellation(userText)) {
    return "cancellation";
  }

  if (isNegative(userText)) {
    return "reject_or_change";
  }

  if (matchSlotChoice(userText, session.offeredSlots)) {
    return "slot_selection";
  }

  if (
    hasParsedPreferenceSignal(preference) ||
    isBroadScheduleRequest(userText, scheduleInterpretation) ||
    scheduleInterpretation?.intent === "schedule_request"
  ) {
    return "schedule_request";
  }

  if (extractName(userText, session.stage === "name")) {
    return "provide_name";
  }

  if (containsClinicalContext(userText)) {
    return "clinical_need";
  }

  if (
    ["oi", "ola", "olá", "bom dia", "boa tarde", "boa noite"].includes(
      normalize(userText),
    )
  ) {
    return "greeting";
  }

  return "unclear";
}

function fallbackAnalysis(
  session: ChatSession,
  userText: string,
  preference: ParsedPreference = parsePreference(userText),
  scheduleInterpretation?: ScheduleInterpretation,
): ChatTurnAnalysis {
  const selectedOptionNumber = getSelectedOptionFallback(session, userText);
  const intent = stabilizeIntent(
    session,
    fallbackIntent(session, userText, preference, scheduleInterpretation),
    userText,
    selectedOptionNumber,
    preference,
    scheduleInterpretation,
  );
  const scheduleFit = inferScheduleFit(session, intent, userText, preference);

  return {
    intent,
    scheduleFit,
    shouldReuseContextDate:
      scheduleFit === "contextual_lookup" &&
      Boolean(getReusableContextDate(session)),
    selectedOptionNumber,
    isUrgent: detectUrgency(userText),
    parsedPreference: preference,
  };
}

function stabilizeAnalysis(
  session: ChatSession,
  result: z.infer<typeof turnAnalysisSchema>,
  userText: string,
  llmSelectedOptionNumber?: number,
  preference: ParsedPreference = parsePreference(userText),
  scheduleInterpretation?: ScheduleInterpretation,
): ChatTurnAnalysis {
  const fallback = fallbackAnalysis(
    session,
    userText,
    preference,
    scheduleInterpretation,
  );
  const selectedOptionNumber =
    llmSelectedOptionNumber ??
    result.selectedOptionNumber ??
    getSelectedOptionFallback(session, userText) ??
    fallback.selectedOptionNumber;
  const baseIntent = result.intent === "unclear" ? fallback.intent : result.intent;
  const intent = stabilizeIntent(
    session,
    baseIntent,
    userText,
    selectedOptionNumber,
    preference,
    scheduleInterpretation,
  );

  const scheduleFit =
    selectedOptionNumber && session.offeredSlots[selectedOptionNumber - 1]
      ? "matches_listed_option"
      : intent !== result.intent
      ? inferScheduleFit(session, intent, userText, preference)
      : result.scheduleFit;

  const shouldReuseContextDate =
    !preference.date &&
    !preference.startDate &&
    !preference.endDate &&
    preference.weekday === undefined &&
    Boolean(getReusableContextDate(session)) &&
    (result.shouldReuseContextDate || scheduleFit === "contextual_lookup");

  return {
    intent,
    scheduleFit,
    shouldReuseContextDate,
    selectedOptionNumber,
    isUrgent: detectUrgency(userText),
    parsedPreference: preference,
  };
}

export async function analyzeChatTurn(
  session: ChatSession,
  userText: string,
): Promise<ChatTurnAnalysis> {
  const scheduleInterpretationPromise = resolveScheduleUnderstanding(
    session,
    userText,
  );

  if (!classifierModel) {
    const scheduleInterpretation = await scheduleInterpretationPromise;
    return fallbackAnalysis(
      session,
      userText,
      scheduleInterpretation.preference,
      scheduleInterpretation,
    );
  }

  const systemPrompt = `
<role>Classifique a intenção da mensagem do paciente em um chat de agendamento odontológico e diga como ela se relaciona com a agenda atual.</role>
<task>Retorne uma análise estruturada com intenção, aderência ao contexto de agenda e, se existir, a opção numerada escolhida.</task>
<labels>
<intent>
- restart: quer reiniciar o atendimento.
- greeting: só cumprimentou ou respondeu de forma social sem trazer conteúdo útil.
- clinical_need: descreve sintomas, procedimento desejado ou motivo clínico.
- provide_name: está informando o nome.
- schedule_request: pede dia, período, horário, disponibilidade, mudança de horário, ou pergunta se existe vaga em certo horário.
- slot_selection: escolhe uma das opções já listadas.
- confirm: confirma o agendamento atual.
- reject_or_change: rejeita a opção atual ou quer mudar.
- cancellation: quer cancelar o agendamento, desistiu ou quer abandonar a conversa.
- unclear: nada acima ficou claro.
</intent>
<scheduleFit>
- not_applicable: a mensagem não trata de agenda.
- new_lookup: é um pedido novo de busca de horários.
- contextual_lookup: é um pedido de horário que deve reaproveitar o dia já em foco no contexto atual.
- matches_listed_option: escolhe uma opção já listada.
- confirm_current_slot: confirma o horário atualmente selecionado.
- change_current_slot: quer trocar o horário em foco.
- clarify_needed: fala de agenda, mas sem direção suficiente.
</scheduleFit>
</labels>
<rules>
- "tem 10 am?", "tem 10h?", "sexta às 10?", "perguntei se tem 10am?" e "qual horário tem?" são schedule_request, nunca slot_selection.
- "qualquer horário", "o primeiro disponível", "tanto faz" e "o próximo horário" também são schedule_request.
- Só use slot_selection quando a pessoa realmente estiver escolhendo uma opção já mostrada ou repetindo exatamente um horário listado sem tom de pergunta, como "prefiro 12:30".
- Use contextual_lookup quando a pessoa pedir só um horário ou período e o contexto atual já tiver um único dia em foco.
- Se a pessoa estiver apontando para um dos slots listados de qualquer forma, preencha selectedOptionNumber.
- Isso inclui "1", "opção 2", "a terceira", "prefiro o de 12:30", "pode ser o mais cedo", "quero a última", "fica com o do meio-dia e meia".
- Só use confirm quando a pessoa estiver claramente confirmando o horário que já está em foco.
- Considere sempre a etapa atual da conversa, a última resposta da assistente, os slots oferecidos e o slot selecionado.
</rules>
<examples>
<example>
<stage>slot_choice</stage>
<assistant>1. sex., 13 de mar., às 12:00\n2. sex., 13 de mar., às 12:30</assistant>
<user>1</user>
<intent>slot_selection</intent>
<scheduleFit>matches_listed_option</scheduleFit>
<shouldReuseContextDate>false</shouldReuseContextDate>
<selectedOptionNumber>1</selectedOptionNumber>
</example>
<example>
<stage>slot_choice</stage>
<assistant>1. sex., 13 de mar., às 12:00\n2. sex., 13 de mar., às 12:30</assistant>
<user>tem 10 am?</user>
<intent>schedule_request</intent>
<scheduleFit>contextual_lookup</scheduleFit>
<shouldReuseContextDate>true</shouldReuseContextDate>
<selectedOptionNumber>null</selectedOptionNumber>
</example>
<example>
<stage>slot_choice</stage>
<assistant>1. sex., 13 de mar., às 12:00\n2. sex., 13 de mar., às 12:30</assistant>
<user>prefiro 12:30</user>
<intent>slot_selection</intent>
<scheduleFit>matches_listed_option</scheduleFit>
<shouldReuseContextDate>false</shouldReuseContextDate>
<selectedOptionNumber>2</selectedOptionNumber>
</example>
<example>
<stage>slot_choice</stage>
<assistant>1. sex., 13 de mar., às 12:00\n2. sex., 13 de mar., às 12:30\n3. sex., 13 de mar., às 13:00</assistant>
<user>pode ser o mais cedo</user>
<intent>slot_selection</intent>
<scheduleFit>matches_listed_option</scheduleFit>
<shouldReuseContextDate>false</shouldReuseContextDate>
<selectedOptionNumber>1</selectedOptionNumber>
</example>
<example>
<stage>slot_choice</stage>
<assistant>1. sex., 13 de mar., às 12:00\n2. sex., 13 de mar., às 12:30\n3. sex., 13 de mar., às 13:00\n4. sex., 13 de mar., às 15:30</assistant>
<user>quero a última</user>
<intent>slot_selection</intent>
<scheduleFit>matches_listed_option</scheduleFit>
<shouldReuseContextDate>false</shouldReuseContextDate>
<selectedOptionNumber>4</selectedOptionNumber>
</example>
<example>
<stage>confirmation</stage>
<assistant>Posso confirmar sex., 13 de mar., às 12:00?</assistant>
<user>prefiro outro horário</user>
<intent>reject_or_change</intent>
<scheduleFit>change_current_slot</scheduleFit>
<shouldReuseContextDate>false</shouldReuseContextDate>
<selectedOptionNumber>null</selectedOptionNumber>
</example>
<example>
<stage>preference</stage>
<assistant>Me fala um dia ou período que funcione para você.</assistant>
<user>sexta à tarde</user>
<intent>schedule_request</intent>
<scheduleFit>new_lookup</scheduleFit>
<shouldReuseContextDate>false</shouldReuseContextDate>
<selectedOptionNumber>null</selectedOptionNumber>
</example>
<example>
<stage>preference</stage>
<assistant>Me fala um dia ou período que funcione para você.</assistant>
<user>quero o primeiro disponível</user>
<intent>schedule_request</intent>
<scheduleFit>new_lookup</scheduleFit>
<shouldReuseContextDate>false</shouldReuseContextDate>
<selectedOptionNumber>null</selectedOptionNumber>
</example>
<example>
<stage>confirmation</stage>
<assistant>Posso confirmar sex., 13 de mar., às 12:00?</assistant>
<user>sim, pode confirmar</user>
<intent>confirm</intent>
<scheduleFit>confirm_current_slot</scheduleFit>
<shouldReuseContextDate>false</shouldReuseContextDate>
<selectedOptionNumber>null</selectedOptionNumber>
</example>
</examples>
  `.trim();

  const userPrompt = `
<context>
<stage>${session.stage}</stage>
<assistant_last_message>${getLastAssistantMessage(session)}</assistant_last_message>
<selected_slot>${getSelectedSlotContext(session)}</selected_slot>
<offered_slots>
${formatAvailableSlots(session)}
</offered_slots>
<context_date>${getReusableContextDate(session) ?? "nenhuma"}</context_date>
</context>
<user_message>${userText}</user_message>
  `.trim();

  try {
    const [llmSelectedOptionNumber, scheduleInterpretation, result] =
      await Promise.all([
        resolveSelectedOptionWithLlm(session, userText),
        scheduleInterpretationPromise,
        classifierModel.invoke([
          new SystemMessage(systemPrompt),
          new HumanMessage(userPrompt),
        ]),
      ]);
    return stabilizeAnalysis(
      session,
      result,
      userText,
      llmSelectedOptionNumber,
      scheduleInterpretation.preference,
      scheduleInterpretation,
    );
  } catch {
    const scheduleInterpretation = await scheduleInterpretationPromise;
    return fallbackAnalysis(
      session,
      userText,
      scheduleInterpretation.preference,
      scheduleInterpretation,
    );
  }
}

export async function classifyChatIntent(
  session: ChatSession,
  userText: string,
): Promise<ChatIntent> {
  const analysis = await analyzeChatTurn(session, userText);
  return analysis.intent;
}
