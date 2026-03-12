export type DoctorId = "mario" | "stefania";

export type ServiceId =
  | "exam-cleaning"
  | "whitening"
  | "implant-consult"
  | "pediatric-visit"
  | "emergency";

export interface ScheduleBreak {
  start: string;
  end: string;
  label?: string;
}

export interface BusinessWindow {
  weekday: number;
  start: string;
  end: string;
  breaks?: ScheduleBreak[];
}

export interface Doctor {
  id: DoctorId;
  name: string;
  role: string;
  bio: string;
  chatBlurb: string;
  languages: string[];
  specialties: string[];
  background: string;
  weeklyTemplate: BusinessWindow[];
}

export interface Service {
  id: ServiceId;
  name: string;
  category: string;
  durationMinutes: number;
  priceLabel: string;
  description: string;
}

export interface ClinicProfile {
  name: string;
  tagline: string;
  city: string;
  address: string;
  phone: string;
  email: string;
  businessCase: string;
  positioning: string;
  operatingModel: string;
  demoUseCase: string;
}

export interface ExperiencePillar {
  title: string;
  description: string;
}

export interface BookingRecord {
  id: string;
  doctorId: DoctorId;
  serviceId: ServiceId;
  date: string;
  time: string;
  patientName: string;
  createdAt: string;
}

export interface BookingPayload {
  doctorId: DoctorId;
  serviceId: ServiceId;
  date: string;
  time: string;
  patientName: string;
}

export interface AvailabilityCheck {
  doctorId?: DoctorId;
  serviceId: ServiceId;
  date: string;
  time: string;
}

export interface SuggestedSlot {
  doctorId: DoctorId;
  doctorName: string;
  date: string;
  time: string;
  serviceId: ServiceId;
  serviceName: string;
}

export interface AvailabilityResponse {
  available: boolean;
  message: string;
  requested: {
    doctorId?: DoctorId;
    doctorName: string;
    serviceId: ServiceId;
    serviceName: string;
    date: string;
    time: string;
  };
  alternatives: SuggestedSlot[];
}

export interface BookingResponse {
  message: string;
  booking: BookingRecord;
  alternatives: SuggestedSlot[];
}

export type ChatRole = "assistant" | "user";

export type ChatStage =
  | "symptoms"
  | "name"
  | "preference"
  | "slot_choice"
  | "confirmation"
  | "completed";

export type Period = "morning" | "afternoon" | "evening";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: string;
}

export interface ChatRecommendation {
  doctorId: DoctorId;
  doctorName: string;
  serviceId: ServiceId;
  serviceName: string;
  reason: string;
}

export interface ChatSession {
  id: string;
  stage: ChatStage;
  patientName?: string;
  symptoms?: string;
  recommendation?: ChatRecommendation;
  offeredSlots: SuggestedSlot[];
  selectedSlot?: SuggestedSlot;
  messages: ChatMessage[];
  preferredPeriod?: Period;
  stuckTurnCount?: number;
  previousPatientName?: string;
  familyContext?: string;
}

export interface ChatResponse {
  sessionId: string;
  messages: ChatMessage[];
  stage: ChatStage;
  quickReplies: string[];
  recommendation?: ChatRecommendation;
  offeredSlots: SuggestedSlot[];
  selectedSlot?: SuggestedSlot;
}

export interface KnowledgeDocument {
  slug: string;
  title: string;
  category: string;
  summary: string;
  body: string;
  tags: string[];
}

export interface KnowledgeSearchResult extends KnowledgeDocument {
  score: number;
  excerpt: string;
}
