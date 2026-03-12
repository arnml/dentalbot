import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { findAvailability } from "@/lib/availability";
import { demoConfig } from "@/lib/config";
import { doctors, getDoctorById, getServiceById } from "@/lib/clinic-data";
import {
  buildConfirmationMessage,
  buildRecentTranscript,
  buildSlotMessage,
  buildSlotOptions,
  confirmBooking,
  createEmptySession,
  createMessage,
  detectDoctorChangeRequest,
  extractName,
  extractSlotChoiceNumber,
  formatSlot,
  getFirstName,
  getQuickRepliesForSession,
  guessRecommendation,
  hasParsedPreferenceSignal,
  isCancellation,
  matchSlotChoice,
  normalize,
  parsePreference,
  parsePreferredDoctor,
  ParsedPreference,
  resetRequested,
} from "@/lib/chat-domain";
import { isOffTopicQuestion } from "@/lib/chat-intent";
import {
  resolveScheduleUnderstanding,
  ScheduleInterpretation,
} from "@/lib/chat-schedule-understanding";
import {
  ChatRecommendation,
  ChatSession,
  ChatStage,
  DoctorId,
  ServiceId,
  SuggestedSlot,
} from "@/lib/types";

const doctorIdSchema = z.enum(["mario", "stefania"]);
const serviceIdSchema = z.enum([
  "exam-cleaning",
  "whitening",
  "implant-consult",
  "pediatric-visit",
  "emergency",
]);
const periodSchema = z.enum(["morning", "afternoon", "evening"]);
const toolNameSchema = z.enum([
  "list_doctors",
  "recommend_visit",
  "lookup_availability",
  "book_appointment",
]);

const agentDecisionSchema = z.object({
  mode: z.enum(["reply", "tool"]),
  reply: z.string().nullable().optional(),
  toolName: toolNameSchema.nullable().optional(),
  toolInput: z
    .object({
      careRequest: z.string().nullable().optional(),
      doctorId: doctorIdSchema.nullable().optional(),
      serviceId: serviceIdSchema.nullable().optional(),
      preferenceText: z.string().nullable().optional(),
      date: z.string().nullable().optional(),
      exactTime: z.string().nullable().optional(),
      period: periodSchema.nullable().optional(),
      slotOptionNumber: z.number().int().min(1).max(6).nullable().optional(),
      patientName: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  sessionPatch: z
    .object({
      patientName: z.string().nullable().optional(),
      symptoms: z.string().nullable().optional(),
    })
    .optional(),
});

type AgentDecision = z.infer<typeof agentDecisionSchema>;
type AgentToolInput = NonNullable<AgentDecision["toolInput"]>;
type AgentToolName = NonNullable<AgentDecision["toolName"]>;

interface AgentScratchpadEntry {
  toolName: AgentToolName;
  input?: AgentToolInput | null;
  result: string;
  fallbackReply: string;
}

interface UserTurnHeuristics {
  extractedName?: string;
  preferredDoctorId?: DoctorId;
  parsedPreference: ParsedPreference;
  scheduleInterpretation?: ScheduleInterpretation;
  matchedSlot?: SuggestedSlot;
  matchedSlotOptionNumber?: number;
  hasCareRequest: boolean;
  offTopicQuestion: boolean;
  doctorChangeRequested: boolean;
}

interface ToolExecutionResult {
  result: string;
  fallbackReply: string;
}

const agentPlanner = demoConfig.hasAnthropicKey
  ? new ChatAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: demoConfig.anthropicModel,
      temperature: 0,
      maxTokens: 420,
      maxRetries: 2,
    }).withStructuredOutput(agentDecisionSchema, {
      method: "jsonSchema",
    })
  : null;

function cloneSession(session: ChatSession): ChatSession {
  return {
    ...session,
    recommendation: session.recommendation
      ? { ...session.recommendation }
      : undefined,
    offeredSlots: session.offeredSlots.map((slot) => ({ ...slot })),
    selectedSlot: session.selectedSlot ? { ...session.selectedSlot } : undefined,
    messages: session.messages.map((message) => ({ ...message })),
  };
}

