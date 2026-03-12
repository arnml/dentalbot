import { z } from "zod";
import {
  END,
  Overwrite,
  ReducedValue,
  START,
  StateGraph,
  StateSchema,
  UntrackedValue,
} from "@langchain/langgraph";
import {
  buildConfirmationMessage,
  buildSlotMessage,
  buildSlotOptions,
  chatStageValues,
  confirmBooking,
  containsClinicalContext,
  createEmptySession,
  createMessage,
  detectDoctorChangeRequest,
  extractFamilyContext,
  extractName,
  formatSlot,
  getFirstName,
  getQuickRepliesForSession,
  guessRecommendation,
  isFamilyBookingRequest,
  matchSlotChoice,
  normalize,
  ParsedPreference,
  parsePreferredDoctor,
  resetRequested,
} from "@/lib/chat-domain";
import { humanizeReply } from "@/lib/chat-llm";
import {
  ChatMessage,
  ChatRecommendation,
  ChatSession,
  ChatStage,
  DoctorId,
  Period,
  SuggestedSlot,
} from "@/lib/types";
import {
  ChatIntent,
  ScheduleFit,
  analyzeChatTurn,
  chatIntentValues,
  scheduleFitValues,
  isOffTopicQuestion,
} from "@/lib/chat-intent";

const doctorIdSchema = z.enum(["mario", "stefania"]);
const serviceIdSchema = z.enum([
  "exam-cleaning",
  "whitening",
  "implant-consult",
  "pediatric-visit",
  "emergency",
]);
const chatStageSchema = z.enum(chatStageValues);
const chatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["assistant", "user"]),
  text: z.string(),
  createdAt: z.string(),
});
const chatRecommendationSchema = z.object({
  doctorId: doctorIdSchema,
  doctorName: z.string(),
  serviceId: serviceIdSchema,
  serviceName: z.string(),
  reason: z.string(),
});
const chatIntentSchema = z.enum(chatIntentValues);
const scheduleFitSchema = z.enum(scheduleFitValues);
const suggestedSlotSchema = z.object({
  doctorId: doctorIdSchema,
  doctorName: z.string(),
  date: z.string(),
  time: z.string(),
  serviceId: serviceIdSchema,
  serviceName: z.string(),
});
const periodSchema = z.enum(["morning", "afternoon", "evening"]);
const approximateTimeWindowSchema = z.object({
  start: z.string(),
  end: z.string(),
  label: z.string(),
});
const weekdayOccurrenceSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal("last"),
]);
const parsedPreferenceSchema = z.object({
  date: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  weekday: z.number().int().min(0).max(6).optional(),
  weekdayOccurrence: weekdayOccurrenceSchema.optional(),
  exactTime: z.string().optional(),
  period: periodSchema.optional(),
  timeWindow: approximateTimeWindowSchema.optional(),
  weekendRequested: z.boolean().optional(),
});

const chatMessageListValue = new ReducedValue(
  z.array(chatMessageSchema).default(() => []),
  {
    inputSchema: z.union([chatMessageSchema, z.array(chatMessageSchema)]),
    reducer: (
      current: ChatMessage[],
      incoming: ChatMessage | ChatMessage[],
    ): ChatMessage[] => {
      const next = Array.isArray(incoming) ? incoming : [incoming];
      return [...current, ...next];
    },
  },
);

