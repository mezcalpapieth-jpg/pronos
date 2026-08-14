import { CronCapability, handler, Runner, type Runtime } from "@chainlink/cre-sdk";

export type Config = {
  schedule: string;
  resolverType?: "chainlink-cre" | "chainlink-cre-ai";
  status?: "ready" | "dry-run" | "candidate";
  source: string;
  sourceEventId: string;
  protocolMarketId: string;
  marketQuestion: string;
  outcomeCount: number;
  dryRunOutcomeIndex: number;
  confidenceBps: number;
  finalScoreHome?: string;
  finalScoreAway?: string;
  finalScoreText?: string;
  evidenceUrl: string;
  evidence?: EvidenceItem[];
  rationale?: string;
};

export type EvidenceItem = {
  title?: string;
  url?: string;
  quote?: string;
};

export type ResolutionReport = {
  resolverType: "chainlink-cre" | "chainlink-cre-ai";
  status: "ready" | "dry-run" | "candidate";
  source: string;
  sourceEventId: string;
  protocolMarketId: string;
  marketQuestion: string;
  outcomeIndex: number;
  outcomeCount: number;
  confidenceBps: number;
  observedAt: string;
  finalScore?: {
    home: string;
    away: string;
  } | string;
  evidenceUrl: string;
  evidence?: EvidenceItem[];
  rationale?: string;
};

const assertValidConfig = (config: Config) => {
  if (config.outcomeCount < 2) {
    throw new Error("outcomeCount must be at least 2");
  }

  if (
    config.dryRunOutcomeIndex < 0 ||
    config.dryRunOutcomeIndex >= config.outcomeCount
  ) {
    throw new Error("dryRunOutcomeIndex must be between 0 and outcomeCount - 1");
  }

  if (config.confidenceBps < 0 || config.confidenceBps > 10_000) {
    throw new Error("confidenceBps must be between 0 and 10000");
  }
};

const finalScoreFromConfig = (config: Config): ResolutionReport["finalScore"] => {
  if (config.finalScoreText !== undefined) {
    return config.finalScoreText;
  }

  if (config.finalScoreHome === undefined || config.finalScoreAway === undefined) {
    return undefined;
  }

  return {
    home: config.finalScoreHome,
    away: config.finalScoreAway,
  };
};

export const onCronTrigger = (runtime: Runtime<Config>): ResolutionReport => {
  const config = runtime.config;
  assertValidConfig(config);
  const status = config.status || "dry-run";
  const resolverType = config.resolverType || "chainlink-cre";
  const finalScore = finalScoreFromConfig(config);

  runtime.log(
    `Pronos CRE ${status} report for market ${config.protocolMarketId} from ${config.source}:${config.sourceEventId}`
  );

  const report: ResolutionReport = {
    resolverType,
    status,
    source: config.source,
    sourceEventId: config.sourceEventId,
    protocolMarketId: config.protocolMarketId,
    marketQuestion: config.marketQuestion,
    outcomeIndex: config.dryRunOutcomeIndex,
    outcomeCount: config.outcomeCount,
    confidenceBps: config.confidenceBps,
    observedAt: runtime.now().toISOString(),
    evidenceUrl: config.evidenceUrl,
  };

  if (finalScore !== undefined) {
    report.finalScore = finalScore;
  }
  if (config.evidence && config.evidence.length > 0) {
    report.evidence = config.evidence.slice(0, 6);
  }
  if (config.rationale) {
    report.rationale = config.rationale;
  }

  return report;
};

export const initWorkflow = (config: Config) => {
  const cron = new CronCapability();

  return [
    handler(
      cron.trigger(
        { schedule: config.schedule }
      ),
      onCronTrigger
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