function deriveSessionStage(session: ChatSession): ChatStage {
  if (session.stage === "completed") {
    return "completed";
  }

  if (session.selectedSlot) {
    return session.patientName ? "confirmation" : "name";
  }

  if (session.offeredSlots.length > 0) {
    return "slot_choice";
  }

  if (session.recommendation) {
    return session.patientName ? "preference" : "name";
  }

  return "symptoms";
}

function syncSessionStage(
  session: ChatSession,
  stage: ChatStage = deriveSessionStage(session),
): void {
  session.stage = stage;
}

function createResetSession(
  sessionId: string,
  assistantText?: string,
): ChatSession {
  const fresh = createEmptySession();

  return {
    ...fresh,
    id: sessionId,
    messages: assistantText
      ? [createMessage("assistant", assistantText)]
      : fresh.messages,
  };
}

function isNewBookingRequest(text: string): boolean {
  const normalizedText = normalize(text);

  return [
    "outra consulta",
    "marcar outra",
    "outro agendamento",
    "novo agendamento",
    "quero agendar de novo",
    "outra pessoa",
  ].some((term) => normalizedText.includes(term));
}

function looksLikeAvailabilityQuestion(
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
      "qual horario",
      "qual horário",
      "hay ",
      "puede",
      "se puede",
    ].some((term) => normalizedText.includes(term))
  );
}

function hasExplicitCareRequest(text: string): boolean {
  const normalizedText = normalize(text);

  return [
    "dor",
    "sensibilidade",
    "urgencia",
    "urgente",
    "emergencia",
    "infeccao",
    "inflamacao",
    "limpeza",
    "clareamento",
    "implante",
    "coroa",
    "protese",
    "faceta",
    "lente",
    "crianca",
    "criança",
    "filho",
    "filha",
    "avaliacao",
    "avaliação",
    "consulta infantil",
    "quebrado",
    "lascou",
    "sorriso",
  ].some((term) => normalizedText.includes(term));
}

function hasUrgencySignal(text?: string): boolean {
  if (!text) {
    return false;
  }

  const normalizedText = normalize(text);
  return [
    "dor",
    "urgencia",
    "urgente",
    "emergencia",
    "inchado",
    "inchaco",
    "nao aguento",
    "infeccao",
    "inflamacao",
    "quebrado",
    "lascou",
  ].some((term) => normalizedText.includes(term));
}

function resolveMatchedSlot(
  session: ChatSession,
  userText: string,
  preference: ParsedPreference,
): Pick<UserTurnHeuristics, "matchedSlot" | "matchedSlotOptionNumber"> {
  if (
    session.offeredSlots.length === 0 ||
    looksLikeAvailabilityQuestion(userText, preference)
  ) {
    return {};
  }

  const optionNumber = extractSlotChoiceNumber(userText);
  if (optionNumber && session.offeredSlots[optionNumber - 1]) {
    return {
      matchedSlot: session.offeredSlots[optionNumber - 1],
      matchedSlotOptionNumber: optionNumber,
    };
  }

  const matchedSlot = matchSlotChoice(userText, session.offeredSlots);
  if (!matchedSlot) {
    return {};
  }

  const matchedIndex = session.offeredSlots.findIndex(
    (slot) =>
      slot.date === matchedSlot.date &&
      slot.time === matchedSlot.time &&
      slot.doctorId === matchedSlot.doctorId,
  );

  return {
    matchedSlot,
    matchedSlotOptionNumber: matchedIndex >= 0 ? matchedIndex + 1 : undefined,
  };
}

async function analyzeUserTurn(
  session: ChatSession,
  userText: string,
): Promise<UserTurnHeuristics> {
  const scheduleInterpretation = await resolveScheduleUnderstanding(
    session,
    userText,
  );

  return {
    extractedName: extractName(userText, !session.patientName),
    preferredDoctorId: parsePreferredDoctor(userText),
    parsedPreference: scheduleInterpretation.preference,
    scheduleInterpretation,
    ...resolveMatchedSlot(session, userText, scheduleInterpretation.preference),
    hasCareRequest: hasExplicitCareRequest(userText),
    offTopicQuestion: isOffTopicQuestion(userText),
    doctorChangeRequested: detectDoctorChangeRequest(userText),
  };
}