const ChatTurnState = new StateSchema({
  sessionId: z.string(),
  stage: chatStageSchema,
  patientName: z.string().optional(),
  symptoms: z.string().optional(),
  recommendation: chatRecommendationSchema.optional(),
  offeredSlots: z.array(suggestedSlotSchema).default(() => []),
  selectedSlot: suggestedSlotSchema.optional(),
  messages: chatMessageListValue,
  preferredPeriod: periodSchema.optional(),
  stuckTurnCount: z.number().int().min(0).default(0),
  previousPatientName: z.string().optional(),
  familyContext: z.string().optional(),
  latestUserText: new UntrackedValue(z.string().default("")),
  extractedName: new UntrackedValue(z.string().optional()),
  preferredDoctorId: new UntrackedValue(doctorIdSchema.optional()),
  hasClinicalContext: new UntrackedValue(z.boolean().default(false)),
  resetConversation: new UntrackedValue(z.boolean().default(false)),
  intent: new UntrackedValue(chatIntentSchema.optional()),
  scheduleFit: new UntrackedValue(scheduleFitSchema.optional()),
  shouldReuseContextDate: new UntrackedValue(z.boolean().optional()),
  selectedOptionNumber: new UntrackedValue(
    z.number().int().min(1).max(4).optional(),
  ),
  isUrgent: new UntrackedValue(z.boolean().optional()),
  parsedPreference: new UntrackedValue(parsedPreferenceSchema.optional()),
  replyDraft: new UntrackedValue(z.string().optional()),
});

type ChatGraphState = typeof ChatTurnState.State;

function isStuckMessage(stuckTurnCount: number): boolean {
  return stuckTurnCount >= 2;
}

function applySessionPreferences(
  state: ChatGraphState,
  preference: ParsedPreference,
): ParsedPreference {
  const withContext = applyPreferenceContext(state, preference);

  // If no explicit period was requested and we have a preferred period, apply it
  if (!withContext.period && state.preferredPeriod) {
    return { ...withContext, period: state.preferredPeriod };
  }

  return withContext;
}

function applyPreferenceContext(
  state: ChatGraphState,
  preference: ParsedPreference,
): ParsedPreference {
  if (
    preference.date ||
    preference.startDate ||
    preference.endDate ||
    preference.weekday !== undefined
  ) {
    return preference;
  }

  if (!state.shouldReuseContextDate) {
    return preference;
  }

  const contextDate =
    state.selectedSlot?.date ??
    (() => {
      const uniqueDates = [...new Set(state.offeredSlots.map((slot) => slot.date))];
      return uniqueDates.length === 1 ? uniqueDates[0] : undefined;
    })();

  if (!contextDate) {
    return preference;
  }

  return {
    ...preference,
    date: contextDate,
  };
}

function toSession(state: ChatGraphState): ChatSession {
  return {
    id: state.sessionId,
    stage: state.stage,
    patientName: state.patientName,
    symptoms: state.symptoms,
    recommendation: state.recommendation as ChatRecommendation | undefined,
    offeredSlots: state.offeredSlots as SuggestedSlot[],
    selectedSlot: state.selectedSlot as SuggestedSlot | undefined,
    messages: state.messages as ChatMessage[],
    preferredPeriod: state.preferredPeriod as Period | undefined,
    stuckTurnCount: state.stuckTurnCount,
    previousPatientName: state.previousPatientName,
    familyContext: state.familyContext,
  };
}

function toGraphInput(session: ChatSession, latestUserText: string) {
  return {
    sessionId: session.id,
    stage: session.stage,
    patientName: session.patientName,
    symptoms: session.symptoms,
    recommendation: session.recommendation,
    offeredSlots: session.offeredSlots,
    selectedSlot: session.selectedSlot,
    messages: session.messages,
    preferredPeriod: session.preferredPeriod,
    stuckTurnCount: session.stuckTurnCount ?? 0,
    previousPatientName: session.previousPatientName,
    familyContext: session.familyContext,
    latestUserText,
  };
}

function createResetState(state: ChatGraphState) {
  const fresh = createEmptySession();

  return {
    sessionId: state.sessionId,
    stage: fresh.stage,
    patientName: undefined,
    symptoms: undefined,
    recommendation: undefined,
    offeredSlots: [],
    selectedSlot: undefined,
    messages: new Overwrite(fresh.messages),
    preferredPeriod: undefined,
    stuckTurnCount: 0,
    previousPatientName: undefined,
    familyContext: undefined,
    latestUserText: "",
    extractedName: undefined,
    preferredDoctorId: undefined,
    hasClinicalContext: false,
    resetConversation: false,
    intent: undefined,
    scheduleFit: undefined,
    shouldReuseContextDate: undefined,
    selectedOptionNumber: undefined,
    isUrgent: undefined,
    parsedPreference: undefined,
    replyDraft: undefined,
  };
}

