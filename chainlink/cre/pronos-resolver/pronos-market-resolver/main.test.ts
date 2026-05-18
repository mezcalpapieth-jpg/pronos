import { describe, expect } from "bun:test";
import { newTestRuntime, test } from "@chainlink/cre-sdk/test";
import { onCronTrigger, initWorkflow } from "./main";
import type { Config } from "./main";

describe("onCronTrigger", () => {
  test("returns a deterministic Pronos resolution report", async () => {
    const config: Config = {
      schedule: "*/5 * * * *",
      status: "ready",
      source: "sports-api",
      sourceEventId: "espn-nba-401766123",
      protocolMarketId: "1516",
      marketQuestion: "¿Quién gana Detroit Pistons @ Cleveland Cavaliers?",
      outcomeCount: 2,
      dryRunOutcomeIndex: 1,
      confidenceBps: 9800,
      finalScoreHome: "102",
      finalScoreAway: "109",
      evidenceUrl: "https://example.com/events/espn-nba-401766123",
    };
    const runtime = newTestRuntime();
    runtime.config = config;
    runtime.setTimeProvider(() => Date.parse("2026-05-18T14:00:00.000Z"));

    const result = onCronTrigger(runtime);

    expect(result).toEqual({
      resolverType: "chainlink-cre",
      status: "ready",
      source: "sports-api",
      sourceEventId: "espn-nba-401766123",
      protocolMarketId: "1516",
      marketQuestion: "¿Quién gana Detroit Pistons @ Cleveland Cavaliers?",
      outcomeIndex: 1,
      outcomeCount: 2,
      confidenceBps: 9800,
      observedAt: "2026-05-18T14:00:00.000Z",
      finalScore: { home: "102", away: "109" },
      evidenceUrl: "https://example.com/events/espn-nba-401766123",
    });
    const logs = runtime.getLogs();
    expect(logs).toContain(
      "Pronos CRE ready report for market 1516 from sports-api:espn-nba-401766123"
    );
  });

  test("returns an AI review candidate with evidence for sentimental markets", async () => {
    const config: Config = {
      schedule: "*/30 * * * *",
      resolverType: "chainlink-cre-ai",
      status: "candidate",
      source: "ai-search",
      sourceEventId: "sentiment-market-1516",
      protocolMarketId: "1516",
      marketQuestion: "¿La marca anuncia su alianza esta semana?",
      outcomeCount: 2,
      dryRunOutcomeIndex: 0,
      confidenceBps: 9200,
      finalScoreText: "Anuncio confirmado",
      evidenceUrl: "https://example.com/comunicado",
      evidence: [
        {
          title: "Comunicado oficial",
          url: "https://example.com/comunicado",
          quote: "alianza confirmada",
        },
      ],
      rationale: "La fuente oficial confirma el resultado.",
    };
    const runtime = newTestRuntime();
    runtime.config = config;
    runtime.setTimeProvider(() => Date.parse("2026-05-18T14:00:00.000Z"));

    const result = onCronTrigger(runtime);

    expect(result).toEqual({
      resolverType: "chainlink-cre-ai",
      status: "candidate",
      source: "ai-search",
      sourceEventId: "sentiment-market-1516",
      protocolMarketId: "1516",
      marketQuestion: "¿La marca anuncia su alianza esta semana?",
      outcomeIndex: 0,
      outcomeCount: 2,
      confidenceBps: 9200,
      observedAt: "2026-05-18T14:00:00.000Z",
      finalScore: "Anuncio confirmado",
      evidenceUrl: "https://example.com/comunicado",
      evidence: [
        {
          title: "Comunicado oficial",
          url: "https://example.com/comunicado",
          quote: "alianza confirmada",
        },
      ],
      rationale: "La fuente oficial confirma el resultado.",
    });
  });

  test("rejects invalid dry-run outcomes before reporting", async () => {
    const config: Config = {
      schedule: "*/5 * * * *",
      status: "ready",
      source: "sports-api",
      sourceEventId: "espn-nba-401766123",
      protocolMarketId: "1516",
      marketQuestion: "¿Quién gana Detroit Pistons @ Cleveland Cavaliers?",
      outcomeCount: 2,
      dryRunOutcomeIndex: 2,
      confidenceBps: 9800,
      evidenceUrl: "https://example.com/events/espn-nba-401766123",
    };
    const runtime = newTestRuntime();
    runtime.config = config;

    expect(() => onCronTrigger(runtime)).toThrow(
      "dryRunOutcomeIndex must be between 0 and outcomeCount - 1"
    );
  });
});

describe("initWorkflow", () => {
  test("returns one handler with correct cron schedule", async () => {
    const testSchedule = "0 0 * * *";
    const config: Config = {
      schedule: testSchedule,
      status: "ready",
      source: "sports-api",
      sourceEventId: "espn-nba-401766123",
      protocolMarketId: "1516",
      marketQuestion: "¿Quién gana Detroit Pistons @ Cleveland Cavaliers?",
      outcomeCount: 2,
      dryRunOutcomeIndex: 1,
      confidenceBps: 9800,
      evidenceUrl: "https://example.com/events/espn-nba-401766123",
    };

    const handlers = initWorkflow(config);

    expect(handlers).toBeArray();
    expect(handlers).toHaveLength(1);
    expect(handlers[0].trigger.config.schedule).toBe(testSchedule);
  });

  test("handler executes onCronTrigger and returns result", async () => {
    const config: Config = {
      schedule: "*/5 * * * *",
      status: "ready",
      source: "sports-api",
      sourceEventId: "espn-nba-401766123",
      protocolMarketId: "1516",
      marketQuestion: "¿Quién gana Detroit Pistons @ Cleveland Cavaliers?",
      outcomeCount: 2,
      dryRunOutcomeIndex: 1,
      confidenceBps: 9800,
      evidenceUrl: "https://example.com/events/espn-nba-401766123",
    };
    const runtime = newTestRuntime();
    runtime.config = config;
    const handlers = initWorkflow(config);

    const result = handlers[0].fn(runtime, {});

    expect(result).toEqual(onCronTrigger(runtime));
  });
});