function applyHeuristicsToSession(
  session: ChatSession,
  userText: string,
  heuristics: UserTurnHeuristics,
): void {
  if (heuristics.extractedName) {
    session.patientName = heuristics.extractedName;
  }

  if (
    heuristics.hasCareRequest &&
    !heuristics.offTopicQuestion &&
    !looksLikeAvailabilityQuestion(userText, heuristics.parsedPreference)
  ) {
    session.symptoms = userText.trim();
  }

  if (heuristics.doctorChangeRequested && heuristics.preferredDoctorId) {
    if (session.recommendation?.doctorId !== heuristics.preferredDoctorId) {
      session.recommendation = undefined;
      session.offeredSlots = [];
      session.selectedSlot = undefined;
    }
  }

  if (heuristics.matchedSlot) {
    session.selectedSlot = heuristics.matchedSlot;
  }

  if (heuristics.parsedPreference.period) {
    session.preferredPeriod = heuristics.parsedPreference.period;
  }
}

function shouldPreemptivelyLookupAvailability(
  session: ChatSession,
  heuristics: UserTurnHeuristics,
): boolean {
  if (!heuristics.scheduleInterpretation) {
    return false;
  }

  if (heuristics.matchedSlot) {
    return false;
  }

  if (heuristics.scheduleInterpretation.intent !== "schedule_request") {
    return false;
  }

  const hasLookupPreference =
    hasParsedPreferenceSignal(heuristics.parsedPreference) ||
    heuristics.scheduleInterpretation.requestKind === "first_available";

  if (!hasLookupPreference) {
    return false;
  }

  if (!session.patientName && !heuristics.extractedName) {
    return false;
  }

  return Boolean(
    session.recommendation ||
      session.symptoms ||
      heuristics.hasCareRequest ||
      heuristics.preferredDoctorId,
  );
}

function shouldPreemptivelyLookupUrgentIntake(
  previousSession: ChatSession,
  session: ChatSession,
): boolean {
  return (
    !previousSession.patientName &&
    Boolean(session.patientName) &&
    !session.offeredSlots.length &&
    !session.selectedSlot &&
    hasUrgencySignal(session.symptoms)
  );
}

function applySessionPatch(
  session: ChatSession,
  patch: AgentDecision["sessionPatch"],
): void {
  if (!patch) {
    return;
  }

  if (typeof patch.patientName === "string" && patch.patientName.trim()) {
    session.patientName = patch.patientName.trim();
  }

  if (typeof patch.symptoms === "string" && patch.symptoms.trim()) {
    session.symptoms = patch.symptoms.trim();
  }
}

function formatSlots(slots: SuggestedSlot[]): string {
  if (slots.length === 0) {
    return "nenhum slot em foco";
  }

  return slots.map((slot, index) => `${index + 1}. ${formatSlot(slot)}`).join("\n");
}

function formatDoctors(): string {
  return doctors
    .map(
      (doctor) =>
        `- ${doctor.name}: ${doctor.specialties.join(", ")}. ${doctor.chatBlurb}`,
    )
    .join("\n");
}

function formatScratchpad(entries: AgentScratchpadEntry[]): string {
  if (entries.length === 0) {
    return "nenhuma tool usada ainda neste turno";
  }

  return entries
    .map((entry, index) => {
      const serializedInput = entry.input
        ? JSON.stringify(entry.input, null, 2)
        : "{}";

      return [
        `<tool_step index="${index + 1}" name="${entry.toolName}">`,
        `<input>${serializedInput}</input>`,
        `<result>${entry.result}</result>`,
        "</tool_step>",
      ].join("\n");
    })
    .join("\n");
}

function buildRecommendationFromIds(
  doctorId: DoctorId,
  serviceId: ServiceId,
): ChatRecommendation {
  const doctor = getDoctorById(doctorId);
  const service = getServiceById(serviceId);

  return {
    doctorId,
    doctorName: doctor.name,
    serviceId,
    serviceName: service.name,
    reason: doctor.chatBlurb,
  };
}

