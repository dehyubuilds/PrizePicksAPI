import type { PrizePicksProjection } from "@/lib/prizepicks/types";

export type Flex32OddsBucket = "goblin" | "standard" | "demon";

export type Flex32Mix = "3g2s" | "3g1s1d";

export type Flex32Candidate = {
  projection: PrizePicksProjection;
  bucket: Flex32OddsBucket;
  sport: string;
  /** Higher = more likely soft floor. Not a true hit probability. */
  softnessScore: number;
  mainLine: number | null;
  gapFromMain: number | null;
  reasons: string[];
};

export type Flex32Pick = Flex32Candidate & {
  slot: number;
  side: "more";
};

export type Flex32Report = {
  generatedAt: string;
  fetchedAt: string;
  fromCache: boolean;
  mix: Flex32Mix;
  picks: Flex32Pick[];
  alternates: Flex32Candidate[];
  skippedSports: string[];
  warnings: string[];
  boardCounts: {
    total: number;
    eligible: number;
    goblin: number;
    standard: number;
    demon: number;
  };
};

export type Flex32RunOptions = {
  forceLive?: boolean;
  preferCache?: boolean;
  nowMs?: number;
  /** Hours ahead to include (default 48). */
  horizonHours?: number;
  sports?: string[];
  allowDemon?: boolean;
};
