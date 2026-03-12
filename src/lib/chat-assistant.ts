import Anthropic from "@anthropic-ai/sdk";
import { createBooking } from "@/lib/booking-store";
import { demoConfig } from "@/lib/config";
import {
  getDoctorById,
  getServiceById,
} from "@/lib/clinic-data";
import { findAvailability, getSuggestedSlots } from "@/lib/availability";
import { formatDateLabel, toDateKey } from "@/lib/date";
import {
  ChatMessage,
  ChatRecommendation,
  ChatSession,
  ChatStage,
  DoctorId,
  ServiceId,
  SuggestedSlot,
} from "@/lib/types";

const anthropic = demoConfig.hasAnthropicKey
  ? new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    })
  : null;

function createMessage(role: ChatMessage["role"], text: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    text,
    createdAt: new Date().toISOString(),
  };
}

function addMessage(session: ChatSession, role: ChatMessage["role"], text: string) {
  session.messages.push(createMessage(role, text));
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function toDisplayName(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function getFirstName(name?: string): string | undefined {
  return name?.trim().split(/\s+/)[0];
}

function extractName(text: string, fallback = false): string | undefined {
  const match = text.match(
    /(?:meu nome é|meu nome e|my name is|me chamo|aqui é|sou o|sou a|sou)\s+([a-zA-ZÀ-ÿ]+(?:\s+[a-zA-ZÀ-ÿ]+){0,2})/i,
  );

  if (match?.[1]) {
    return toDisplayName(match[1]);
  }

  if (fallback) {
    const trimmed = text.trim();
    if (trimmed.length > 1 && trimmed.split(/\s+/).length <= 3) {
      return toDisplayName(trimmed);
    }
  }

  return undefined;
}

function addNaturalNameReference(draft: string, session: ChatSession): string {
  const firstName = getFirstName(session.patientName);
  if (!firstName) {
    return draft;
  }

  const normalizedDraft = normalize(draft);
  if (normalizedDraft.includes(normalize(firstName))) {
    return draft;
  }

  const prefix =
    session.stage === "name"
      ? `Perfeito, ${firstName}. `
      : session.stage === "preference"
        ? `Entendi, ${firstName}. `
        : session.stage === "slot_choice"
          ? `Beleza, ${firstName}. `
          : session.stage === "confirmation"
            ? `Certo, ${firstName}. `
            : `Tudo certo, ${firstName}. `;

  const cleanedDraft = draft.replace(/^(oi|olá|ola|bom dia|boa tarde|boa noite)[!,.\s-]*/i, "");
  return `${prefix}${cleanedDraft.charAt(0).toLowerCase()}${cleanedDraft.slice(1)}`;
}

function guessRecommendation(
  symptoms: string,
  preferredDoctorId?: DoctorId,
): ChatRecommendation {
  const normalized = normalize(symptoms);

  if (preferredDoctorId) {
    const doctor = getDoctorById(preferredDoctorId);
    const serviceId: ServiceId =
      preferredDoctorId === "mario" ? "implant-consult" : "exam-cleaning";

    return {
      doctorId: doctor.id,
      doctorName: doctor.name,
      serviceId,
      serviceName: getServiceById(serviceId).name,
      reason: `Como você pediu atendimento com ${doctor.name}, vou seguir com esse encaixe e procurar o tipo de consulta mais adequado.`,
    };
  }

  if (
    [
      "dor",
      "urgencia",
      "urgente",
      "inchaco",
      "inchado",
      "sensibilidade",
      "quebrado",
      "quebrou",
      "lascou",
      "sangramento",
      "infeccao",
      "inflamacao",
    ].some((term) => normalized.includes(term))
  ) {
    return {
      doctorId: "stefania",
      doctorName: getDoctorById("stefania").name,
      serviceId: "emergency",
      serviceName: getServiceById("emergency").name,
      reason:
        "Pelo que você descreveu, faz mais sentido começar com a Stefania em um encaixe de urgência para avaliar dor, sensibilidade ou trauma.",
    };
  }

  if (
    ["implante", "coroa", "protese", "prótese", "reabilit", "faceta", "lente"]
      .some((term) => normalized.includes(term))
  ) {
    return {
      doctorId: "mario",
      doctorName: getDoctorById("mario").name,
      serviceId: "implant-consult",
      serviceName: getServiceById("implant-consult").name,
      reason:
        "Como você falou de implante, coroa ou reabilitação, o melhor encaixe é com o Mario, que cuida dessa parte mais restauradora.",
    };
  }

  if (
    ["clareamento", "mancha", "estet", "sorriso", "branco"].some((term) =>
      normalized.includes(term),
    )
  ) {
    return {
      doctorId: "stefania",
      doctorName: getDoctorById("stefania").name,
      serviceId: "whitening",
      serviceName: getServiceById("whitening").name,
      reason:
        "Se a ideia é clareamento ou uma melhora estética mais leve, a Stefania costuma ser a melhor porta de entrada.",
    };
  }

  if (
    ["crianca", "criança", "filho", "filha", "infantil", "pediatr"].some((term) =>
      normalized.includes(term),
    )
  ) {
    return {
      doctorId: "stefania",
      doctorName: getDoctorById("stefania").name,
      serviceId: "pediatric-visit",
      serviceName: getServiceById("pediatric-visit").name,
      reason:
        "Como é um atendimento infantil, a Stefania é a especialista certa para tocar isso com mais conforto.",
    };
  }

  return {
    doctorId: "stefania",
    doctorName: getDoctorById("stefania").name,
    serviceId: "exam-cleaning",
    serviceName: getServiceById("exam-cleaning").name,
    reason:
      "Para começar com uma avaliação mais geral e entender bem o quadro, o melhor é uma consulta completa com a Stefania.",
  };
}

function getQuickReplies(stage: ChatStage, slots: SuggestedSlot[] = []): string[] {
  switch (stage) {
    case "symptoms":
      return [
        "Sou Ana e estou com dor no dente",
        "Quero fazer clareamento",
        "Meu filho precisa de consulta",
      ];
    case "name":
      return [];
    case "preference":
      return [
        "amanhã de manhã",
        "quinta à tarde",
        "quero o próximo horário disponível",
      ];
    case "slot_choice":
      return slots.slice(0, 3).map((_, index) => `${index + 1}`);
    case "confirmation":
      return ["sim, pode confirmar", "prefiro outro horário"];
    case "completed":
      return ["quero marcar outra consulta"];
    default:
      return [];
  }
}

export function getQuickRepliesForSession(session: ChatSession): string[] {
  return getQuickReplies(session.stage, session.offeredSlots);
}

function isGreeting(text: string): boolean {
  const normalized = normalize(text);
  return ["oi", "ola", "olá", "bom dia", "boa tarde", "boa noite"].includes(
    normalized,
  );
}

function resetRequested(text: string): boolean {
  const normalized = normalize(text);
  return ["reiniciar", "recomecar", "recomecar", "comecar de novo", "novo atendimento"]
    .some((term) => normalized.includes(term));
}

function parsePreferredDoctor(text: string): DoctorId | undefined {
  const normalized = normalize(text);
  if (normalized.includes("mario")) {
    return "mario";
  }
  if (normalized.includes("stefania")) {
    return "stefania";
  }
  return undefined;
}

function containsClinicalContext(text: string): boolean {
  const normalized = normalize(text);
  if (isGreeting(normalized)) {
    return false;
  }

  const terms = [
    "dor",
    "limpeza",
    "clareamento",
    "implante",
    "coroa",
    "sensibilidade",
    "urgencia",
    "urgente",
    "crianca",
    "criança",
    "sorriso",
    "avaliacao",
    "avaliação",
    "consulta",
    "quebrado",
    "lascou",
    "incomoda",
    "incomodação",
  ];

  return terms.some((term) => normalized.includes(term)) || text.trim().length > 18;
}

type Period = "morning" | "afternoon" | "evening";

interface SlotSuggestionResult {
  slots: SuggestedSlot[];
  note?: string;
}

function nextWeekday(weekday: number): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const candidate = new Date(today);

  while (candidate.getDay() !== weekday) {
    candidate.setDate(candidate.getDate() + 1);
  }

  if (candidate.getTime() === today.getTime()) {
    candidate.setDate(candidate.getDate() + 7);
  }

  return toDateKey(candidate);
}

function parsePreference(text: string): {
  date?: string;
  exactTime?: string;
  period?: Period;
} {
  const normalized = normalize(text);
  let date: string | undefined;
  let period: Period | undefined;
  let exactTime: string | undefined;

  if (normalized.includes("amanha")) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    date = toDateKey(tomorrow);
  }

  if (normalized.includes("hoje")) {
    date = toDateKey(new Date());
  }

  const weekdays: Record<string, number> = {
    segunda: 1,
    terca: 2,
    terça: 2,
    quarta: 3,
    quinta: 4,
    sexta: 5,
  };

  for (const [label, weekday] of Object.entries(weekdays)) {
    if (normalized.includes(label)) {
      date = nextWeekday(weekday);
      break;
    }
  }

  const slashDate = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
  if (slashDate) {
    const day = Number(slashDate[1]);
    const month = Number(slashDate[2]);
    const year = Number(slashDate[3] ?? new Date().getFullYear());
    date = toDateKey(new Date(year, month - 1, day));
  }

  const isoDate = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoDate) {
    date = `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`;
  }

  if (normalized.includes("manha") || normalized.includes("cedo")) {
    period = "morning";
  } else if (normalized.includes("tarde")) {
    period = "afternoon";
  } else if (normalized.includes("noite")) {
    period = "evening";
  }

  const timeMatch =
    text.match(/(?:às|as)\s*(\d{1,2})(?::(\d{2}))?/i) ??
    text.match(/\b(\d{1,2})h(?:(\d{2}))?\b/i);

  if (timeMatch) {
    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2] ?? "00");
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      exactTime = `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}`;
    }
  }

  return { date, exactTime, period };
}

