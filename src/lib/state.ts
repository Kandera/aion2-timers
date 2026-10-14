import { catalog } from "./catalog.ts";
import type { AppState, Settings, Timer } from "./types.ts";

export const STATE_KEY = "aion2-timers.state.v1";

export function defaultSettings(): Settings {
  return {
    timeZone: "Europe/Berlin",
    defaultLeadMinutes: 5,
    alarmTone: 1,
    alarmVolume: 0.7,
    hotkey: "Ctrl+Shift+O",
    opacity: 0.94,
    scale: 1,
    clickThrough: false,
    alwaysOnTop: true,
    overlayList: "all",
    overlayMonitor: null,
    quietEnabled: false,
    quietFrom: 1,
    quietUntil: 8,
    overlayHours: 8,
    overlayVisible: true,
    overlayX: null,
    overlayY: null,
    overlayWidth: 340,
    overlayHeight: 480,
  };
}

export function freshState(): AppState {
  return {
    settings: defaultSettings(),
    timers: catalog().map((timer) => ({ ...timer })),
    alerted: [],
  };
}

export function loadState(): AppState {
  const raw = localStorage.getItem(STATE_KEY);
  if (!raw) return freshState();
  try {
    return normalize(JSON.parse(raw) as Partial<AppState>);
  } catch {
    return freshState();
  }
}

export function saveState(state: AppState): void {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

export function resetToCatalog(timer: Timer, leadMinutes: number): Timer | null {
  const seed = catalog().find((item) => item.id === timer.id);
  if (!seed) return null;
  return { ...seed, leadMinutes };
}

export function mergeCatalog(state: AppState, refresh: boolean): AppState {
  return normalize(state, refresh);
}

function normalize(parsed: Partial<AppState>, refresh = false): AppState {
  const raw = (parsed.settings ?? {}) as Partial<Settings> & { compact?: boolean };
  const settings = { ...defaultSettings(), ...raw };
  if (raw.overlayList !== "all" && raw.overlayList !== "next3" && raw.overlayList !== "soon") {
    settings.overlayList = raw.compact ? "next3" : "all";
  }
  if (!Number.isInteger(settings.overlayHours) || settings.overlayHours < 1 || settings.overlayHours > 48) {
    settings.overlayHours = 8;
  }
  if (!Number.isInteger(settings.quietFrom) || settings.quietFrom < 0 || settings.quietFrom > 23) settings.quietFrom = 1;
  if (!Number.isInteger(settings.quietUntil) || settings.quietUntil < 0 || settings.quietUntil > 23) settings.quietUntil = 8;
  const saved = Array.isArray(parsed.timers) ? parsed.timers : [];
  const byId = new Map(saved.filter((timer) => timer && typeof timer.id === "string").map((timer) => [timer.id, complete(timer)]));
  const timers: Timer[] = [];

  for (const seed of catalog()) {
    const existing = byId.get(seed.id);
    if (!existing) {
      timers.push({ ...seed, leadMinutes: settings.defaultLeadMinutes });
      continue;
    }
    byId.delete(seed.id);
    timers.push(fromSeed(seed, existing, refresh));
  }

  for (const custom of byId.values()) {
    if (!custom.seeded) timers.push(custom);
    else if (custom.customized) timers.push({ ...custom, seeded: false });
  }

  return {
    settings,
    timers,
    alerted: Array.isArray(parsed.alerted) ? parsed.alerted.filter((key) => typeof key === "string") : [],
  };
}

function fromSeed(seed: Timer, existing: Timer, refresh: boolean): Timer {
  if (!refresh && existing.customized) return { ...seed, ...existing, id: seed.id, seeded: true };
  return {
    ...seed,
    overlay: existing.overlay,
    alarm: existing.alarm,
    leadMinutes: existing.leadMinutes,
    note: existing.customized ? existing.note : seed.note,
    respawnIntervalMinutes: existing.respawnIntervalMinutes,
    nextAt: existing.nextAt,
    alarmTone: existing.alarmTone,
    alarmOnStart: existing.alarmOnStart,
    seenUntil: existing.seenUntil,
    customized: existing.customized,
  };
}

function complete(timer: Timer): Timer {
  const tone = timer.alarmTone;
  return {
    ...timer,
    alarmTone: tone === 1 || tone === 2 || tone === 3 ? tone : null,
    alarmOnStart: timer.alarmOnStart !== false,
    seenUntil: typeof timer.seenUntil === "string" ? timer.seenUntil : null,
  };
}