function resolveRecommendation(
  session: ChatSession,
  input: AgentToolInput,
  userText: string,
  heuristics: UserTurnHeuristics,
): ChatRecommendation | undefined {
  if (input.doctorId && input.serviceId) {
    return buildRecommendationFromIds(input.doctorId, input.serviceId);
  }

  if (
    session.recommendation &&
    !input.careRequest &&
    !input.doctorId &&
    !input.serviceId &&
    !heuristics.doctorChangeRequested
  ) {
    return session.recommendation;
  }

  if (input.serviceId && session.recommendation?.doctorId) {
    return buildRecommendationFromIds(
      session.recommendation.doctorId,
      input.serviceId,
    );
  }

  const preferredDoctorId =
    input.doctorId ?? heuristics.preferredDoctorId ?? session.recommendation?.doctorId;
  const careRequest =
    input.careRequest ??
    session.symptoms ??
    (heuristics.hasCareRequest ? userText.trim() : undefined);

  if (careRequest || preferredDoctorId) {
    return guessRecommendation(careRequest ?? "consulta", preferredDoctorId);
  }

  return session.recommendation;
}

function getReusableContextDate(session: ChatSession): string | undefined {
  if (session.selectedSlot?.date) {
    return session.selectedSlot.date;
  }

  const uniqueDates = [...new Set(session.offeredSlots.map((slot) => slot.date))];
  return uniqueDates.length === 1 ? uniqueDates[0] : undefined;
}

function applyPreferenceContext(
  session: ChatSession,
  preference: ParsedPreference,
): ParsedPreference {
  if (preference.date || preference.startDate || preference.endDate) {
    return preference;
  }

  if (
    !preference.exactTime &&
    !preference.period &&
    !preference.timeWindow &&
    !preference.weekendRequested
  ) {
    return preference;
  }

  const contextDate = getReusableContextDate(session);
  if (!contextDate) {
    return preference;
  }

  return {
    ...preference,
    date: contextDate,
  };
}

function buildDoctorsToolResult(): ToolExecutionResult {
  const result = `Profissionais disponíveis:\n${formatDoctors()}`;

  return {
    result,
    fallbackReply:
      "Hoje eu consigo te ajudar com o Dr. Mario, focado em implantes e reabilitação, ou com a Dra. Stefania, que cuida de família, crianças, clareamento e urgências. Se me disser o que você precisa, eu já te aponto a melhor opção.",
  };
}

function buildRecommendationToolResult(
  session: ChatSession,
  input: AgentToolInput,
  userText: string,
  heuristics: UserTurnHeuristics,
): ToolExecutionResult {
  const previousRecommendation = session.recommendation;
  const recommendation = resolveRecommendation(session, input, userText, heuristics);

  if (!recommendation) {
    syncSessionStage(session);
    return {
      result: "Ainda faltam detalhes para recomendar a melhor consulta.",
      fallbackReply:
        "Antes de procurar agenda, me conta rapidinho se você está com dor, quer limpeza, clareamento, implante ou outro tipo de consulta.",
    };
  }

  session.recommendation = recommendation;

  if (
    previousRecommendation &&
    previousRecommendation.doctorId !== recommendation.doctorId
  ) {
    session.offeredSlots = [];
    session.selectedSlot = undefined;
  }

  if (typeof input.careRequest === "string" && input.careRequest.trim()) {
    session.symptoms = input.careRequest.trim();
  }

  syncSessionStage(session);

  return {
    result: `Consulta sugerida: ${recommendation.serviceName} com ${recommendation.doctorName}. Motivo: ${recommendation.reason}`,
    fallbackReply: `${recommendation.reason} Se quiser, eu já posso olhar horários para essa consulta.`,
  };
}

