import { containsClinicalContext, parsePreference } from "@/lib/chat-domain";
import { demoConfig } from "@/lib/config";
import { toDateKey } from "@/lib/date";
import { ChatSession, DemoBudgetStatus } from "@/lib/types";

const HAIKU_INPUT_USD_PER_MTOK = 1;
const HAIKU_OUTPUT_USD_PER_MTOK = 5;
const DEFAULT_MONTHLY_BUDGET_USD = 2;
const DEFAULT_INPUT_TOKENS_PER_STEP = 800;
const DEFAULT_OUTPUT_TOKENS_PER_STEP = 80;
const TRANSCRIPT_MESSAGE_LIMIT = 8;

interface EstimatedTurnUsage {
  estimatedCostUsd: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedPlannerSteps: number;
}

interface DailyBudgetState {
  blockedRequests: number;
  dateKey: string;
  estimatedCostUsd: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  exhausted: boolean;
  requests: number;
}

declare global {
  var __auroraDailyBudgetState: DailyBudgetState | undefined;
}

const dailyBudgetState = globalThis.__auroraDailyBudgetState;

if (!dailyBudgetState) {
  globalThis.__auroraDailyBudgetState = {
    blockedRequests: 0,
    dateKey: toDateKey(new Date()),
    estimatedCostUsd: 0,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    exhausted: false,
    requests: 0,
  };
}

function readNumberEnv(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number(rawValue);
  return Number.isFinite(parsedValue) && parsedValue > 0
    ? parsedValue
    : fallback;
}

function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

function getDailyState(): DailyBudgetState {
  const state = globalThis.__auroraDailyBudgetState!;
  const todayKey = toDateKey(new Date());

  if (state.dateKey !== todayKey) {
    state.dateKey = todayKey;
    state.requests = 0;
    state.blockedRequests = 0;
    state.estimatedCostUsd = 0;
    state.estimatedInputTokens = 0;
    state.estimatedOutputTokens = 0;
    state.exhausted = false;
  }

  return state;
}

function estimatePlannerSteps(session: ChatSession, userText: string): number {
  const parsedPreference = parsePreference(userText);
  const likelySchedulingTurn =
    Boolean(session.recommendation) ||
    session.offeredSlots.length > 0 ||
    Boolean(session.selectedSlot) ||
    Boolean(session.symptoms) ||
    containsClinicalContext(userText) ||
    Boolean(parsedPreference.date) ||
    Boolean(parsedPreference.startDate) ||
    Boolean(parsedPreference.endDate) ||
    parsedPreference.weekday !== undefined ||
    Boolean(parsedPreference.exactTime) ||
    Boolean(parsedPreference.period) ||
    Boolean(parsedPreference.timeWindow);

  return likelySchedulingTurn ? 2 : 1;
}

function estimateTurnUsage(
  session: ChatSession,
  userText: string,
): EstimatedTurnUsage {
  const estimatedPlannerSteps = estimatePlannerSteps(session, userText);
  const estimatedInputTokensPerStep = readNumberEnv(
    "DEMO_ESTIMATED_INPUT_TOKENS_PER_STEP",
    DEFAULT_INPUT_TOKENS_PER_STEP,
  );
  const estimatedOutputTokensPerStep = readNumberEnv(
    "DEMO_ESTIMATED_OUTPUT_TOKENS_PER_STEP",
    DEFAULT_OUTPUT_TOKENS_PER_STEP,
  );
  const transcriptTokens = session.messages
    .slice(-TRANSCRIPT_MESSAGE_LIMIT)
    .reduce((sum, message) => sum + estimateTextTokens(message.text), 0);
  const userTokens = estimateTextTokens(userText);

  const estimatedInputTokens =
    estimatedPlannerSteps * estimatedInputTokensPerStep +
    transcriptTokens +
    userTokens;
  const estimatedOutputTokens = estimatedPlannerSteps * estimatedOutputTokensPerStep;
  const estimatedCostUsd =
    (estimatedInputTokens / 1_000_000) * HAIKU_INPUT_USD_PER_MTOK +
    (estimatedOutputTokens / 1_000_000) * HAIKU_OUTPUT_USD_PER_MTOK;

  return {
    estimatedCostUsd,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedPlannerSteps,
  };
}

