import { createBooking } from "@/lib/booking-store";
import { findAvailability, getSuggestedSlots } from "@/lib/availability";
import {
  daysFromToday,
  formatDateLabel,
  getWeekday,
  timeToMinutes,
  toDateKey,
} from "@/lib/date";
import { getDoctorById, getServiceById } from "@/lib/clinic-data";
import {
  ChatMessage,
  ChatRecommendation,
  ChatSession,
  ChatStage,
  DoctorId,
  ServiceId,
  SuggestedSlot,
} from "@/lib/types";

export const chatStageValues = [
  "symptoms",
  "name",
  "preference",
  "slot_choice",
  "confirmation",
  "completed",
] as const satisfies readonly ChatStage[];

function toDisplayName(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function normalizeNameToken(token: string): string {
  return normalize(token).replace(/[^a-z]/g, "");
}

function cleanExtractedName(rawName: string): string | undefined {
  const stopTokens = new Set([
    "e",
    "oi",
    "ola",
    "olá",
    "bom",
    "boa",
    "dia",
    "tarde",
    "noite",
    "estou",
    "to",
    "tô",
    "com",
    "sentindo",
    "tenho",
    "quero",
    "queria",
    "preciso",
    "marcar",
    "pra",
    "para",
  ]);

  const tokens = rawName
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean);

  const validTokens: string[] = [];

  for (const token of tokens) {
    const normalizedToken = normalizeNameToken(token);
    if (!normalizedToken || stopTokens.has(normalizedToken)) {
      break;
    }

    validTokens.push(token);
    if (validTokens.length >= 3) {
      break;
    }
  }

  if (validTokens.length === 0) {
    return undefined;
  }

  return toDisplayName(validTokens.join(" "));
}

export function createMessage(
  role: ChatMessage["role"],
  text: string,
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    text,
    createdAt: new Date().toISOString(),
  };
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function getFirstName(name?: string): string | undefined {
  return name?.trim().split(/\s+/)[0];
}

export function extractName(text: string, fallback = false): string | undefined {
  const match = text.match(
    /(?:meu nome é|meu nome e|my name is|me chamo|aqui é|sou o|sou a|sou)\s+([a-zA-ZÀ-ÿ]+(?:\s+[a-zA-ZÀ-ÿ]+){0,2})/i,
  );

  if (match?.[1]) {
    return cleanExtractedName(match[1]);
  }

  if (fallback) {
    const trimmed = text.trim();
    if (trimmed.length > 1 && trimmed.split(/\s+/).length <= 3) {
      return cleanExtractedName(trimmed);
    }
  }

  return undefined;
}

