export const demoConfig = {
  appName: process.env.NEXT_PUBLIC_DEMO_APP_NAME ?? "Aurora Dental Atelier",
  clinicCity: process.env.NEXT_PUBLIC_DEMO_CLINIC_CITY ?? "Austin, Texas",
  anthropicModel:
    process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
  hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
} as const;
