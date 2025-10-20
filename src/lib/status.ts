import { AppError } from "./errors.js";

export const MATCH_STATUSES = [
  "scheduled",
  "submission",
  "judging",
  "finished",
  "tie",
  "cancelled",
] as const;

export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const DEFAULT_MATCH_STATUS: MatchStatus = "scheduled";

export function isMatchStatus(value: unknown): value is MatchStatus {
  return typeof value === "string" && MATCH_STATUSES.includes(value as MatchStatus);
}

export function normalizeMatchStatus(value: unknown): MatchStatus {
  if (isMatchStatus(value)) {
    return value;
  }
  throw new AppError({
    status: 400,
    code: "invalid_match_status",
    message: "Недопустимый статус баттла.",
  });
}

export const ROUND_STATUSES = ["draft", "submission", "judging", "finished"] as const;
export type RoundStatus = (typeof ROUND_STATUSES)[number];

export const TOURNAMENT_STATUSES = [
  "draft",
  "registration",
  "ongoing",
  "completed",
  "archived",
] as const;
export type TournamentStatus = (typeof TOURNAMENT_STATUSES)[number];