export function addNaturalNameReference(
  draft: string,
  session: Pick<ChatSession, "patientName" | "stage">,
): string {
  const firstName = getFirstName(session.patientName);
  if (!firstName) {
    return draft;
  }

  const normalizedDraft = normalize(draft);
  if (normalizedDraft.includes(normalize(firstName))) {
    return draft;
  }

  const cleanedDraft = draft.replace(
    /^(oi|olá|ola|bom dia|boa tarde|boa noite)[!,.\s-]*/i,
    "",
  );

  if (!cleanedDraft) {
    return `Tudo certo, ${firstName}.`;
  }

  const openerReplacements: Array<[RegExp, string]> = [
    [/^perfeito,\s*/i, `Perfeito, ${firstName}. `],
    [/^entendi,\s*/i, `Entendi, ${firstName}. `],
    [/^beleza,\s*/i, `Beleza, ${firstName}. `],
    [/^boa,\s*/i, `Boa, ${firstName}. `],
    [/^certo,\s*/i, `Certo, ${firstName}. `],
    [/^prontinho,\s*/i, `Prontinho, ${firstName}. `],
    [/^tudo certo,\s*/i, `Tudo certo, ${firstName}. `],
  ];

  for (const [pattern, replacement] of openerReplacements) {
    if (pattern.test(cleanedDraft)) {
      return cleanedDraft.replace(pattern, replacement);
    }
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

  return `${prefix}${cleanedDraft}`;
}

export function getAssistantTurnCount(messages: ChatMessage[]): number {
  return messages.filter((message) => message.role === "assistant").length;
}

export function buildRecentTranscript(
  messages: ChatMessage[],
  limit = 6,
): string {
  return messages
    .slice(-limit)
    .map((message) =>
      `${message.role === "assistant" ? "Assistente" : "Paciente"}: ${message.text}`,
    )
    .join("\n");
}

export function guessRecommendation(
  symptoms: string,
  preferredDoctorId?: DoctorId,
): ChatRecommendation {
  const normalizedText = normalize(symptoms);

  if (preferredDoctorId) {
    const doctor = getDoctorById(preferredDoctorId);
    const serviceId: ServiceId =
      preferredDoctorId === "mario" ? "implant-consult" : "exam-cleaning";

    return {
      doctorId: doctor.id,
      doctorName: doctor.name,
      serviceId,
      serviceName: getServiceById(serviceId).name,
      reason: doctor.chatBlurb,
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
    ].some((term) => normalizedText.includes(term))
  ) {
    const doctor = getDoctorById("stefania");
    return {
      doctorId: "stefania",
      doctorName: doctor.name,
      serviceId: "emergency",
      serviceName: getServiceById("emergency").name,
      reason: doctor.chatBlurb,
    };
  }

  if (
    ["implante", "coroa", "protese", "prótese", "reabilit", "faceta", "lente"]
      .some((term) => normalizedText.includes(term))
  ) {
    const doctor = getDoctorById("mario");
    return {
      doctorId: "mario",
      doctorName: doctor.name,
      serviceId: "implant-consult",
      serviceName: getServiceById("implant-consult").name,
      reason: doctor.chatBlurb,
    };
  }

  if (
    ["clareamento", "mancha", "estet", "sorriso", "branco"].some((term) =>
      normalizedText.includes(term),
    )
  ) {
    const doctor = getDoctorById("stefania");
    return {
      doctorId: "stefania",
      doctorName: doctor.name,
      serviceId: "whitening",
      serviceName: getServiceById("whitening").name,
      reason: doctor.chatBlurb,
    };
  }

  if (
    ["crianca", "criança", "filho", "filha", "infantil", "pediatr"].some(
      (term) => normalizedText.includes(term),
    )
  ) {
    const doctor = getDoctorById("stefania");
    return {
      doctorId: "stefania",
      doctorName: doctor.name,
      serviceId: "pediatric-visit",
      serviceName: getServiceById("pediatric-visit").name,
      reason: doctor.chatBlurb,
    };
  }

  const doctor = getDoctorById("stefania");
  return {
    doctorId: "stefania",
    doctorName: doctor.name,
    serviceId: "exam-cleaning",
    serviceName: getServiceById("exam-cleaning").name,
    reason: doctor.chatBlurb,
  };
}

export function getQuickReplies(
  stage: ChatStage,
  slots: SuggestedSlot[] = [],
): string[] {
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
  const normalizedText = normalize(text);
  return ["oi", "ola", "olá", "bom dia", "boa tarde", "boa noite"].includes(
    normalizedText,
  );
}

export function resetRequested(text: string): boolean {
  const normalizedText = normalize(text);
  return [
    "reiniciar",
    "recomecar",
    "comecar de novo",
    "novo atendimento",
  ].some((term) => normalizedText.includes(term));
}

export function parsePreferredDoctor(text: string): DoctorId | undefined {
  const normalizedText = normalize(text);
  if (normalizedText.includes("mario")) {
    return "mario";
  }
  if (normalizedText.includes("stefania")) {
    return "stefania";
  }
  return undefined;
}

export function containsClinicalContext(text: string): boolean {
  const normalizedText = normalize(text);
  if (isGreeting(normalizedText)) {
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

  return terms.some((term) => normalizedText.includes(term)) || text.trim().length > 18;
}

export type Period = "morning" | "afternoon" | "evening";
export type WeekdayOccurrence = 1 | 2 | 3 | 4 | "last";
export type ApproximateTimeWindowKey =
  | "near_noon"
  | "midday"
  | "late_morning"
  | "early_afternoon"
  | "after_lunch";

export interface ApproximateTimeWindow {
  start: string;
  end: string;
  label: string;
}

export interface ParsedPreference {
  date?: string;
  startDate?: string;
  endDate?: string;
  weekday?: number;
  weekdayOccurrence?: WeekdayOccurrence;
  exactTime?: string;
  period?: Period;
  timeWindow?: ApproximateTimeWindow;
  weekendRequested?: boolean;
}

interface SlotSuggestionResult {
  slots: SuggestedSlot[];
  note?: string;
}

interface PreferenceMonthWindow {
  startDate: string;
  endDate: string;
}

const approximateTimeWindowPresets: Record<
  ApproximateTimeWindowKey,
  ApproximateTimeWindow & { terms: string[] }
> = {
  near_noon: {
    start: "11:00",
    end: "12:30",
    label: "perto do meio-dia",
    terms: [
      "quase meio dia",
      "quase meio-dia",
      "casi al mediodia",
      "antes do almoco",
      "antes do almoço",
      "perto do almoco",
      "perto do almoço",
    ],
  },
  midday: {
    start: "11:30",
    end: "13:30",
    label: "na faixa do meio-dia",
    terms: [
      "meio dia",
      "meio-dia",
      "mediodia",
      "hora do almoco",
      "hora do almoço",
    ],
  },
  late_morning: {
    start: "10:30",
    end: "12:30",
    label: "no fim da manhã",
    terms: [
      "fim da manha",
      "final da manha",
      "fim de manha",
      "fim da manhã",
    ],
  },
  early_afternoon: {
    start: "12:00",
    end: "14:30",
    label: "no começo da tarde",
    terms: [
      "comeco da tarde",
      "comeco de tarde",
      "inicio da tarde",
      "depois do almoco",
      "depois do almoço",
      "logo depois do almoco",
      "logo depois do almoço",
    ],
  },
  after_lunch: {
    start: "13:00",
    end: "15:30",
    label: "depois de comer",
    terms: [
      "depois de comer",
      "despues de comer",
      "after lunch",
      "depois do cafe",
      "depois do café",
      "depois de almocar",
      "depois de almoçar",
    ],
  },
};

export function getApproximateTimeWindowByKey(
  key?: ApproximateTimeWindowKey | null,
): ApproximateTimeWindow | undefined {
  if (!key) {
    return undefined;
  }

  const preset = approximateTimeWindowPresets[key];
  if (!preset) {
    return undefined;
  }

  return {
    start: preset.start,
    end: preset.end,
    label: preset.label,
  };
}

export function hasParsedPreferenceSignal(preference: ParsedPreference): boolean {
  return (
    Boolean(preference.date) ||
    Boolean(preference.startDate) ||
    Boolean(preference.endDate) ||
    preference.weekday !== undefined ||
    Boolean(preference.exactTime) ||
    Boolean(preference.period) ||
    Boolean(preference.timeWindow)
  );
}

export function mergeParsedPreferences(
  ...preferences: Array<Partial<ParsedPreference> | undefined>
): ParsedPreference {
  const merged: ParsedPreference = {};

  for (const preference of preferences) {
    if (!preference) {
      continue;
    }

    if (preference.date !== undefined) {
      merged.date = preference.date;
    }
    if (preference.startDate !== undefined) {
      merged.startDate = preference.startDate;
    }
    if (preference.endDate !== undefined) {
      merged.endDate = preference.endDate;
    }
    if (preference.weekday !== undefined) {
      merged.weekday = preference.weekday;
    }
    if (preference.weekdayOccurrence !== undefined) {
      merged.weekdayOccurrence = preference.weekdayOccurrence;
    }
    if (preference.exactTime !== undefined) {
      merged.exactTime = preference.exactTime;
    }
    if (preference.period !== undefined) {
      merged.period = preference.period;
    }
    if (preference.timeWindow !== undefined) {
      merged.timeWindow = preference.timeWindow;
    }
    if (preference.weekendRequested !== undefined) {
      merged.weekendRequested = preference.weekendRequested;
    }
  }

  return merged;
}

function detectApproximateTimeWindow(
  normalizedText: string,
): ApproximateTimeWindow | undefined {
  return Object.values(approximateTimeWindowPresets).find((window) =>
    window.terms.some((term) => normalizedText.includes(term)),
  );
}

function compactPreferenceText(text: string): string {
  const tokens = text
    .replace(/[.,;:!?/()[\]{}]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  return tokens
    .filter((token, index) => index === 0 || token !== tokens[index - 1])
    .join(" ");
}

function buildMonthWindow(monthOffset: number): PreferenceMonthWindow {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const end = new Date(today.getFullYear(), today.getMonth() + monthOffset + 1, 0);

  if (monthOffset === 0 && start < today) {
    start.setTime(today.getTime());
  }

  return {
    startDate: toDateKey(start),
    endDate: toDateKey(end),
  };
}

function clampMonthWindow(
  window: PreferenceMonthWindow,
  part: "early" | "mid" | "late",
): PreferenceMonthWindow {
  const [year, month] = window.startDate.split("-").map(Number);
  const monthIndex = month - 1;

  if (part === "early") {
    return {
      startDate: window.startDate,
      endDate: toDateKey(new Date(year, monthIndex, 10)),
    };
  }

  if (part === "mid") {
    return {
      startDate: toDateKey(new Date(year, monthIndex, 11)),
      endDate: toDateKey(new Date(year, monthIndex, 20)),
    };
  }

  const endDay = Number(window.endDate.slice(-2));
  return {
    startDate: toDateKey(new Date(year, monthIndex, Math.max(21, endDay - 9))),
    endDate: window.endDate,
  };
}

function detectMonthQualifier(
  normalizedText: string,
): "early" | "mid" | "late" | undefined {
  if (
    [
      "comeco do mes",
      "comeco de mes",
      "inicio do mes",
      "inicio de mes",
      "principios de mes",
      "a principios del mes",
      "principios del proximo mes",
      "inicio del proximo mes",
      "start of month",
    ].some((term) => normalizedText.includes(term))
  ) {
    return "early";
  }

  if (
    [
      "meados do mes",
      "metade do mes",
      "mediados de mes",
      "mediados del proximo mes",
      "middle of month",
    ].some((term) => normalizedText.includes(term))
  ) {
    return "mid";
  }

  if (
    [
      "fim do mes",
      "fim de mes",
      "final do mes",
      "final de mes",
      "fines del mes",
      "fin de mes",
      "fines del proximo mes",
      "fin del proximo mes",
      "final do proximo mes",
      "end of month",
    ].some((term) => normalizedText.includes(term))
  ) {
    return "late";
  }

  return undefined;
}

function detectMonthWindow(
  normalizedText: string,
): PreferenceMonthWindow | undefined {
  const monthQualifier = detectMonthQualifier(normalizedText);

  if (
    [
      "proximo mes",
      "mes que vem",
      "mes que viene",
      "next month",
    ].some((term) => normalizedText.includes(term))
  ) {
    const window = buildMonthWindow(1);
    return monthQualifier ? clampMonthWindow(window, monthQualifier) : window;
  }

  if (
    ["este mes", "esse mes", "this month"].some((term) =>
      normalizedText.includes(term),
    )
  ) {
    const window = buildMonthWindow(0);
    return monthQualifier ? clampMonthWindow(window, monthQualifier) : window;
  }

  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchWeekdayPreference(
  normalizedText: string,
): { weekday: number; labels: string[]; occurrence?: WeekdayOccurrence } | undefined {
  const weekdayEntries = [
    { weekday: 1, labels: ["segunda", "lunes"] },
    { weekday: 2, labels: ["terca", "martes"] },
    { weekday: 3, labels: ["quarta", "miercoles"] },
    { weekday: 4, labels: ["quinta", "jueves"] },
    { weekday: 5, labels: ["sexta", "viernes"] },
  ];

  const occurrenceEntries: Array<[WeekdayOccurrence, string[]]> = [
    ["last", ["ultima", "ultimo", "last", "final"]],
    [1, ["primeira", "primeiro", "primer", "primera", "first"]],
    [2, ["segunda", "segundo", "second"]],
    [3, ["terceira", "terceiro", "tercer", "tercera", "third"]],
    [4, ["quarta", "quarto", "cuarta", "fourth"]],
  ];

  for (const weekdayEntry of weekdayEntries) {
    const labelPattern = weekdayEntry.labels
      .map((label) => `${escapeRegExp(label)}(?:-feira)?`)
      .join("|");

    for (const [occurrence, occurrenceTerms] of occurrenceEntries) {
      const occurrencePattern = occurrenceTerms.map(escapeRegExp).join("|");
      const regex = new RegExp(
        `\\b(?:${occurrencePattern})\\s+(?:${labelPattern})\\b`,
      );

      if (regex.test(normalizedText)) {
        return {
          weekday: weekdayEntry.weekday,
          labels: weekdayEntry.labels,
          occurrence,
        };
      }
    }
  }

  for (const weekdayEntry of weekdayEntries) {
    const labelPattern = weekdayEntry.labels
      .map((label) => `${escapeRegExp(label)}(?:-feira)?`)
      .join("|");

    if (new RegExp(`\\b(?:${labelPattern})\\b`).test(normalizedText)) {
      return weekdayEntry;
    }
  }

  return undefined;
}

function pickDateForOccurrence(
  availableDates: string[],
  occurrence?: WeekdayOccurrence,
): string | undefined {
  if (!occurrence) {
    return undefined;
  }

  if (occurrence === "last") {
    return availableDates.at(-1);
  }

  return availableDates[occurrence - 1];
}

function nextWeekday(
  weekday: number,
  options: { allowToday?: boolean; forceNextWeek?: boolean } = {},
): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const candidate = new Date(today);

  while (candidate.getDay() !== weekday) {
    candidate.setDate(candidate.getDate() + 1);
  }

  if (candidate.getTime() === today.getTime() && !options.allowToday) {
    candidate.setDate(candidate.getDate() + 7);
  } else if (options.forceNextWeek) {
    candidate.setDate(candidate.getDate() + 7);
  }

  return toDateKey(candidate);
}

export function parsePreference(text: string): ParsedPreference {
  const normalizedText = compactPreferenceText(normalize(text));
  let date: string | undefined;
  let startDate: string | undefined;
  let endDate: string | undefined;
  let weekday: number | undefined;
  let weekdayOccurrence: WeekdayOccurrence | undefined;
  let period: Period | undefined;
  let exactTime: string | undefined;
  let weekendRequested = false;
  const monthWindow = detectMonthWindow(normalizedText);

  if (monthWindow) {
    startDate = monthWindow.startDate;
    endDate = monthWindow.endDate;
  }

  // Handle "depois de amanha" (day after tomorrow)
  if (
    normalizedText.includes("depois de amanha") ||
    normalizedText.includes("pasado manana")
  ) {
    const dayAfterTomorrow = new Date();
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
    date = toDateKey(dayAfterTomorrow);
  } else if (
    normalizedText.includes("amanha") ||
    normalizedText.includes("manana")
  ) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    date = toDateKey(tomorrow);
  }

  if (normalizedText.includes("hoje") || normalizedText.includes("hoy")) {
    date = toDateKey(new Date());
  }

  const weekendDays: Record<string, number> = {
    sabado: 6,
    domingo: 0,
  };

  const weekdayMatch = matchWeekdayPreference(normalizedText);
  if (weekdayMatch) {
    const refersToCurrentWeek = weekdayMatch.labels.some((label) =>
      [
        `este ${label}`,
        `esta ${label}`,
        `esse ${label}`,
        `essa ${label}`,
      ].some((term) => normalizedText.includes(term)),
    );
    const refersToNextWeek = weekdayMatch.labels.some((label) =>
      [
        `proxima ${label}`,
        `proximo ${label}`,
        `siguiente ${label}`,
        `next ${label}`,
      ].some((term) => normalizedText.includes(term)),
    );

    if (startDate && endDate) {
      weekday = weekdayMatch.weekday;
      weekdayOccurrence = weekdayMatch.occurrence;
    } else {
      date = nextWeekday(weekdayMatch.weekday, {
        allowToday: refersToCurrentWeek || !refersToNextWeek,
        forceNextWeek: refersToNextWeek,
      });
    }
  }

  // Check for weekend requests
  for (const [label] of Object.entries(weekendDays)) {
    if (normalizedText.includes(label)) {
      weekendRequested = true;
      // Suggest next available weekday instead
      date = nextWeekday(5); // Next Friday
      break;
    }
  }

  // Check for "fim de semana" (weekend)
  if (
    normalizedText.includes("fim de semana") ||
    normalizedText.includes("fin de semana")
  ) {
    weekendRequested = true;
    date = nextWeekday(5); // Suggest Friday
  }

  const timeWindow = detectApproximateTimeWindow(normalizedText);

  const slashDate = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
  if (slashDate) {
    const day = Number(slashDate[1]);
    const month = Number(slashDate[2]);
    const year = Number(slashDate[3] ?? new Date().getFullYear());
    date = toDateKey(new Date(year, month - 1, day));
    startDate = undefined;
    endDate = undefined;
    weekday = undefined;
    weekdayOccurrence = undefined;
  }

  const isoDate = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoDate) {
    date = `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`;
    startDate = undefined;
    endDate = undefined;
    weekday = undefined;
    weekdayOccurrence = undefined;
  }

  if (normalizedText.includes("manha") || normalizedText.includes("cedo")) {
    period = "morning";
  } else if (normalizedText.includes("tarde")) {
    period = "afternoon";
  } else if (normalizedText.includes("noite")) {
    period = "evening";
  }

  const timeMatch =
    text.match(/(?:às|as)\s*(\d{1,2})(?::(\d{2}))?/i) ??
    text.match(/\b(\d{1,2})h(?:(\d{2}))?\b/i) ??
    text.match(/\b(\d{1,2}):(\d{2})\b/);
  const amPmMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);

  if (timeMatch) {
    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2] ?? "00");
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      exactTime = `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}`;
    }
  } else if (amPmMatch) {
    const rawHours = Number(amPmMatch[1]);
    const minutes = Number(amPmMatch[2] ?? "00");
    const suffix = amPmMatch[3].toLowerCase();

    if (rawHours >= 1 && rawHours <= 12 && minutes >= 0 && minutes <= 59) {
      let hours = rawHours % 12;
      if (suffix === "pm") {
        hours += 12;
      }

      exactTime = `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}`;
    }
  }

  return {
    date,
    startDate,
    endDate,
    weekday,
    weekdayOccurrence,
    exactTime,
    period,
    timeWindow,
    weekendRequested,
  };
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

