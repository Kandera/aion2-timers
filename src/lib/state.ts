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
    compact: false,
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

function normalize(parsed: Partial<AppState>): AppState {
  const settings = { ...defaultSettings(), ...(parsed.settings ?? {}) };
  const saved = Array.isArray(parsed.timers) ? parsed.timers : [];
  const byId = new Map(saved.filter((timer) => timer && typeof timer.id === "string").map((timer) => [timer.id, timer]));
  const timers: Timer[] = [];

  for (const seed of catalog()) {
    const existing = byId.get(seed.id);
    if (!existing) {
      timers.push({ ...seed, leadMinutes: settings.defaultLeadMinutes });
      continue;
    }
    byId.delete(seed.id);
    timers.push(existing.customized ? { ...seed, ...existing, id: seed.id, seeded: true } : preferences(seed, existing));
  }

  for (const custom of byId.values()) {
    if (!custom.seeded) timers.push(custom);
  }

  return {
    settings,
    timers,
    alerted: Array.isArray(parsed.alerted) ? parsed.alerted.filter((key) => typeof key === "string") : [],
  };
}

function preferences(seed: Timer, existing: Timer): Timer {
  return {
    ...seed,
    overlay: existing.overlay,
    alarm: existing.alarm,
    leadMinutes: existing.leadMinutes,
    note: existing.note ?? seed.note,
  };
}