async function buildAvailabilityToolResult(
  session: ChatSession,
  input: AgentToolInput,
  userText: string,
  heuristics: UserTurnHeuristics,
): Promise<ToolExecutionResult> {
  const recommendation = resolveRecommendation(session, input, userText, heuristics);

  if (!recommendation) {
    syncSessionStage(session);
    return {
      result: "Não foi possível buscar horários porque a consulta ainda não está clara.",
      fallbackReply:
        "Consigo ver agenda assim que eu souber com qual tipo de consulta faz mais sentido te encaixar. Me conta o motivo da visita ou o profissional que você prefere.",
    };
  }

  session.recommendation = recommendation;

  const rawPreferenceText =
    typeof input.preferenceText === "string" && input.preferenceText.trim()
      ? input.preferenceText
      : userText;
  const scheduleInterpretation =
    rawPreferenceText === userText
      ? heuristics.scheduleInterpretation
      : await resolveScheduleUnderstanding(session, rawPreferenceText);
  const parsedPreference = scheduleInterpretation?.preference ?? parsePreference(rawPreferenceText);
  const mergedPreference = applyPreferenceContext(session, {
    ...parsedPreference,
    date: input.date ?? parsedPreference.date,
    exactTime: input.exactTime ?? parsedPreference.exactTime,
    period: input.period ?? parsedPreference.period,
  });

  if (mergedPreference.period) {
    session.preferredPeriod = mergedPreference.period;
  }

  const result = buildSlotOptions(recommendation, mergedPreference);
  session.offeredSlots = result.slots;
  session.selectedSlot = undefined;
  syncSessionStage(session);

  const resultSummary = result.slots.length
    ? `Horários encontrados para ${recommendation.serviceName} com ${recommendation.doctorName}:\n${formatSlots(result.slots)}`
    : `Nenhum horário encontrado para ${recommendation.serviceName} com ${recommendation.doctorName}.`;

  return {
    result: result.note ? `${result.note}\n${resultSummary}` : resultSummary,
    fallbackReply: buildSlotMessage(recommendation, result),
  };
}

function resolveBookingSlot(
  session: ChatSession,
  input: AgentToolInput,
  heuristics: UserTurnHeuristics,
): SuggestedSlot | undefined {
  if (input.slotOptionNumber && session.offeredSlots[input.slotOptionNumber - 1]) {
    return session.offeredSlots[input.slotOptionNumber - 1];
  }

  if (heuristics.matchedSlot) {
    return heuristics.matchedSlot;
  }

  if (session.selectedSlot) {
    return session.selectedSlot;
  }

  if (input.date && input.exactTime) {
    return session.offeredSlots.find(
      (slot) => slot.date === input.date && slot.time === input.exactTime,
    );
  }

  return undefined;
}

function buildBookingToolResult(
  session: ChatSession,
  input: AgentToolInput,
  heuristics: UserTurnHeuristics,
): ToolExecutionResult {
  const patientName =
    (typeof input.patientName === "string" && input.patientName.trim()) ||
    session.patientName ||
    heuristics.extractedName;

  if (!patientName) {
    syncSessionStage(session);
    return {
      result: "Tentativa de booking bloqueada: faltou o nome do paciente.",
      fallbackReply:
        "Consigo deixar isso reservado, mas antes me manda só o nome da pessoa que vai na consulta.",
    };
  }

  let slot = resolveBookingSlot(session, input, heuristics);

  if (!slot && input.date && input.exactTime && session.recommendation) {
    const exact = findAvailability({
      doctorId: session.recommendation.doctorId,
      serviceId: session.recommendation.serviceId,
      date: input.date,
      time: input.exactTime,
    });

    if (exact.available) {
      slot = {
        doctorId: exact.requested.doctorId ?? session.recommendation.doctorId,
        doctorName: exact.requested.doctorName,
        date: exact.requested.date,
        time: exact.requested.time,
        serviceId: exact.requested.serviceId,
        serviceName: exact.requested.serviceName,
      };
    } else {
      session.offeredSlots = exact.alternatives.slice(0, 4);
      session.selectedSlot = undefined;
      session.patientName = patientName;
      syncSessionStage(session);

      const unavailableReply = exact.alternatives.length
        ? `Esse horário não ficou livre, mas já puxei alternativas:\n${formatSlots(session.offeredSlots)}`
        : "Esse horário não ficou livre e eu não encontrei alternativa próxima agora.";

      return {
        result: unavailableReply,
        fallbackReply: exact.alternatives.length
          ? `Esse horário certinho não ficou livre, mas já separei algumas alternativas para você:\n\n${formatSlots(
              session.offeredSlots,
            )}\n\nSe quiser, me fala qual opção prefere.`
          : "Esse horário certinho não ficou livre agora. Se quiser, me fala outro dia ou período e eu procuro de novo.",
      };
    }
  }

  if (!slot) {
    syncSessionStage(session);
    return {
      result: "Tentativa de booking bloqueada: faltou um slot resolvido.",
      fallbackReply:
        session.offeredSlots.length > 0
          ? "Me diz qual opção você quer reservar, por número, ou me fala outro dia e horário."
          : "Antes de reservar eu preciso te mostrar um horário disponível. Me fala um dia ou período que funcione para você.",
    };
  }

  confirmBooking(slot, patientName);
  session.patientName = patientName;
  session.selectedSlot = slot;
  session.offeredSlots = [];
  syncSessionStage(session, "completed");

  return {
    result: `Booking confirmado para ${patientName}: ${formatSlot(slot)}.`,
    fallbackReply: buildConfirmationMessage(slot, patientName),
  };
}