function fitsTimeWindow(
  slot: SuggestedSlot,
  timeWindow?: ApproximateTimeWindow,
): boolean {
  if (!timeWindow) {
    return true;
  }

  const slotMinutes = timeToMinutes(slot.time);
  return (
    slotMinutes >= timeToMinutes(timeWindow.start) &&
    slotMinutes <= timeToMinutes(timeWindow.end)
  );
}

function buildFallbackSlots(recommendation: ChatRecommendation): SuggestedSlot[] {
  return getSuggestedSlots({
    doctorId: recommendation.doctorId,
    serviceId: recommendation.serviceId,
    limit: 4,
  });
}

export function buildSlotOptions(
  recommendation: ChatRecommendation,
  preference: ParsedPreference,
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
      note: "Esse horário exato eu não consegui, mas já vi opções próximas para você.",
    };
  }

  let slots = getSuggestedSlots({
    doctorId: recommendation.doctorId,
    serviceId: recommendation.serviceId,
    limit: 8,
    startDate: preference.date ?? preference.startDate,
    endDate: preference.endDate,
  });

  if (preference.date) {
    slots = slots.filter((slot) => slot.date === preference.date);
  }

  if (preference.weekday !== undefined && !preference.date) {
    slots = slots.filter((slot) => getWeekday(slot.date) === preference.weekday);
  }

  if (
    preference.startDate &&
    preference.endDate &&
    preference.weekday !== undefined &&
    preference.weekdayOccurrence
  ) {
    const uniqueDates = [...new Set(slots.map((slot) => slot.date))];
    const targetedDate = pickDateForOccurrence(
      uniqueDates,
      preference.weekdayOccurrence,
    );
    slots = targetedDate
      ? slots.filter((slot) => slot.date === targetedDate)
      : [];
  }

  slots = slots.filter((slot) => fitsPeriod(slot, preference.period));

  if (preference.timeWindow && !preference.exactTime) {
    slots = slots.filter((slot) => fitsTimeWindow(slot, preference.timeWindow));
  }

  if (preference.exactTime) {
    slots = slots.filter((slot) => slot.time === preference.exactTime);
  }

  const matchedRequestedPreference = slots.length > 0;

  if (!matchedRequestedPreference) {
    slots = buildFallbackSlots(recommendation);
  }

  let note: string | undefined;

  if (
    matchedRequestedPreference &&
    preference.startDate &&
    preference.endDate &&
    !note
  ) {
    const uniqueDates = [...new Set(slots.map((slot) => slot.date))];
    if (uniqueDates.length === 1) {
      note = `Nesse período, o que tenho disponível é ${formatDateLabel(uniqueDates[0])}.`;
    }
  }

  if (preference.weekendRequested) {
    note = "Não temos sábado ou domingo, mas separei horários para sexta-feira que é o dia mais próximo!";
  } else if (!matchedRequestedPreference) {
    if (preference.date && preference.period && preference.exactTime) {
      note =
        "Nesse horário e período eu não consegui te encaixar, mas separei alternativas próximas.";
    } else if (
      preference.startDate &&
      preference.endDate &&
      preference.weekday !== undefined &&
      preference.weekdayOccurrence
    ) {
      note =
        "Nesse dia específico dentro do mês eu não achei vaga, mas já separei algumas alternativas próximas.";
    } else if (preference.startDate && preference.endDate && preference.weekday !== undefined) {
      note =
        "Nesse dia da semana dentro desse período eu não achei vaga, mas já separei outras opções próximas.";
    } else if (preference.date && preference.timeWindow) {
      note = `Nessa faixa ${preference.timeWindow.label} eu não achei vaga nesse dia, mas já separei opções próximas.`;
    } else if (preference.startDate && preference.endDate) {
      note =
        "Nesse período eu não achei vaga do jeito pedido, mas já separei algumas alternativas próximas.";
    } else if (preference.date && preference.period) {
      note =
        "Nesse período eu não achei vaga nesse dia, mas já puxei outras opções para você.";
    } else if (preference.date && preference.exactTime) {
      note =
        "Nesse horário desse dia eu não consegui te encaixar, mas já separei opções próximas.";
    } else if (preference.date) {
      note =
        "Nesse dia específico eu não achei um horário bom, mas já trouxe outras opções.";
    } else if (preference.exactTime) {
      note = `Às ${preference.exactTime} eu não achei vaga agora, mas já separei horários próximos.`;
    } else if (preference.timeWindow) {
      note = `Nessa faixa ${preference.timeWindow.label} eu não achei vaga agora, mas já separei horários próximos.`;
    } else if (preference.period) {
      note = "Nesse período eu não achei vaga agora, mas já separei outros horários.";
    }
  }

  return {
    slots: slots.slice(0, 4),
    note,
  };
}