export function getDailyDemoBudgetUsd(): number {
  const explicitDailyBudget = process.env.DEMO_DAILY_BUDGET_USD;
  if (explicitDailyBudget) {
    return readNumberEnv("DEMO_DAILY_BUDGET_USD", DEFAULT_MONTHLY_BUDGET_USD / 30);
  }

  const monthlyBudget = readNumberEnv(
    "DEMO_MONTHLY_BUDGET_USD",
    DEFAULT_MONTHLY_BUDGET_USD,
  );
  return monthlyBudget / 30;
}

export function previewDailyDemoBudget(
  session: ChatSession,
  userText: string,
): {
  allowed: boolean;
  estimate: EstimatedTurnUsage;
  remainingBudgetUsd: number;
  state: DailyBudgetState;
} {
  const state = getDailyState();
  if (state.exhausted) {
    return {
      allowed: false,
      estimate: {
        estimatedCostUsd: 0,
        estimatedInputTokens: 0,
        estimatedOutputTokens: 0,
        estimatedPlannerSteps: 0,
      },
      remainingBudgetUsd: 0,
      state,
    };
  }

  if (!demoConfig.hasAnthropicKey) {
    return {
      allowed: true,
      estimate: {
        estimatedCostUsd: 0,
        estimatedInputTokens: 0,
        estimatedOutputTokens: 0,
        estimatedPlannerSteps: 0,
      },
      remainingBudgetUsd: getDailyDemoBudgetUsd(),
      state,
    };
  }

  const estimate = estimateTurnUsage(session, userText);
  const dailyBudgetUsd = getDailyDemoBudgetUsd();
  const projectedCostUsd = state.estimatedCostUsd + estimate.estimatedCostUsd;

  return {
    allowed: projectedCostUsd <= dailyBudgetUsd,
    estimate,
    remainingBudgetUsd: Math.max(0, dailyBudgetUsd - state.estimatedCostUsd),
    state,
  };
}

export function recordDailyDemoBudgetUsage(estimate: EstimatedTurnUsage): void {
  const state = getDailyState();
  state.requests += 1;
  state.estimatedCostUsd += estimate.estimatedCostUsd;
  state.estimatedInputTokens += estimate.estimatedInputTokens;
  state.estimatedOutputTokens += estimate.estimatedOutputTokens;
}

export function recordBlockedDailyDemoRequest(): void {
  const state = getDailyState();
  state.blockedRequests += 1;
  state.exhausted = true;
}

function roundCurrency(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function getDailyDemoBudgetStatus(): DemoBudgetStatus {
  const state = getDailyState();
  const dailyBudgetUsd = getDailyDemoBudgetUsd();
  const rawUsagePercent =
    dailyBudgetUsd > 0 ? (state.estimatedCostUsd / dailyBudgetUsd) * 100 : 0;

  return {
    enabled: demoConfig.hasAnthropicKey,
    exhausted: state.exhausted,
    dailyBudgetUsd: roundCurrency(dailyBudgetUsd),
    usedUsd: roundCurrency(state.estimatedCostUsd),
    remainingUsd: roundCurrency(
      state.exhausted ? 0 : Math.max(0, dailyBudgetUsd - state.estimatedCostUsd),
    ),
    usagePercent: Math.min(100, Math.max(0, rawUsagePercent)),
    requests: state.requests,
    blockedRequests: state.blockedRequests,
  };
}

export function getDailyDemoBudgetMessage(): string {
  return "O orçamento desta demo acabou por hoje. Volte amanhã, por favor. Este projeto está rodando com um limite diário de uso para apresentação.";
}