async function executeTool(
  toolName: AgentToolName,
  session: ChatSession,
  input: AgentToolInput,
  userText: string,
  heuristics: UserTurnHeuristics,
): Promise<ToolExecutionResult> {
  switch (toolName) {
    case "list_doctors":
      return buildDoctorsToolResult();
    case "recommend_visit":
      return buildRecommendationToolResult(session, input, userText, heuristics);
    case "lookup_availability":
      return buildAvailabilityToolResult(session, input, userText, heuristics);
    case "book_appointment":
      return buildBookingToolResult(session, input, heuristics);
    default:
      return {
        result: "Tool desconhecida.",
        fallbackReply:
          "Perdi um pouco o fio aqui. Me fala novamente o que você quer fazer e eu sigo daqui.",
      };
  }
}

function buildAgentPrompt(
  session: ChatSession,
  userText: string,
  heuristics: UserTurnHeuristics,
  scratchpad: AgentScratchpadEntry[],
): string {
  const preferenceSummary = JSON.stringify(
    {
      date: heuristics.parsedPreference.date ?? null,
      startDate: heuristics.parsedPreference.startDate ?? null,
      endDate: heuristics.parsedPreference.endDate ?? null,
      weekday: heuristics.parsedPreference.weekday ?? null,
      weekdayOccurrence: heuristics.parsedPreference.weekdayOccurrence ?? null,
      exactTime: heuristics.parsedPreference.exactTime ?? null,
      period: heuristics.parsedPreference.period ?? null,
      timeWindow: heuristics.parsedPreference.timeWindow?.label ?? null,
      weekendRequested: heuristics.parsedPreference.weekendRequested ?? false,
    },
    null,
    2,
  );

  return `
<today>${new Date().toISOString().slice(0, 10)}</today>
<session>
<stage>${session.stage}</stage>
<patient_name>${session.patientName ?? "não informado"}</patient_name>
<care_request>${session.symptoms ?? "não informado"}</care_request>
<recommendation>${session.recommendation ? `${session.recommendation.serviceName} com ${session.recommendation.doctorName}` : "nenhuma"}</recommendation>
<selected_slot>${session.selectedSlot ? formatSlot(session.selectedSlot) : "nenhum"}</selected_slot>
<offered_slots>
${formatSlots(session.offeredSlots)}
</offered_slots>
<recent_transcript>
${buildRecentTranscript(session.messages, 8) || "sem histórico anterior"}
</recent_transcript>
</session>
<turn_heuristics>
<extracted_name>${heuristics.extractedName ?? "nenhum"}</extracted_name>
<preferred_doctor>${heuristics.preferredDoctorId ?? "nenhum"}</preferred_doctor>
<parsed_preference>${preferenceSummary}</parsed_preference>
<matched_slot>${heuristics.matchedSlot ? formatSlot(heuristics.matchedSlot) : "nenhum"}</matched_slot>
<matched_slot_option>${heuristics.matchedSlotOptionNumber ?? "nenhuma"}</matched_slot_option>
<has_care_request>${heuristics.hasCareRequest}</has_care_request>
<off_topic_question>${heuristics.offTopicQuestion}</off_topic_question>
<doctor_change_requested>${heuristics.doctorChangeRequested}</doctor_change_requested>
</turn_heuristics>
<available_doctors>
${formatDoctors()}
</available_doctors>
<tool_results_this_turn>
${formatScratchpad(scratchpad)}
</tool_results_this_turn>
<latest_user_message>${userText}</latest_user_message>
  `.trim();
}