export function formatSlot(slot: SuggestedSlot): string {
  return `${formatDateLabel(slot.date)}, às ${slot.time}, com ${slot.doctorName}`;
}

export function buildSlotMessage(
  recommendation: ChatRecommendation,
  result: SlotSuggestionResult,
): string {
  const { slots, note } = result;

  if (slots.length === 0) {
    const fallbackMessage =
      note ??
      `${recommendation.doctorName} está bem ocupada nesse período. Quer tentar outro dia ou talvez um outro especialista?`;
    return fallbackMessage;
  }

  const list = slots
    .map((slot, index) => `${index + 1}. ${formatSlot(slot)}`)
    .join("\n");

  const intro = note
    ? `${note}\n\n`
    : `Separei estas opções para ${recommendation.serviceName}:\n`;

  return `${intro}${list}\n\nMe responde com o número da opção ou me fala outro dia/horário.`;
}

export function extractSlotChoiceNumber(text: string): number | undefined {
  const normalizedText = normalize(text).replace(/[!?.,]/g, " ");
  const compactText = normalizedText.replace(/\s+/g, " ").trim();

  const choicePatterns: Array<[RegExp, number]> = [
    [/^(?:a\s+)?1$/, 1],
    [/^(?:a\s+)?primeira$/, 1],
    [/\bopcao\s*1\b/, 1],
    [/^(?:quero|prefiro|pode ser)\s+(?:a\s+)?(?:opcao\s*)?1$/, 1],
    [/^(?:a\s+)?2$/, 2],
    [/^(?:a\s+)?segunda$/, 2],
    [/\bopcao\s*2\b/, 2],
    [/^(?:quero|prefiro|pode ser)\s+(?:a\s+)?(?:opcao\s*)?2$/, 2],
    [/^(?:a\s+)?3$/, 3],
    [/^(?:a\s+)?terceira$/, 3],
    [/\bopcao\s*3\b/, 3],
    [/^(?:quero|prefiro|pode ser)\s+(?:a\s+)?(?:opcao\s*)?3$/, 3],
    [/^(?:a\s+)?4$/, 4],
    [/^(?:a\s+)?quarta$/, 4],
    [/\bopcao\s*4\b/, 4],
    [/^(?:quero|prefiro|pode ser)\s+(?:a\s+)?(?:opcao\s*)?4$/, 4],
  ];

  for (const [pattern, optionNumber] of choicePatterns) {
    if (pattern.test(compactText)) {
      return optionNumber;
    }
  }

  return undefined;
}