const ingestUserTurn: typeof ChatTurnState.Node = async (state) => {
  const trimmed = (state.latestUserText ?? "").trim();
  const analysis = await analyzeChatTurn(toSession(state), trimmed);

  return {
    latestUserText: trimmed,
    messages: createMessage("user", trimmed),
    resetConversation: resetRequested(trimmed),
    extractedName: extractName(trimmed, state.stage === "name"),
    preferredDoctorId: parsePreferredDoctor(trimmed),
    hasClinicalContext: containsClinicalContext(trimmed),
    intent: analysis.intent,
    scheduleFit: analysis.scheduleFit,
    shouldReuseContextDate: analysis.shouldReuseContextDate,
    selectedOptionNumber: analysis.selectedOptionNumber,
    isUrgent: analysis.isUrgent,
    parsedPreference: analysis.parsedPreference,
  };
};

const resetSessionNode: typeof ChatTurnState.Node = (state) =>
  createResetState(state);

const handleSymptomsNode: typeof ChatTurnState.Node = (state) => {
  const latestUserText = state.latestUserText ?? "";
  const patientName = state.patientName ?? state.extractedName;
  const isUrgent = state.isUrgent ?? false;

  if (!state.hasClinicalContext) {
    if (isOffTopicQuestion(latestUserText)) {
      return {
        patientName,
        stuckTurnCount: (state.stuckTurnCount ?? 0) + 1,
        replyDraft:
          "Ótima pergunta! Para detalhes de valores, convênios e horários, melhor você nos chamar direto: (11) 98765-4321. Mas agora, me conta o que você está sentindo para eu marcar uma consulta?",
      };
    }

    const urgentHint = isUrgent
      ? " Entendi que é urgente, mas me ajuda com mais detalhes?"
      : "";
    return {
      patientName,
      stuckTurnCount: (state.stuckTurnCount ?? 0) + 1,
      replyDraft:
        "Me conta um pouco do que está acontecendo: dor, sensibilidade, limpeza, clareamento, consulta infantil, implante... qualquer pista já ajuda." +
        urgentHint,
    };
  }

  const recommendation = guessRecommendation(
    latestUserText,
    state.preferredDoctorId as DoctorId | undefined,
  );

  if (!patientName) {
    return {
      patientName,
      symptoms: latestUserText,
      recommendation,
      stage: "name" satisfies ChatStage,
      stuckTurnCount: 0,
      replyDraft: `${recommendation.reason} Qual seu nome para eu agendar?`,
    };
  }

  return {
    patientName,
    symptoms: latestUserText,
    recommendation,
    stage: "preference" satisfies ChatStage,
    stuckTurnCount: 0,
    replyDraft: `${recommendation.reason} Perfeito, ${patientName}. ${isUrgent ? "Vou procurar um horário o mais rápido possível. Qual dia ou período você prefere?" : "Agora me fala um dia ou período que seja bom para você."}`,
  };
};

const handleNameNode: typeof ChatTurnState.Node = (state) => {
  if (!state.extractedName) {
    return {
      stuckTurnCount: (state.stuckTurnCount ?? 0) + 1,
      replyDraft:
        "Pode me mandar só o nome que eu já sigo procurando os horários para você.",
    };
  }

  return {
    patientName: state.extractedName,
    stage: "preference" satisfies ChatStage,
    stuckTurnCount: 0,
    replyDraft: `Perfeito, ${state.extractedName}. Agora me fala um dia ou período que seja melhor para você, e eu já te trago as opções.`,
  };
};

