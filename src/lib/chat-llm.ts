import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { demoConfig } from "@/lib/config";
import { ChatSession } from "@/lib/types";
import {
  addNaturalNameReference,
  buildRecentTranscript,
  getFirstName,
  getAssistantTurnCount,
} from "@/lib/chat-domain";

const anthropic = demoConfig.hasAnthropicKey
  ? new ChatAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: demoConfig.anthropicModel,
      temperature: 0.45,
      maxTokens: 220,
      maxRetries: 2,
      outputConfig: {
        effort: "low",
      },
    })
  : null;

function messageContentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((block) => {
      if (typeof block === "string") {
        return [block];
      }

      if (
        typeof block === "object" &&
        block !== null &&
        "text" in block &&
        typeof block.text === "string"
      ) {
        return [block.text];
      }

      return [];
    })
    .join("")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stabilizePatientName(text: string, patientName?: string): string {
  const firstName = getFirstName(patientName);
  if (!firstName) {
    return text;
  }

  const escapedFirstName = escapeRegExp(firstName);
  const expandedNamePattern = new RegExp(
    `\\b${escapedFirstName}(?:\\s+(?:[A-ZÀ-Ý][a-zà-ÿ]*|e|E|de|da|do|dos|das)){1,3}\\b`,
    "g",
  );

  return text.replace(expandedNamePattern, firstName);
}

export async function humanizeReply(
  draft: string,
  session: ChatSession,
): Promise<string> {
  const personalizedDraft = addNaturalNameReference(draft, session);

  if (!anthropic) {
    return personalizedDraft;
  }

  const systemPrompt = `
<role>Você é a recepção digital da Aurora Dental Atelier.</role>
<objective>Reescreva a resposta-base para soar natural no WhatsApp, sem mudar nenhum fato concreto.</objective>
<rules>
- Use português do Brasil.
- Preserve exatamente datas, horários, nomes dos profissionais, serviços e decisões clínicas já definidas.
- Não invente disponibilidade, sintomas, políticas ou dados da clínica.
- Se o nome da pessoa estiver disponível, use só o primeiro nome quando soar natural.
- Nunca cumprimente de novo depois da primeira mensagem da conversa.
- Prefira respostas curtas, humanas e diretas. Máximo 2-3 frases por mensagem.
- Evite frases costuradas ou duplicadas, como "Beleza, Ana. boa..." ou "Certo, Ana. perfeito...".
- Quando mencionar o nome da pessoa, encaixe em uma única abertura natural e siga a frase normalmente.
- Se a resposta-base tiver uma lista numerada de horários, mantenha a numeração, as datas, os horários e as quebras de linha.
- Se a resposta-base já estiver boa, faça só ajustes mínimos.
- Se for confirmar um agendamento, reconheça o que foi combinado ("ok, então dia X com a Dra. Y") antes de finalizar.
- Quando não houver slots, seja empático: "entendo que é urgente" ou "quer tentar outro dia?" em vez de "não consegui".
- Use vírgulas e reticências para criar naturalidade, não exclamações excessivas.
</rules>
<examples>
<example>
<draft>Perfeito, Ana. Agora me fala um dia ou período que seja melhor para você, e eu já te trago as opções.</draft>
<output>Perfeito, Ana. Me fala um dia ou período que funcione para você e eu já te trago as opções.</output>
</example>
<example>
<draft>Esse horário exato eu não consegui, mas já vi opções próximas para você.</draft>
<output>Esse horário certinho eu não consegui, mas já separei opções próximas para você.</output>
</example>
<example>
<draft>Beleza, Ana. Boa, separei estas opções para Clareamento dental:</draft>
<output>Ana, separei estas opções para clareamento dental:</output>
</example>
<example>
<draft>Prontinho, Ana! Sua consulta com Dra. Stefania para Limpeza está confirmada em segunda, 10 de março, às 14:00. Chegue com uns 10 min de antecedência. Se precisar remarcar, é só chamar aqui.</draft>
<output>Perfeito, Ana! Sua consulta com a Dra. Stefania em seg., 10 de março, às 14:00 está confirmada. Chegue com uns 10 min de antecedência 😊</output>
</example>
<example>
<draft>Entendi, procurando para amanhã. Separei estas opções para Atendimento de emergência:</draft>
<output>Ótimo, procurando para amanhã. Aqui estão as opções:</output>
</example>
</examples>
  `.trim();

  const userPrompt = `
<context>
<patient_name>${session.patientName ?? "não informado"}</patient_name>
<stage>${session.stage}</stage>
<assistant_turn_count>${getAssistantTurnCount(session.messages)}</assistant_turn_count>
<symptoms>${session.symptoms ?? "não informado"}</symptoms>
<specialist>${session.recommendation?.doctorName ?? "não definido"}</specialist>
<selected_slot>${session.selectedSlot ? `${session.selectedSlot.date} às ${session.selectedSlot.time}` : "nenhum"}</selected_slot>
<recent_transcript>${buildRecentTranscript(session.messages) || "sem histórico anterior"}</recent_transcript>
</context>
<task>Reescreva a resposta-base para ficar mais fluida e natural, mantendo o mesmo significado.</task>
<response_base>
${personalizedDraft}
</response_base>
  `.trim();

  try {
    const response = await anthropic.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ]);

    const text = messageContentToText(response.content);
    return text
      ? addNaturalNameReference(
          stabilizePatientName(text, session.patientName),
          session,
        )
      : personalizedDraft;
  } catch {
    return personalizedDraft;
  }
}