function buildAgentSystemPrompt(): string {
  return `
<role>Você é a recepção conversacional da Aurora Dental Atelier.</role>
<objective>Conduza o agendamento de forma natural, flexível e segura, como uma assistente humana no WhatsApp.</objective>
<tools>
- list_doctors: use para mostrar os profissionais e explicar quem atende cada caso.
- recommend_visit: use para transformar sintomas ou intenção de tratamento em uma consulta com dentista e serviço.
- lookup_availability: use para buscar horários disponíveis. Reaproveite o especialista atual quando já existir contexto.
- book_appointment: use só quando houver pedido claro para reservar/confirmar um slot específico.
</tools>
<behavior>
- Não siga um roteiro fixo de etapas. Descubra só a próxima peça que falta.
- Não peça o nome cedo demais. Só peça quando realmente ajudar a concluir a reserva, a menos que a pessoa já tenha informado.
- Pode responder perguntas paralelas rapidamente e depois retomar o agendamento sem perder o contexto.
- Se a pessoa mudar de ideia, trocar de médico, perguntar valores ou voltar para a agenda, acompanhe naturalmente.
- Evite emojis, firulas e tom publicitário. Soe como uma recepcionista humana, calma e objetiva.
- Não repita perguntas que a pessoa já respondeu.
- Se já houver informação clínica suficiente para recomendar a consulta, não peça mais detalhes antes de avançar para nome ou agenda.
- Se já houver nome e contexto suficiente para buscar agenda, prefira oferecer horários concretos em vez de continuar investigando.
- Em casos de dor ou urgência, priorize encaixe rápido. Se fizer sentido, ofereça primeiro os horários mais próximos.
- Se já houver slots mostrados e a pessoa pedir outro dia, outra semana, outro período ou uma nova faixa de horário, faça nova busca com lookup_availability em vez de só repetir a lista atual.
- Se a pessoa pedir "essa semana" ou "semana que vem", responda com datas dentro desse intervalo, não apenas com os slots que já estavam em foco.
- Em agendamentos para filho, filha ou outra pessoa, deixe claro de quem é o nome que você precisa: do responsável ou do paciente.
- Se a pessoa disser algo como "quase meio-dia" ou "casi al mediodía", trate isso como uma faixa de horário, não como hora exata.
- Se a pessoa disser algo como "este viernes", "este este este viernes", "primeira sexta do próximo mês", "próximo mês", "essa semana" ou "semana que vem", trate isso como referência natural de data e período, sem exigir formato rígido.
- Nunca invente agenda. Nunca confirme booking sem usar book_appointment com sucesso.
- Se já houver slots oferecidos e a pessoa escolher um deles, você pode confirmar o slot em linguagem natural antes de reservar.
- Respostas finais ao paciente devem ser curtas, naturais e em português do Brasil.
- Se faltar contexto para usar uma tool, pergunte de forma curta e objetiva.
</behavior>
<decision_format>
- Retorne mode="tool" quando precisar usar uma tool.
- Retorne mode="reply" quando já puder falar com o paciente agora.
- Quando usar tool, escolha apenas uma por passo.
- Você pode atualizar patientName e symptoms em sessionPatch quando isso estiver claro.
</decision_format>
  `.trim();
}

async function decideNextStep(
  session: ChatSession,
  userText: string,
  heuristics: UserTurnHeuristics,
  scratchpad: AgentScratchpadEntry[],
): Promise<AgentDecision> {
  if (!agentPlanner) {
    throw new Error("Anthropic agent unavailable");
  }

  return agentPlanner.invoke([
    new SystemMessage(buildAgentSystemPrompt()),
    new HumanMessage(buildAgentPrompt(session, userText, heuristics, scratchpad)),
  ]);
}

function buildFallbackReply(
  session: ChatSession,
  scratchpad: AgentScratchpadEntry[],
): string {
  const latestToolReply = scratchpad.at(-1)?.fallbackReply;
  if (latestToolReply) {
    return latestToolReply;
  }

  if (session.selectedSlot && session.patientName) {
    return `Posso confirmar ${formatSlot(session.selectedSlot)} no nome de ${session.patientName}?`;
  }

  if (session.offeredSlots.length > 0) {
    return "Me fala qual dessas opções funciona melhor para você.";
  }

  if (session.recommendation) {
    return "Se quiser, me fala um dia ou período e eu já procuro os horários.";
  }

  return "Me conta o que você precisa e eu sigo por aqui.";
}