const handlePreferenceNode: typeof ChatTurnState.Node = (state) => {
  const latestUserText = state.latestUserText ?? "";
  const intent = state.intent as ChatIntent | undefined;
  const parsedPreference = state.parsedPreference as ParsedPreference | undefined;

  if (!state.recommendation) {
    return {
      stage: "symptoms" satisfies ChatStage,
      stuckTurnCount: 0,
      replyDraft:
        "Me conta de novo seu nome e o que você está sentindo para eu te encaixar direitinho.",
    };
  }

  if (detectDoctorChangeRequest(latestUserText)) {
    return {
      stage: "symptoms" satisfies ChatStage,
      stuckTurnCount: 0,
      replyDraft:
        "Claro! Me fala o que você está buscando e eu vejo outra opção de especialista para você.",
    };
  }

  if (intent !== "schedule_request") {
    const newStuckCount = (state.stuckTurnCount ?? 0) + 1;
    const prefix = isStuckMessage(newStuckCount)
      ? "Tudo bem, sem pressa. Quer o próximo horário disponível? Só diga 'sim' ou me fale um dia.\n\n"
      : "";
    return {
      stuckTurnCount: newStuckCount,
      replyDraft:
        prefix +
        "Me fala um dia, período ou se prefere o primeiro horário disponível que eu já separo as opções.",
    };
  }

  const slotResult = buildSlotOptions(
    state.recommendation as ChatRecommendation,
    applySessionPreferences(state, parsedPreference ?? {}),
  );

  const acknowledgment =
    latestUserText.trim().length > 0
      ? `Vou olhar ${latestUserText.trim()} para você.\n\n`
      : "";

  return {
    offeredSlots: slotResult.slots,
    stage: "slot_choice" satisfies ChatStage,
    stuckTurnCount: 0,
    replyDraft:
      acknowledgment + buildSlotMessage(
        state.recommendation as ChatRecommendation,
        slotResult,
      ),
  };
};

const handleSlotChoiceNode: typeof ChatTurnState.Node = (state) => {
  const latestUserText = state.latestUserText ?? "";
  const intent = state.intent as ChatIntent | undefined;
  const scheduleFit = state.scheduleFit as ScheduleFit | undefined;
  const isUrgent = state.isUrgent ?? false;
  const parsedPreference = state.parsedPreference as ParsedPreference | undefined;

  if (!state.recommendation) {
    return {
      stage: "symptoms" satisfies ChatStage,
      stuckTurnCount: 0,
      replyDraft:
        "Perdi um pouco o contexto aqui. Me fala de novo o que você está sentindo e eu retomo.",
    };
  }

  if (detectDoctorChangeRequest(latestUserText)) {
    return {
      stage: "symptoms" satisfies ChatStage,
      stuckTurnCount: 0,
      replyDraft:
        "Claro! Me fala o que você está buscando e eu vejo outra opção de especialista para você.",
    };
  }

  const chosen =
    intent === "slot_selection"
      ? (state.selectedOptionNumber
          ? (state.offeredSlots[state.selectedOptionNumber - 1] as
              | SuggestedSlot
              | undefined)
          : undefined) ??
        matchSlotChoice(latestUserText, state.offeredSlots as SuggestedSlot[])
      : undefined;

  if (chosen) {
    const hour = Number(chosen.time.slice(0, 2));
    const derivedPeriod: Period =
      hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";

    const confirmText = isUrgent
      ? `Ótimo! Confirmo ${formatSlot(chosen)} no seu nome?`
      : `Fechou. Posso confirmar ${formatSlot(chosen)} no nome de ${state.patientName ?? "você"}?`;

    return {
      selectedSlot: chosen,
      preferredPeriod: derivedPeriod,
      stage: "confirmation" satisfies ChatStage,
      stuckTurnCount: 0,
      replyDraft: confirmText,
    };
  }

  if (
    intent === "schedule_request" ||
    scheduleFit === "contextual_lookup" ||
    scheduleFit === "new_lookup"
  ) {
    const requestedPreference = applySessionPreferences(
      state,
      parsedPreference ?? {},
    );
    const updatedSlotResult = buildSlotOptions(
      state.recommendation as ChatRecommendation,
      requestedPreference,
    );

    return {
      offeredSlots: updatedSlotResult.slots,
      stuckTurnCount: 0,
      replyDraft: buildSlotMessage(
        state.recommendation as ChatRecommendation,
        updatedSlotResult,
      ),
    };
  }

  const newStuckCount = (state.stuckTurnCount ?? 0) + 1;
  const prefix = isStuckMessage(newStuckCount)
    ? "Pode digitar 1, 2, 3 ou 4 para escolher, ou me fala outro dia.\n\n"
    : "";
  return {
    stuckTurnCount: newStuckCount,
    replyDraft:
      prefix +
      "Desculpe, não consegui entender. Me responde com o número da opção (1, 2, 3 ou 4) ou me fala outro dia/horário que eu ajusto.",
  };
};

