import { DateTime } from "luxon";
import { formatClock, formatCountdown, formatWhen } from "./format.ts";
import { evaluate, type Occurrence, type Phase } from "./schedule.ts";
import type { AppState, Category, OverlayList, Timer } from "./types.ts";
import { isFieldBoss, rankValue, shownTimers } from "./view.ts";

export type EdgeRow = {
  id: string;
  name: string;
  category: Category;
  kind: "field" | Category;
  phase: Phase;
  countdown: string;
  detail: string;
  canKill: boolean;
  canSee: boolean;
  soon: boolean;
};

export type EdgeSnapshot = {
  ok: true;
  at: number;
  clock: string;
  overlayList: OverlayList;
  listLabel: string;
  overlayHours: number;
  later: number;
  compactHidden: number;
  note: string;
  empty: string;
  refreshing: boolean;
  rows: EdgeRow[];
};

export type OverlaySelection = {
  shown: { timer: Timer; occurrence: Occurrence }[];
  later: number;
  compactHidden: number;
};

const SOON_MS = 15 * 60_000;

export function isOverlaySoon(occurrence: Occurrence): boolean {
  return (
    occurrence.phase === "live" ||
    occurrence.phase === "entry" ||
    occurrence.phase === "overdue" ||
    (occurrence.phase === "upcoming" && occurrence.remainingMs != null && occurrence.remainingMs <= SOON_MS)
  );
}

export function listLabel(mode: OverlayList): string {
  if (mode === "next3") return "Next 3";
  if (mode === "soon") return "Soon";
  return "All";
}

/** Same pins, window, and list mode as the desktop overlay. */
export function selectOverlay(state: AppState, now: DateTime): OverlaySelection {
  const zone = state.settings.timeZone;
  const limit = Math.min(48, Math.max(1, state.settings.overlayHours)) * 3_600_000;
  const ranked = shownTimers(state.timers, state.settings.fieldZone)
    .filter((timer) => timer.overlay)
    .map((timer) => ({ timer, occurrence: evaluate(timer, now, zone) }))
    .sort((left, right) => rankValue(left.occurrence) - rankValue(right.occurrence) || left.timer.name.localeCompare(right.timer.name));
  const due = ranked.filter((item) => onOverlay(item.occurrence, limit));
  const listed = state.settings.overlayList === "soon" ? due.filter((item) => isOverlaySoon(item.occurrence)) : due;
  const shown = state.settings.overlayList === "next3" ? listed.slice(0, 3) : listed;
  return {
    shown,
    later: ranked.length - listed.length,
    compactHidden: state.settings.overlayList === "next3" ? Math.max(0, listed.length - 3) : 0,
  };
}

export function edgeSnapshot(state: AppState, now: DateTime, refreshing = false): EdgeSnapshot {
  const zone = state.settings.timeZone;
  const { shown, later, compactHidden } = selectOverlay(state, now);
  const hours = state.settings.overlayHours;
  const clock = now.setZone(zone);
  const notes = [
    compactHidden > 0 ? `${compactHidden} more hidden by compact.` : "",
    later > 0 ? `${later} later, outside ${hours} h.` : "",
  ].filter(Boolean);
  return {
    ok: true,
    at: now.toMillis(),
    clock: clock.isValid ? formatClock(clock) : "--:--:--",
    overlayList: state.settings.overlayList,
    listLabel: listLabel(state.settings.overlayList),
    overlayHours: hours,
    later,
    compactHidden,
    note: notes.join(" "),
    empty: shown.length === 0 ? (later > 0 ? `Nothing due in the next ${hours} h.` : "No timers on the overlay.") : "",
    refreshing,
    rows: shown.map((item) => rowFrom(item.timer, item.occurrence, zone)),
  };
}

function onOverlay(occurrence: Occurrence, limit: number): boolean {
  if (occurrence.phase === "unset") return false;
  if (occurrence.phase !== "upcoming") return true;
  return occurrence.remainingMs != null && occurrence.remainingMs <= limit;
}

function rowFrom(timer: Timer, occurrence: Occurrence, zone: string): EdgeRow {
  const kind = isFieldBoss(timer) ? "field" : timer.category;
  const detail =
    occurrence.phase === "upcoming"
      ? occurrence.start
        ? formatWhen(occurrence.start.setZone(zone))
        : "No time set"
      : phaseLabel(occurrence.phase);
  return {
    id: timer.id,
    name: timer.name,
    category: timer.category,
    kind,
    phase: occurrence.phase,
    countdown: occurrence.remainingMs == null ? "—" : formatCountdown(occurrence.remainingMs),
    detail,
    canKill: timer.respawnIntervalMinutes != null && timer.respawnIntervalMinutes >= 1,
    canSee: timer.schedule.kind !== "rolling" && occurrence.start != null,
    soon: isOverlaySoon(occurrence),
  };
}

function phaseLabel(phase: Phase): string {
  if (phase === "live") return "Live";
  if (phase === "entry") return "Entry";
  if (phase === "overdue") return "Overdue";
  if (phase === "unset") return "Unset";
  return "";
}