function fitsPeriod(slot: SuggestedSlot, period?: Period): boolean {
  if (!period) {
    return true;
  }

  const hour = Number(slot.time.slice(0, 2));

  if (period === "morning") {
    return hour < 12;
  }

  if (period === "afternoon") {
    return hour >= 12 && hour < 17;
  }

  return hour >= 17;
}

function buildFallbackSlots(recommendation: ChatRecommendation): SuggestedSlot[] {
  return getSuggestedSlots({
    doctorId: recommendation.doctorId,
    serviceId: recommendation.serviceId,
    limit: 4,
  });
}

function buildSlotOptions(
  recommendation: ChatRecommendation,
  preference: ReturnType<typeof parsePreference>,
): SlotSuggestionResult {
  if (preference.date && preference.exactTime) {
    const exact = findAvailability({
      doctorId: recommendation.doctorId,
      serviceId: recommendation.serviceId,
      date: preference.date,
      time: preference.exactTime,
    });

    if (exact.available) {
      return {
        slots: [
          {
            doctorId: recommendation.doctorId,
            doctorName: recommendation.doctorName,
            date: preference.date,
            time: preference.exactTime,
            serviceId: recommendation.serviceId,
            serviceName: recommendation.serviceName,
          },
          ...exact.alternatives,
        ].slice(0, 4),
      };
    }

    return {
      slots: exact.alternatives.slice(0, 4),
      note: `Esse horário exato eu não consegui, mas já vi opções próximas para você.`,
    };
  }

  let slots = getSuggestedSlots({
    doctorId: recommendation.doctorId,
    serviceId: recommendation.serviceId,
    limit: 8,
    startDate: preference.date,
  });

  if (preference.date) {
    slots = slots.filter((slot) => slot.date === preference.date);
  }

  slots = slots.filter((slot) => fitsPeriod(slot, preference.period));

  if (preference.exactTime) {
    slots = slots.filter((slot) => slot.time === preference.exactTime);
  }

  if (slots.length === 0) {
    slots = buildFallbackSlots(recommendation);
  }

  let note: string | undefined;

  if (preference.date && preference.period && preference.exactTime) {
    note = "Nesse horário e período eu não consegui te encaixar, mas separei alternativas próximas.";
  } else if (preference.date && preference.period) {
    note = "Nesse período eu não achei vaga nesse dia, mas já puxei outras opções para você.";
  } else if (preference.date) {
    note = "Nesse dia específico eu não achei um horário bom, mas já trouxe outras opções.";
  } else if (preference.period) {
    note = "Nesse período eu não achei vaga agora, mas já separei outros horários.";
  }

  return {
    slots: slots.slice(0, 4),
    note,
  };
}

