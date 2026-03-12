# Aurora Dental Atelier Demo

Demo app em `Next.js + TypeScript` para apresentar um caso de booking de consultas
de uma clínica odontológica com:

- checagem de disponibilidade para `Mario` e `Stefania`
- reservas salvas em memória enquanto o app está rodando
- base de conhecimento local em markdown para busca estilo RAG
- UI moderna, pronta para demo e deploy

## Rodar com pnpm

```bash
pnpm install
pnpm dev
```

Abra `http://localhost:3000`.

## Variáveis de ambiente

O arquivo `.env` já foi criado localmente. Estas variáveis são usadas ou ficam
preparadas para a próxima etapa:

```bash
NEXT_PUBLIC_DEMO_APP_NAME
NEXT_PUBLIC_DEMO_CLINIC_CITY
NEXT_PUBLIC_ENABLE_OPENAI_ASSISTANT
OPENAI_API_KEY
```

Notas:

- `NEXT_PUBLIC_DEMO_APP_NAME` altera a marca mostrada na UI
- `NEXT_PUBLIC_DEMO_CLINIC_CITY` altera a cidade exibida
- `NEXT_PUBLIC_ENABLE_OPENAI_ASSISTANT` fica `false` neste demo
- `OPENAI_API_KEY` é opcional e só será necessário quando a busca/assistente usar OpenAI de verdade

## Skill local

Foi adicionada a skill local:

```bash
skills/get-api-docs/
```

Ela usa `chub` para buscar documentação atualizada, e a referência do OpenAI foi
salva em:

```bash
skills/get-api-docs/references/openai-chat-javascript.md
```

## Observação sobre bookings

Os bookings ficam apenas em memória. Isso funciona bem para demo local ou uma
instância Node simples, mas não substitui persistência real em produção.