export async function processChatTurnWithAgent(
  session: ChatSession,
  userText: string,
): Promise<{ session: ChatSession; quickReplies: string[] }> {
  const trimmed = userText.trim();
  const normalizedText = normalize(trimmed);

  if (session.stage === "completed" && isNewBookingRequest(trimmed)) {
    session = createResetSession(session.id);
  }

  if (resetRequested(trimmed)) {
    const resetSession = createResetSession(session.id);
    return {
      session: resetSession,
      quickReplies: getQuickRepliesForSession(resetSession),
    };
  }

  if (isCancellation(trimmed)) {
    const firstName = getFirstName(session.patientName);
    const prefix = firstName ? `Tudo bem, ${firstName}. ` : "Tudo bem. ";
    const cancelledSession = createResetSession(
      session.id,
      `${prefix}Cancelei tudo por aqui. Se quiser retomar depois, é só me chamar.`,
    );

    return {
      session: cancelledSession,
      quickReplies: getQuickRepliesForSession(cancelledSession),
    };
  }

  const workingSession = cloneSession(session);
  const heuristics = await analyzeUserTurn(workingSession, trimmed);
  applyHeuristicsToSession(workingSession, trimmed, heuristics);
  syncSessionStage(workingSession);

  if (shouldPreemptivelyLookupUrgentIntake(session, workingSession)) {
    const lookupResult = await buildAvailabilityToolResult(
      workingSession,
      {},
      trimmed,
      heuristics,
    );

    workingSession.messages.push(createMessage("user", trimmed));
    workingSession.messages.push(
      createMessage("assistant", lookupResult.fallbackReply),
    );
    workingSession.stage = deriveSessionStage(workingSession);

    return {
      session: workingSession,
      quickReplies: getQuickRepliesForSession(workingSession),
    };
  }

  if (shouldPreemptivelyLookupAvailability(workingSession, heuristics)) {
    const lookupResult = await buildAvailabilityToolResult(
      workingSession,
      {},
      trimmed,
      heuristics,
    );

    workingSession.messages.push(createMessage("user", trimmed));
    workingSession.messages.push(
      createMessage("assistant", lookupResult.fallbackReply),
    );
    workingSession.stage = deriveSessionStage(workingSession);

    return {
      session: workingSession,
      quickReplies: getQuickRepliesForSession(workingSession),
    };
  }

  const scratchpad: AgentScratchpadEntry[] = [];
  const executedTools = new Set<string>();
  let assistantReply: string | undefined;

  for (let step = 0; step < 4; step += 1) {
    const decision = await decideNextStep(
      workingSession,
      trimmed,
      heuristics,
      scratchpad,
    );

    applySessionPatch(workingSession, decision.sessionPatch);
    syncSessionStage(workingSession);

    if (decision.mode === "reply") {
      assistantReply =
        decision.reply?.trim() || buildFallbackReply(workingSession, scratchpad);
      break;
    }

    const toolName = decision.toolName ?? "list_doctors";
    const toolInput = decision.toolInput ?? {};
    const signature = JSON.stringify([toolName, toolInput]);

    if (executedTools.has(signature)) {
      assistantReply = buildFallbackReply(workingSession, scratchpad);
      break;
    }

    executedTools.add(signature);

    const toolResult = await executeTool(
      toolName,
      workingSession,
      toolInput,
      trimmed,
      heuristics,
    );

    scratchpad.push({
      toolName,
      input: toolInput,
      result: toolResult.result,
      fallbackReply: toolResult.fallbackReply,
    });
    syncSessionStage(workingSession);
  }

  const finalReply = assistantReply ?? buildFallbackReply(workingSession, scratchpad);
  workingSession.messages.push(createMessage("user", trimmed));
  workingSession.messages.push(createMessage("assistant", finalReply));
  workingSession.stage =
    workingSession.stage === "completed"
      ? "completed"
      : normalizedText
        ? deriveSessionStage(workingSession)
        : workingSession.stage;

  return {
    session: workingSession,
    quickReplies: getQuickRepliesForSession(workingSession),
  };
}