const handleConfirmationNode: typeof ChatTurnState.Node = (state) => {
  const intent = state.intent as ChatIntent | undefined;
  const scheduleFit = state.scheduleFit as ScheduleFit | undefined;
  const parsedPreference = state.parsedPreference as ParsedPreference | undefined;
  const requestedPreference = applySessionPreferences(
    state,
    parsedPreference ?? {},
  );

  if (
    intent === "schedule_request" ||
    scheduleFit === "contextual_lookup" ||
    scheduleFit === "new_lookup" ||
    requestedPreference.date ||
    requestedPreference.exactTime ||
    requestedPreference.period
  ) {
    if (!state.recommendation) {
      return {
        stage: "symptoms" satisfies ChatStage,
        stuckTurnCount: 0,
        replyDraft:
          "Perdi um pouco o contexto aqui. Me fala de novo o que você está sentindo e eu retomo.",
      };
    }

    const updatedSlotResult = buildSlotOptions(
      state.recommendation as ChatRecommendation,
      requestedPreference,
    );

    return {
      selectedSlot: undefined,
      offeredSlots: updatedSlotResult.slots,
      stage: "slot_choice" satisfies ChatStage,
      stuckTurnCount: 0,
      replyDraft: buildSlotMessage(
        state.recommendation as ChatRecommendation,
        updatedSlotResult,
      ),
    };
  }

  if (intent === "reject_or_change" || scheduleFit === "change_current_slot") {
    return {
      selectedSlot: undefined,
      stage: "preference" satisfies ChatStage,
      stuckTurnCount: 0,
      replyDraft:
        "Sem problema. Me manda outro dia ou período que eu procuro de novo.",
    };
  }

  if (intent !== "confirm" || !state.selectedSlot || !state.patientName) {
    return {
      stuckTurnCount: (state.stuckTurnCount ?? 0) + 1,
      replyDraft:
        "Se estiver tudo certo, me responde com um 'sim'. Se quiser mudar, me fala outro dia ou horário.",
    };
  }

  confirmBooking(state.selectedSlot as SuggestedSlot, state.patientName);

  const selectedSlot = state.selectedSlot as SuggestedSlot;

  return {
    stage: "completed" satisfies ChatStage,
    stuckTurnCount: 0,
    replyDraft: buildConfirmationMessage(selectedSlot, state.patientName),
  };
};

const handleCompletedNode: typeof ChatTurnState.Node = (state) => ({
  stuckTurnCount: (state.stuckTurnCount ?? 0) + 1,
  replyDraft:
    "Se quiser, a gente pode começar de novo. Me conta seu nome e o que você está sentindo.",
});

const handleCancellationNode: typeof ChatTurnState.Node = (state) => {
  const firstName = getFirstName(state.patientName);
  const prefix = firstName ? `Tudo bem, ${firstName}. ` : "Tudo bem. ";
  return {
    ...createResetState(state),
    messages: new Overwrite([
      createMessage(
        "assistant",
        `${prefix}Cancelei tudo por aqui. Se quiser marcar outro horário quando estiver pronto, é só me chamar!`,
      ),
    ]),
  };
};

const handleNewPatientNode: typeof ChatTurnState.Node = (state) => {
  const firstName = getFirstName(state.patientName);
  const familyContext = extractFamilyContext(state.latestUserText ?? "");
  const contextText = familyContext
    ? `Vamos marcar para sua ${familyContext}. `
    : "Vamos marcar para outra pessoa. ";
  return {
    ...createResetState(state),
    previousPatientName: state.patientName,
    familyContext,
    messages: new Overwrite([
      createMessage(
        "assistant",
        `Claro, ${firstName || "você"}! ${contextText}Me conta o nome dela e o que está sentindo.`,
      ),
    ]),
  };
};