function formatSlot(slot: SuggestedSlot): string {
  return `${formatDateLabel(slot.date)}, às ${slot.time}, com ${slot.doctorName}`;
}

function buildSlotMessage(
  recommendation: ChatRecommendation,
  result: SlotSuggestionResult,
): string {
  const { slots, note } = result;

  if (slots.length === 0) {
    return `${note ?? `Eu não achei um horário bom agora para ${recommendation.doctorName}.`} Se quiser, me manda outro dia ou período que eu tento de novo.`;
  }

  const list = slots
    .map((slot, index) => `${index + 1}. ${formatSlot(slot)}`)
    .join("\n");

  const intro = note
    ? `${note}\n\n`
    : `Boa, separei estas opções para ${recommendation.serviceName}:\n`;

  return `${intro}${list}\n\nMe responde com o número da opção ou com outro dia/horário que eu ajusto.`;
}

function matchSlotChoice(
  text: string,
  slots: SuggestedSlot[],
): SuggestedSlot | undefined {
  const normalized = normalize(text);

  const indexMap: Record<string, number> = {
    "1": 0,
    "primeira": 0,
    "opcao 1": 0,
    "opção 1": 0,
    "2": 1,
    "segunda": 1,
    "opcao 2": 1,
    "opção 2": 1,
    "3": 2,
    "terceira": 2,
    "opcao 3": 2,
    "opção 3": 2,
    "4": 3,
    "quarta": 3,
    "opcao 4": 3,
    "opção 4": 3,
  };

  for (const [label, index] of Object.entries(indexMap)) {
    if (normalized === label || normalized.includes(label)) {
      return slots[index];
    }
  }

  const preference = parsePreference(text);
  if (preference.date || preference.exactTime) {
    return slots.find((slot) => {
      const sameDate = !preference.date || slot.date === preference.date;
      const sameTime = !preference.exactTime || slot.time === preference.exactTime;
      return sameDate && sameTime;
    });
  }

  return undefined;
}