export function matchSlotChoice(
  text: string,
  slots: SuggestedSlot[],
): SuggestedSlot | undefined {
  const selectedOptionNumber = extractSlotChoiceNumber(text);
  if (selectedOptionNumber) {
    return slots[selectedOptionNumber - 1];
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

export function isPositive(text: string): boolean {
  const normalizedText = normalize(text);
  return [
    "sim",
    "pode confirmar",
    "fechado",
    "confirmar",
    "pode ser",
    "bora",
  ].some((term) => normalizedText.includes(term));
}

export function isNegative(text: string): boolean {
  const normalizedText = normalize(text);
  return [
    "nao",
    "não",
    "outro horario",
    "outro horário",
    "prefiro outro",
  ].some((term) => normalizedText.includes(term));
}

export function detectDoctorChangeRequest(text: string): boolean {
  const normalizedText = normalize(text);
  return [
    "outro doutor",
    "outro medico",
    "outro médico",
    "outro dentista",
    "outra medica",
    "outra médica",
    "outro profissional",
    "prefiro outro",
    "tem outro",
    "existe outro",
    "diferente doutor",
  ].some((term) => normalizedText.includes(term));
}

export function isCancellation(text: string): boolean {
  const normalizedText = normalize(text);
  return [
    "esquece",
    "nao quero mais",
    "não quero mais",
    "desisti",
    "cancela",
    "deixa pra la",
    "deixa pra lá",
    "never mind",
    "forget it",
  ].some((term) => normalizedText.includes(term));
}

export function isFamilyBookingRequest(text: string): boolean {
  const normalizedText = normalize(text);
  return [
    "minha filha",
    "meu filho",
    "minha esposa",
    "meu marido",
    "outro paciente",
    "outra pessoa",
  ].some((term) => normalizedText.includes(term));
}

export function extractFamilyContext(text: string): string | undefined {
  const normalizedText = normalize(text);
  if (normalizedText.includes("minha filha")) return "filha";
  if (normalizedText.includes("meu filho")) return "filho";
  if (normalizedText.includes("minha esposa")) return "esposa";
  if (normalizedText.includes("meu marido")) return "marido";
  return undefined;
}

export function createEmptySession(): ChatSession {
  return {
    id: crypto.randomUUID(),
    stage: "symptoms",
    offeredSlots: [],
    messages: [
      createMessage(
        "assistant",
        "Oi! Eu sou a assistente da Aurora Dental. Me conta rapidinho seu nome e o que você está sentindo que eu vejo com quem faz mais sentido te encaixar.",
      ),
    ],
  };
}

export function createInitialChatSession(): ChatSession {
  return createEmptySession();
}

export function confirmBooking(slot: SuggestedSlot, patientName: string): void {
  createBooking({
    doctorId: slot.doctorId,
    serviceId: slot.serviceId,
    date: slot.date,
    time: slot.time,
    patientName,
  });
}

export function buildConfirmationMessage(
  slot: SuggestedSlot,
  patientName: string,
): string {
  const days = daysFromToday(slot.date);
  const proximity =
    days === 0
      ? "ainda hoje"
      : days === 1
        ? "amanhã"
        : `em ${days} dias`;

  return `Prontinho, ${patientName}! Sua consulta de ${slot.serviceName} com ${slot.doctorName} está confirmada para ${formatSlot(slot)} — ${proximity}. Chegue com uns 10 min de antecedência. Se precisar remarcar, é só chamar aqui.`;
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