function routeTurn(state: ChatGraphState) {
  const normalizedText = normalize(state.latestUserText ?? "");
  const intent = state.intent as ChatIntent | undefined;
  const latestUserText = state.latestUserText ?? "";

  if (
    state.resetConversation ||
    intent === "restart" ||
    (state.stage === "completed" && normalizedText.includes("outra"))
  ) {
    return "resetSession";
  }

  if (
    intent === "cancellation" &&
    (state.stage === "slot_choice" ||
      state.stage === "confirmation" ||
      state.stage === "completed")
  ) {
    return "handleCancellation";
  }

  if (
    state.stage === "completed" &&
    (intent === "new_patient" || isFamilyBookingRequest(latestUserText))
  ) {
    return "handleNewPatient";
  }

  switch (state.stage) {
    case "symptoms":
      return "handleSymptoms";
    case "name":
      return "handleName";
    case "preference":
      return "handlePreference";
    case "slot_choice":
      return "handleSlotChoice";
    case "confirmation":
      return "handleConfirmation";
    case "completed":
      return "handleCompleted";
    default:
      return "handleCompleted";
  }
}

const humanizeReplyNode: typeof ChatTurnState.Node = async (state) => {
  if (!state.replyDraft) {
    return {};
  }

  return {
    replyDraft: await humanizeReply(state.replyDraft, toSession(state)),
  };
};

const appendAssistantMessageNode: typeof ChatTurnState.Node = (state) => {
  if (!state.replyDraft) {
    return {};
  }

  return {
    messages: createMessage("assistant", state.replyDraft),
    latestUserText: "",
    extractedName: undefined,
    preferredDoctorId: undefined,
    hasClinicalContext: false,
    resetConversation: false,
    intent: undefined,
    scheduleFit: undefined,
    shouldReuseContextDate: undefined,
    selectedOptionNumber: undefined,
    isUrgent: undefined,
    parsedPreference: undefined,
    replyDraft: undefined,
  };
};

const workflow = new StateGraph(ChatTurnState)
  .addNode("ingestUserTurn", ingestUserTurn)
  .addNode("resetSession", resetSessionNode)
  .addNode("handleSymptoms", handleSymptomsNode)
  .addNode("handleName", handleNameNode)
  .addNode("handlePreference", handlePreferenceNode)
  .addNode("handleSlotChoice", handleSlotChoiceNode)
  .addNode("handleConfirmation", handleConfirmationNode)
  .addNode("handleCompleted", handleCompletedNode)
  .addNode("handleCancellation", handleCancellationNode)
  .addNode("handleNewPatient", handleNewPatientNode)
  .addNode("humanizeReply", humanizeReplyNode)
  .addNode("appendAssistantMessage", appendAssistantMessageNode)
  .addEdge(START, "ingestUserTurn")
  .addConditionalEdges("ingestUserTurn", routeTurn)
  .addEdge("handleSymptoms", "humanizeReply")
  .addEdge("handleName", "humanizeReply")
  .addEdge("handlePreference", "humanizeReply")
  .addEdge("handleSlotChoice", "humanizeReply")
  .addEdge("handleConfirmation", "humanizeReply")
  .addEdge("handleCompleted", "humanizeReply")
  .addEdge("handleCancellation", END)
  .addEdge("handleNewPatient", END)
  .addEdge("humanizeReply", "appendAssistantMessage")
  .addEdge("appendAssistantMessage", END)
  .addEdge("resetSession", END)
  .compile();

export async function runChatTurnGraph(
  session: ChatSession,
  userText: string,
): Promise<{ session: ChatSession; quickReplies: string[] }> {
  const nextState = await workflow.invoke(toGraphInput(session, userText), {
    recursionLimit: 8,
  });
  const nextSession = toSession(nextState as ChatGraphState);

  return {
    session: nextSession,
    quickReplies: getQuickRepliesForSession(nextSession),
  };
}