function isPositive(text: string): boolean {
  const normalized = normalize(text);
  return ["sim", "pode confirmar", "fechado", "confirmar", "pode ser", "bora"]
    .some((term) => normalized.includes(term));
}

function isNegative(text: string): boolean {
  const normalized = normalize(text);
  return ["nao", "não", "outro horario", "outro horário", "prefiro outro"].some(
    (term) => normalized.includes(term),
  );
}

async function humanizeReply(draft: string, session: ChatSession): Promise<string> {
  const personalizedDraft = addNaturalNameReference(draft, session);

  if (!anthropic) {
    return personalizedDraft;
  }

  try {
    const response = await anthropic.messages.create({
      model: demoConfig.anthropicModel,
      max_tokens: 220,
      temperature: 0.5,
      system: [
        {
          type: "text",
          text:
            "Você é uma atendente virtual de uma clínica odontológica no Brasil. Responda em português do Brasil, com um tom casual, acolhedor e natural. Não invente horários ou fatos. Reescreva a resposta-base deixando mais fluida, mantendo todos os dados concretos exatamente iguais. Quando o nome do paciente estiver disponível, use o primeiro nome de forma natural na resposta. Não cumprimente o paciente de novo depois da primeira mensagem. Evite começar respostas com 'Oi', 'Olá', 'Bom dia', 'Boa tarde' ou 'Boa noite'. Prefira construções como 'Perfeito, Ana.', 'Entendi, Ana.', 'Beleza, Ana.', 'Certo, Ana.'. Evite floreios longos; fale como uma pessoa da recepção falando no WhatsApp.",
        },
      ],
      messages: [
        {
          role: "user",
          content: `Contexto do atendimento:\n- Paciente: ${session.patientName ?? "não informado"}\n- Sintomas: ${session.symptoms ?? "não informado"}\n\nResposta-base:\n${personalizedDraft}`,
        },
      ],
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    return text ? addNaturalNameReference(text, session) : personalizedDraft;
  } catch {
    return personalizedDraft;
  }
}

function createEmptySession(): ChatSession {
  const session: ChatSession = {
    id: crypto.randomUUID(),
    stage: "symptoms",
    offeredSlots: [],
    messages: [],
  };

  addMessage(
    session,
    "assistant",
    "Oi! Eu sou a assistente da Aurora Dental. Me conta rapidinho seu nome e o que você está sentindo que eu vejo com quem faz mais sentido te encaixar.",
  );

  return session;
}

export function createInitialChatSession(): ChatSession {
  return createEmptySession();
}

export async function processChatTurn(
  session: ChatSession,
  userText: string,
): Promise<{ session: ChatSession; quickReplies: string[] }> {
  const trimmed = userText.trim();
  addMessage(session, "user", trimmed);

  if (resetRequested(trimmed)) {
    const fresh = createEmptySession();
    fresh.id = session.id;
    return {
      session: fresh,
      quickReplies: getQuickReplies(fresh.stage),
    };
  }

  if (session.stage === "completed" && normalize(trimmed).includes("outra")) {
    const fresh = createEmptySession();
    fresh.id = session.id;
    return {
      session: fresh,
      quickReplies: getQuickReplies(fresh.stage),
    };
  }

  const preferredDoctorId = parsePreferredDoctor(trimmed);

  if (session.stage === "symptoms") {
    if (!session.patientName) {
      const extractedName = extractName(trimmed);
      if (extractedName) {
        session.patientName = extractedName;
      }
    }

    if (!containsClinicalContext(trimmed)) {
      const reply = await humanizeReply(
        "Me conta um pouco do que está acontecendo: dor, sensibilidade, limpeza, clareamento, consulta infantil, implante... qualquer pista já ajuda.",
        session,
      );
      addMessage(session, "assistant", reply);
      return { session, quickReplies: getQuickReplies("symptoms") };
    }

    session.symptoms = trimmed;
    session.recommendation = guessRecommendation(trimmed, preferredDoctorId);

    if (!session.patientName) {
      session.stage = "name";
      const reply = await humanizeReply(
        `${session.recommendation.reason} Antes de eu procurar um horário, qual nome devo colocar no agendamento?`,
        session,
      );
      addMessage(session, "assistant", reply);
      return { session, quickReplies: getQuickReplies("name") };
    }

    session.stage = "preference";
    const reply = await humanizeReply(
      `${session.recommendation.reason} Beleza, ${session.patientName}. Agora me fala um dia ou período que seja bom para você. Pode ser algo como "amanhã de manhã", "quinta à tarde" ou "quero o próximo horário".`,
      session,
    );
    addMessage(session, "assistant", reply);
    return { session, quickReplies: getQuickReplies("preference") };
  }

  if (session.stage === "name") {
    const extractedName = extractName(trimmed, true);

    if (!extractedName) {
      const reply = await humanizeReply(
        "Pode me mandar só o nome que eu já sigo procurando os horários para você.",
        session,
      );
      addMessage(session, "assistant", reply);
      return { session, quickReplies: [] };
    }

    session.patientName = extractedName;
    session.stage = "preference";
    const reply = await humanizeReply(
      `Perfeito, ${session.patientName}. Agora me fala um dia ou período que seja melhor para você, e eu já te trago as opções.`,
      session,
    );
    addMessage(session, "assistant", reply);
    return { session, quickReplies: getQuickReplies("preference") };
  }

  if (session.stage === "preference") {
    const recommendation = session.recommendation!;
    const preference = parsePreference(trimmed);
    const slotResult = buildSlotOptions(recommendation, preference);
    session.offeredSlots = slotResult.slots;
    session.stage = "slot_choice";

    const reply = await humanizeReply(
      buildSlotMessage(recommendation, slotResult),
      session,
    );
    addMessage(session, "assistant", reply);
    return {
      session,
      quickReplies: getQuickReplies("slot_choice", session.offeredSlots),
    };
  }

  if (session.stage === "slot_choice") {
    const chosen = matchSlotChoice(trimmed, session.offeredSlots);

    if (!chosen) {
      const updatedSlotResult = buildSlotOptions(
        session.recommendation!,
        parsePreference(trimmed),
      );

      session.offeredSlots = updatedSlotResult.slots;

      const reply = await humanizeReply(
        buildSlotMessage(session.recommendation!, updatedSlotResult),
        session,
      );
      addMessage(session, "assistant", reply);
      return {
        session,
        quickReplies: getQuickReplies("slot_choice", session.offeredSlots),
      };
    }

    session.selectedSlot = chosen;
    session.stage = "confirmation";
    const reply = await humanizeReply(
      `Fechou. Posso confirmar ${formatSlot(chosen)} no nome de ${session.patientName}?`,
      session,
    );
    addMessage(session, "assistant", reply);
    return { session, quickReplies: getQuickReplies("confirmation") };
  }

  if (session.stage === "confirmation") {
    if (isNegative(trimmed)) {
      session.selectedSlot = undefined;
      session.stage = "preference";
      const reply = await humanizeReply(
        "Sem problema. Me manda outro dia ou período que eu procuro de novo.",
        session,
      );
      addMessage(session, "assistant", reply);
      return { session, quickReplies: getQuickReplies("preference") };
    }

    if (!isPositive(trimmed) || !session.selectedSlot) {
      const reply = await humanizeReply(
        "Se estiver tudo certo, me responde com um 'sim'. Se quiser mudar, me fala outro dia ou horário.",
        session,
      );
      addMessage(session, "assistant", reply);
      return { session, quickReplies: getQuickReplies("confirmation") };
    }

    const slot = session.selectedSlot;
    createBooking({
      doctorId: slot.doctorId,
      serviceId: slot.serviceId,
      date: slot.date,
      time: slot.time,
      patientName: session.patientName!,
    });

    session.stage = "completed";
    const reply = await humanizeReply(
      `Prontinho, ${session.patientName}. Seu horário ficou confirmado para ${formatSlot(slot)}. Se quiser, eu também posso te ajudar a recomeçar e marcar outra consulta.`,
      session,
    );
    addMessage(session, "assistant", reply);
    return { session, quickReplies: getQuickReplies("completed") };
  }

  const reply = await humanizeReply(
    "Se quiser, a gente pode começar de novo. Me conta seu nome e o que você está sentindo.",
    session,
  );
  addMessage(session, "assistant", reply);
  return { session, quickReplies: getQuickReplies("symptoms") };
}

export async function buildSessionSummary(session: ChatSession): Promise<string> {
  if (!session.recommendation) {
    return "Ainda estamos coletando as informações iniciais.";
  }

  if (session.selectedSlot) {
    return `Especialista indicado: ${session.recommendation.doctorName}. Horário em foco: ${formatSlot(session.selectedSlot)}.`;
  }

  if (session.offeredSlots.length > 0) {
    return `Especialista indicado: ${session.recommendation.doctorName}. Já existem opções de agenda separadas para escolha.`;
  }

  return `Especialista indicado: ${session.recommendation.doctorName}. Próximo passo: descobrir o melhor dia ou período.`;
}
