import { formatDistanceToNowStrict } from "date-fns";

export function stageLabel(stage: string) {
  return ({
    group: "Group Stage",
    round_of_32: "Round of 32",
    round_of_16: "Round of 16",
    quarter_final: "Quarter Final",
    semi_final: "Semi Final",
    third_place: "Third Place",
    final: "Final",
  } as Record<string, string>)[stage] ?? stage;
}

export function isSameUtcDay(a: Date, b: Date) {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

export function formatCountdown(ms: number) {
  if (ms <= 0) return "00:00:00";
  const s = Math.floor(ms / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

export function scoreOutcome(home: number, away: number) {
  if (home > away) return "H";
  if (home < away) return "A";
  return "D";
}

export function calcPoints(pH: number, pA: number, aH: number | null, aA: number | null) {
  if (aH == null || aA == null) return 0;
  if (pH === aH && pA === aA) return 200;
  if (scoreOutcome(pH, pA) === scoreOutcome(aH, aA)) return 100;
  return 0;
}

export function timeStr(d: Date) {
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function relTime(d: Date) {
  return formatDistanceToNowStrict(d, { addSuffix: true });
}
