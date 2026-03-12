import { demoConfig } from "@/lib/config";
import {
  ClinicProfile,
  Doctor,
  DoctorId,
  ExperiencePillar,
  Service,
  ServiceId,
} from "@/lib/types";

export const clinicProfile: ClinicProfile = {
  name: demoConfig.appName,
  tagline:
    "Um demo elegante de triagem e agendamento conversacional para uma clínica odontológica moderna, com atendimento preventivo, estético, pediátrico e urgente.",
  city: demoConfig.clinicCity,
  address: "2418 South Lamar Blvd, Suite 110, Austin, TX 78704",
  phone: "(512) 555-0138",
  email: "hello@auroradentaldemo.com",
  businessCase: "Odontologia familiar e estética com atendimento concierge",
  positioning:
    "A Aurora Dental Atelier funciona como uma clínica boutique de bairro: atendimento acolhedor, planos de tratamento transparentes e acesso rápido a uma recepção humana.",
  operatingModel:
    "A clínica opera com dois especialistas, horários previsíveis durante a semana e conteúdo curto que ajuda o paciente antes mesmo de ligar.",
  demoUseCase:
    "Este demo cobre o fluxo com maior valor para apresentação de produto: o paciente descreve sintomas, recebe a indicação do especialista correto e confirma um horário disponível.",
};

export const experiencePillars: ExperiencePillar[] = [
  {
    title: "Triagem com confiança",
    description:
      "O paciente relata o que está sentindo e recebe orientação clara antes de marcar.",
  },
  {
    title: "Disponibilidade em tempo real",
    description:
      "O motor de agenda responde na hora se Mario ou Stefania têm aquele horário livre.",
  },
  {
    title: "Contexto pronto para RAG",
    description:
      "Políticas e FAQs ficam em markdown para facilitar busca local ou ingestão futura via MCP.",
  },
];

export const doctors: Doctor[] = [
  {
    id: "mario",
    name: "Dr. Mario Bianchi",
    role: "Dentista líder em reabilitação oral",
    bio: "Mario é focado em reabilitação do sorriso, planejamento de implantes e consultas detalhadas para pacientes adultos que precisam de um plano restaurador claro.",
    languages: ["Inglês", "Italiano", "Português"],
    specialties: ["Implantes", "Planejamento estético", "Reabilitação restauradora"],
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.90), rgba(255,255,255,0.74)), radial-gradient(circle at top left, rgba(99,102,241,0.22), transparent 52%)",
    weeklyTemplate: [
      {
        weekday: 1,
        start: "09:00",
        end: "17:00",
        breaks: [{ start: "12:30", end: "13:30", label: "Almoço" }],
      },
      {
        weekday: 2,
        start: "09:00",
        end: "17:00",
        breaks: [{ start: "12:30", end: "13:30", label: "Almoço" }],
      },
      {
        weekday: 3,
        start: "10:00",
        end: "18:00",
        breaks: [{ start: "13:30", end: "14:15", label: "Revisão de laboratório" }],
      },
      {
        weekday: 4,
        start: "09:00",
        end: "17:00",
        breaks: [{ start: "12:30", end: "13:30", label: "Almoço" }],
      },
      {
        weekday: 5,
        start: "08:30",
        end: "15:30",
        breaks: [{ start: "12:00", end: "12:45", label: "Almoço" }],
      },
    ],
  },
  {
    id: "stefania",
    name: "Dr. Stefania Costa",
    role: "Dentista de família e odontopediatria",
    bio: "Stefania cuida de atendimentos preventivos, consultas pediátricas, clareamento dental e encaixes de urgência na mesma semana com uma abordagem direta e acolhedora.",
    languages: ["Inglês", "Português", "Espanhol"],
    specialties: ["Odontologia de família", "Odontopediatria", "Clareamento dental"],
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.90), rgba(255,255,255,0.74)), radial-gradient(circle at top right, rgba(16,185,129,0.22), transparent 54%)",
    weeklyTemplate: [
      {
        weekday: 1,
        start: "08:00",
        end: "16:00",
        breaks: [{ start: "12:00", end: "13:00", label: "Almoço" }],
      },
      {
        weekday: 2,
        start: "11:00",
        end: "19:00",
        breaks: [{ start: "14:30", end: "15:15", label: "Janela pessoal" }],
      },
      {
        weekday: 3,
        start: "08:00",
        end: "16:00",
        breaks: [{ start: "12:00", end: "13:00", label: "Almoço" }],
      },
      {
        weekday: 4,
        start: "08:00",
        end: "16:00",
        breaks: [{ start: "12:00", end: "13:00", label: "Almoço" }],
      },
      {
        weekday: 5,
        start: "11:00",
        end: "19:00",
        breaks: [{ start: "14:30", end: "15:15", label: "Janela pessoal" }],
      },
    ],
  },
];

export const services: Service[] = [
  {
    id: "exam-cleaning",
    name: "Avaliação completa + limpeza",
    category: "Preventivo",
    durationMinutes: 60,
    priceLabel: "A partir de US$ 185",
    description:
      "Ideal para revisão de rotina, atualização de radiografias e planejamento inicial.",
  },
  {
    id: "whitening",
    name: "Consulta de clareamento dental",
    category: "Estética",
    durationMinutes: 75,
    priceLabel: "A partir de US$ 240",
    description:
      "Inclui análise de cor, avaliação de sensibilidade e plano de clareamento personalizado.",
  },
  {
    id: "implant-consult",
    name: "Consulta de implante",
    category: "Restaurador",
    durationMinutes: 45,
    priceLabel: "A partir de US$ 210",
    description:
      "Consulta focada em substituição dentária, coroas, implantes e reabilitação oral.",
  },
  {
    id: "pediatric-visit",
    name: "Consulta preventiva infantil",
    category: "Família",
    durationMinutes: 45,
    priceLabel: "A partir de US$ 145",
    description:
      "Limpeza, avaliação, flúor e atendimento adaptado para crianças.",
  },
  {
    id: "emergency",
    name: "Atendimento de urgência",
    category: "Urgência",
    durationMinutes: 30,
    priceLabel: "A partir de US$ 165",
    description:
      "Voltado para dor, inchaço, fratura dental, restauração quebrada ou trauma.",
  },
];

export function getDoctorById(doctorId: DoctorId): Doctor {
  const doctor = doctors.find((entry) => entry.id === doctorId);
  if (!doctor) {
    throw new Error(`Dentista desconhecido: ${doctorId}`);
  }

  return doctor;
}

export function getServiceById(serviceId: ServiceId): Service {
  const service = services.find((entry) => entry.id === serviceId);
  if (!service) {
    throw new Error(`Serviço desconhecido: ${serviceId}`);
  }

  return service;
}

export function isDoctorId(value: string | null): value is DoctorId {
  return doctors.some((doctor) => doctor.id === value);
}

export function isServiceId(value: string | null): value is ServiceId {
  return services.some((service) => service.id === value);
}
