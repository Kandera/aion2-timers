import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { DateTime } from "luxon";
import { bindEditor } from "./editor.ts";
import { esc } from "./lib/html.ts";
import { pullCatalog } from "./lib/catalog.ts";
import { applySpawns, parseSpawns } from "./lib/paste.ts";
import { applyFieldReports, pullFieldReports } from "./lib/field-bosses.ts";
import { alertsFrom, evaluate, inQuietHours, markKilled, markSeen, zoneOk, type Occurrence } from "./lib/schedule.ts";
import { exportTimers, importTimers } from "./lib/share.ts";
import { playAlert, unlockSound } from "./lib/sound.ts";
import { loadState, mergeCatalog, mergeStores, parseState, resetToCatalog, saveState } from "./lib/state.ts";
import type { AppState, OverlayList, Timer } from "./lib/types.ts";
import { formatClock, formatCountdown, formatWhen } from "./lib/format.ts";
import { ordered, passesFilter, present, rankValue, shownTimers, type RowView } from "./lib/view.ts";

type Filter = "all" | "event" | "world" | "field" | "pvp" | "system";

const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["event", "Events"],
  ["world", "World bosses"],
  ["field", "Field bosses"],
  ["pvp", "PvP"],
  ["system", "System"],
];

const EYE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="2.4" fill="currentColor"/></svg>`;
const BELL = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 19a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`;
const PEN = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;

let state: AppState = loadState();
let catalogBusy = false;
let fieldBossBusy = false;
let filter: Filter = "all";
let listKey = "";
let capturing = false;

const list = document.querySelector<HTMLElement>("#list");
const filters = document.querySelector<HTMLElement>("#filters");
const dialog = document.querySelector<HTMLDialogElement>("#editor");
const editor = dialog
  ? bindEditor(dialog, {
      zone: () => state.settings.timeZone,
      onSave: (timer) => {
        state.timers = state.timers.some((item) => item.id === timer.id)
          ? state.timers.map((item) => (item.id === timer.id ? timer : item))
          : [...state.timers, timer];
        commit();
      },
      onDelete: (id) => {
        state.timers = state.timers.filter((item) => item.id !== id || item.seeded);
        commit();
      },
      onReset: (id) => {
        const current = state.timers.find((item) => item.id === id);
        if (!current) return;
        const reset = resetToCatalog(current, state.settings.defaultLeadMinutes);
        if (!reset) return;
        state.timers = state.timers.map((item) => (item.id === id ? reset : item));
        commit();
      },
    })
  : null;

document.querySelector("#win-close")?.addEventListener("click", () => {
  void getCurrentWindow().close();
});
document.querySelector("#update-install")?.addEventListener("click", () => {
  void installUpdate();
});
document.querySelector("#update-now")?.addEventListener("click", () => {
  void installUpdate();
});
document.querySelector("#update-later")?.addEventListener("click", () => {
  document.querySelector<HTMLDialogElement>("#update-dialog")?.close();
});


document.querySelector("#nav-timers")?.addEventListener("click", () => showPage("timers"));
document.querySelector("#nav-settings")?.addEventListener("click", () => showPage("settings"));
document.querySelector("#add-timer")?.addEventListener("click", () => editor?.open(null, state.settings.defaultLeadMinutes));
document.querySelector("#paste-spawn")?.addEventListener("click", () => {
  void pasteSpawn();
});
document.querySelector("#catalog-refresh")?.addEventListener("click", () => {
  void refreshCatalog(false);
});
document.querySelector("#field-boss-refresh")?.addEventListener("click", () => {
  void refreshFieldBosses(false);
});
document.querySelector("#export-timers")?.addEventListener("click", exportList);
document.querySelector("#import-timers")?.addEventListener("click", () => {
  document.querySelector<HTMLInputElement>("#import-file")?.click();
});
document.querySelector("#import-file")?.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.files?.[0]) return;
  void importList(input.files[0]);
  input.value = "";
});
document.querySelector("#overlay-toggle")?.addEventListener("click", () => {
  state.settings.overlayVisible = !state.settings.overlayVisible;
  commit();
});
list?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest("button");
  const row = (event.target as HTMLElement).closest<HTMLElement>("[data-id]");
  if (!button || !row) return;
  const timer = state.timers.find((item) => item.id === row.dataset.id);
  if (!timer) return;
  const act = button.dataset.act;
  if (act === "edit") editor?.open(timer, state.settings.defaultLeadMinutes);
  if (act === "overlay") replace({ ...timer, overlay: !timer.overlay, tracked: timer.id.startsWith("nm-") ? true : timer.tracked });
  if (act === "alarm") replace({ ...timer, alarm: !timer.alarm, tracked: timer.id.startsWith("nm-") ? true : timer.tracked });
  if (act === "kill") {
    const next = markKilled(timer, DateTime.now());
    if (next) replace(next);
  }
  if (act === "seen") {
    const next = markSeen(timer, DateTime.now(), state.settings.timeZone);
    if (next) replace(next);
  }
});

bindSettings();
bindSettingsTabs();
bindWindowDrag();
renderFilters();
renderList();
syncOverlayButton();
void boot();
window.setInterval(tick, 1000);
tick();

function showPage(page: "timers" | "settings"): void {
  document.querySelector("#timers-page")?.toggleAttribute("hidden", page !== "timers");
  document.querySelector("#settings-page")?.toggleAttribute("hidden", page !== "settings");
  document.querySelector("#nav-timers")?.setAttribute("aria-current", page === "timers" ? "page" : "false");
  document.querySelector("#nav-settings")?.setAttribute("aria-current", page === "settings" ? "page" : "false");
  const title = document.querySelector("#page-title");
  const kicker = document.querySelector("#page-kicker");
  if (title) title.textContent = page === "timers" ? "Timers" : "Settings";
  if (kicker) kicker.textContent = page === "timers" ? "Server time" : "This PC";
}

function bindSettingsTabs(): void {
  const tabs = [
    ["tab-settings", "settings-form"],
    ["tab-changelog", "changelog-page"],
    ["tab-help", "help-page"],
  ] as const;
  for (const [tabId] of tabs) {
    document.querySelector(`#${tabId}`)?.addEventListener("click", () => {
      for (const [id, panelId] of tabs) {
        document.querySelector(`#${id}`)?.setAttribute("aria-selected", String(id === tabId));
        document.querySelector(`#${panelId}`)?.toggleAttribute("hidden", id !== tabId);
      }
    });
  }
}

function bindWindowDrag(): void {
  for (const zone of [document.querySelector(".rail"), document.querySelector(".top")]) {
    zone?.addEventListener("pointerdown", (event) => {
      if (!(event instanceof PointerEvent) || event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("button, input, select, textarea, a")) return;
      event.preventDefault();
      void getCurrentWindow().startDragging();
    });
  }
}


function renderFilters(): void {
  renderFieldZone();
  if (!filters) return;
  filters.innerHTML = FILTERS.map(
    ([id, label]) =>
      `<button type="button" data-filter="${id}" aria-pressed="${filter === id}">${label}</button>`,
  ).join("");
  filters.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      filter = button.dataset.filter as Filter;
      renderFilters();
      renderList();
    });
  });
}

function renderFieldZone(): void {
  const node = document.querySelector<HTMLElement>("#field-zone");
  if (!node) return;
  const current = state.settings.fieldZone;
  node.innerHTML = (["altgard", "verteron"] as const)
    .map((zone) => `<button type="button" data-zone="${zone}" aria-pressed="${current === zone}">${zone === "altgard" ? "Altgard" : "Verteron"}</button>`)
    .join("");
  node.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      const zone = button.dataset.zone;
      if (zone !== "altgard" && zone !== "verteron") return;
      state.settings.fieldZone = zone;
      commit();
      renderFieldZone();
      renderList();
    });
  });
}

function renderList(): void {
  if (!list) return;
  const now = DateTime.now();
  const rows = ordered(shownTimers(state.timers, state.settings.fieldZone), now, state.settings.timeZone, filter);
  listKey = rows.map((timer) => timer.id).join("|");
  if (rows.length === 0) {
    list.innerHTML = `<p class="empty">No timers in this category.</p>`;
    return;
  }
  list.innerHTML = rows.map((timer) => rowHtml(present(timer, now, state.settings.timeZone))).join("");
}

function rowHtml(view: RowView): string {
  const phase = view.phase === "upcoming" ? "" : labelFor(view.phase);
  const kill = view.canKill
    ? `<button type="button" class="kill" data-act="kill">Killed</button>`
    : "";
  return `<article class="row" data-id="${esc(view.id)}" data-category="${view.category}" data-kind="${view.kind}" data-tracked="${view.tracked}" data-overdue="${view.phase === "overdue"}">
    <div class="pip"></div>
    <div class="meta">
      <h2>${esc(view.name)}</h2>
      <p>${esc(view.rule)}${view.note ? ` · ${esc(view.note)}` : ""}</p>
      ${view.later ? `<p class="later">${esc(view.later)}</p>` : ""}
    </div>
    <div class="when">
      <span class="phase" data-phase-label>${esc(phase)}</span>
      <time data-when>${esc(view.when)}</time>
      <strong class="count" data-count data-phase="${view.phase}" data-soon="${view.soon}">${esc(view.countdown)}</strong>
    </div>
    <div class="actions">
      ${kill}
      ${view.canSee ? `<button type="button" class="kill" data-act="seen">Seen</button>` : ""}
      <button type="button" class="icon" data-act="overlay" aria-pressed="${view.overlay}" aria-label="Show on overlay">${EYE}</button>
      <button type="button" class="icon" data-act="alarm" aria-pressed="${view.alarm}" aria-label="Alarm">${BELL}</button>
      <button type="button" class="icon" data-act="edit" aria-label="Edit">${PEN}</button>
    </div>
  </article>`;
}

function tick(): void {
  const now = DateTime.now();
  const zone = state.settings.timeZone;
  const server = now.setZone(zone);
  const serverNode = document.querySelector("#clock-st");
  const localNode = document.querySelector("#clock-lt");
  if (serverNode) serverNode.textContent = server.isValid ? formatClock(server) : "Invalid";
  if (localNode) localNode.textContent = formatClock(now);
  const warning = document.querySelector("#clock-warning");
  if (warning) warning.textContent = clockWarning(now);
  const ranked = shownTimers(state.timers, state.settings.fieldZone).map((timer) => ({
    timer,
    occurrence: evaluate(timer, now, zone),
  }));
  const settingsOpen = document.querySelector("#settings-page")?.hasAttribute("hidden") === false;
  if (!settingsOpen) paintList(ranked, now, zone);
  fireAlerts(ranked, now, zone);
  maybeRefreshFieldBosses(now);
}

function paintList(ranked: { timer: Timer; occurrence: Occurrence }[], now: DateTime, zone: string): void {
  const rows = ranked
    .filter((item) => passesFilter(item.timer, filter))
    .sort((left, right) => rankValue(left.occurrence) - rankValue(right.occurrence) || left.timer.name.localeCompare(right.timer.name));
  const key = rows.map((item) => item.timer.id).join("|");
  if (key !== listKey) {
    renderList();
    return;
  }
  refreshRows(rows, now, zone);
}

function refreshRows(rows: { timer: Timer; occurrence: Occurrence }[], _now: DateTime, zone: string): void {
  if (!list) return;
  const byId = new Map(rows.map((item) => [item.timer.id, item.occurrence]));
  for (const row of list.querySelectorAll<HTMLElement>("[data-id]")) {
    const occurrence = row.dataset.id ? byId.get(row.dataset.id) : undefined;
    if (!occurrence) continue;
    const countdown = occurrence.remainingMs == null ? "—" : formatCountdown(occurrence.remainingMs);
    const when = occurrence.start ? formatWhen(occurrence.start.setZone(zone)) : "No time set";
    const soon = occurrence.phase === "upcoming" && occurrence.remainingMs != null && occurrence.remainingMs <= 15 * 60_000;
    const count = row.querySelector("[data-count]");
    if (count && count.textContent !== countdown) {
      count.textContent = countdown;
      count.setAttribute("data-phase", occurrence.phase);
      count.setAttribute("data-soon", String(soon));
    }
    const whenNode = row.querySelector("[data-when]");
    if (whenNode && whenNode.textContent !== when) whenNode.textContent = when;
    const phase = row.querySelector("[data-phase-label]");
    const label = occurrence.phase === "upcoming" ? "" : labelFor(occurrence.phase);
    if (phase && phase.textContent !== label) phase.textContent = label;
    const overdue = String(occurrence.phase === "overdue");
    if (row.getAttribute("data-overdue") !== overdue) row.setAttribute("data-overdue", overdue);
  }
}

function labelFor(phase: RowView["phase"]): string {
  if (phase === "live") return "Live";
  if (phase === "entry") return "Entry";
  if (phase === "overdue") return "Overdue";
  if (phase === "unset") return "Unset";
  return "";
}

function replace(timer: Timer): void {
  state.timers = state.timers.map((item) => (item.id === timer.id ? timer : item));
  commit();
}

function commit(): void {
  persist();
  void emit("timers-state", state);
  void applyChrome();
  renderList();
  syncOverlayButton();
  syncSettings();
}

function syncOverlayButton(): void {
  const button = document.querySelector("#overlay-toggle");
  if (button) button.textContent = state.settings.overlayVisible ? "Hide overlay" : "Show overlay";
  const box = document.querySelector<HTMLInputElement>("#overlay-visible");
  if (box) box.checked = state.settings.overlayVisible;
}

function bindSettings(): void {
  const zone = document.querySelector<HTMLInputElement>("#zone");
  const lead = document.querySelector<HTMLInputElement>("#default-lead");
  const visible = document.querySelector<HTMLInputElement>("#overlay-visible");
  const overlayList = document.querySelector<HTMLSelectElement>("#overlay-list");
  const click = document.querySelector<HTMLInputElement>("#click-through");
  const top = document.querySelector<HTMLInputElement>("#always-on-top");
  const opacity = document.querySelector<HTMLInputElement>("#opacity");
  const scale = document.querySelector<HTMLInputElement>("#scale");
  const hotkey = document.querySelector<HTMLInputElement>("#hotkey");
  const overlayHours = document.querySelector<HTMLInputElement>("#overlay-hours");
  const quietEnabled = document.querySelector<HTMLInputElement>("#quiet-enabled");
  const alarmOnStart = document.querySelector<HTMLInputElement>("#alarm-on-start");
  const quietFrom = document.querySelector<HTMLInputElement>("#quiet-from");
  const quietUntil = document.querySelector<HTMLInputElement>("#quiet-until");
  const monitor = document.querySelector<HTMLSelectElement>("#overlay-monitor");
  if (!zone || !lead || !visible || !overlayList || !click || !top || !opacity || !scale || !hotkey || !overlayHours || !quietEnabled || !alarmOnStart || !quietFrom || !quietUntil || !monitor) return;
  syncSettings();
  zone.addEventListener("change", () => {
    const next = zone.value.trim();
    const error = document.querySelector("#zone-error");
    if (!zoneOk(next)) {
      if (error) error.textContent = "Unknown IANA time zone.";
      zone.value = state.settings.timeZone;
      return;
    }
    if (error) error.textContent = "";
    state.settings.timeZone = next;
    commit();
  });
  lead.addEventListener("change", () => {
    const value = Number(lead.value);
    if (!Number.isInteger(value) || value < 0) return;
    state.settings.defaultLeadMinutes = value;
    commit();
  });
  overlayHours.addEventListener("change", () => {
    const value = Number(overlayHours.value);
    if (!Number.isInteger(value) || value < 1 || value > 48) return;
    state.settings.overlayHours = value;
    commit();
  });
  document.querySelectorAll<HTMLInputElement>("input[name=alarm-tone]").forEach((input) => {
    input.addEventListener("change", () => {
      const tone = Number(input.value);
      if (tone !== 1 && tone !== 2 && tone !== 3) return;
      state.settings.alarmTone = tone;
      commit();
    });
  });
  document.querySelector("#tone-preview")?.addEventListener("click", () => {
    unlockSound();
    playAlert(state.settings.alarmTone, state.settings.alarmVolume);
  });
  visible.addEventListener("change", () => {
    state.settings.overlayVisible = visible.checked;
    commit();
  });
  overlayList.addEventListener("change", () => {
    if (!isOverlayList(overlayList.value)) return;
    state.settings.overlayList = overlayList.value;
    commit();
  });
  quietEnabled.addEventListener("change", () => {
    state.settings.quietEnabled = quietEnabled.checked;
    commit();
  });
  alarmOnStart.addEventListener("change", () => {
    state.settings.alarmOnStart = alarmOnStart.checked;
    commit();
  });
  quietFrom.addEventListener("change", () => {
    const value = Number(quietFrom.value);
    if (!Number.isInteger(value) || value < 0 || value > 23) return;
    state.settings.quietFrom = value;
    commit();
  });
  quietUntil.addEventListener("change", () => {
    const value = Number(quietUntil.value);
    if (!Number.isInteger(value) || value < 0 || value > 23) return;
    state.settings.quietUntil = value;
    commit();
  });
  monitor.addEventListener("change", () => {
    void placeOnMonitor(monitor.value);
  });
  click.addEventListener("change", () => {
    state.settings.clickThrough = click.checked;
    commit();
  });
  top.addEventListener("change", () => {
    state.settings.alwaysOnTop = top.checked;
    commit();
  });
  opacity.addEventListener("input", () => {
    state.settings.opacity = Number(opacity.value);
    commit();
  });
  const alarmVolume = document.querySelector<HTMLInputElement>("#alarm-volume");
  alarmVolume?.addEventListener("input", () => {
    state.settings.alarmVolume = Number(alarmVolume.value);
    commit();
  });
  scale.addEventListener("input", () => {
    state.settings.scale = Number(scale.value);
    commit();
  });
  document.querySelector("#hotkey-capture")?.addEventListener("click", () => {
    capturing = true;
    hotkey.value = "Press a shortcut";
  });
  window.addEventListener("keydown", (event) => {
    if (!capturing) return;
    event.preventDefault();
    if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return;
    const parts: string[] = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if (event.metaKey) parts.push("Super");
    parts.push(event.key.length === 1 ? event.key.toUpperCase() : event.key);
    capturing = false;
    const accelerator = parts.join("+");
    void invoke<void>("set_hotkey", { accelerator }).then(
      () => {
        state.settings.hotkey = accelerator;
        const error = document.querySelector("#hotkey-error");
        if (error) error.textContent = "";
        commit();
      },
      (error: unknown) => {
        const node = document.querySelector("#hotkey-error");
        if (node) node.textContent = String(error);
        hotkey.value = state.settings.hotkey;
      },
    );
  });
  document.querySelector<HTMLInputElement>("#field-boss-auto")?.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    state.settings.fieldBossAuto = input.checked;
    commit();
  });
  document.querySelector<HTMLInputElement>("#field-boss-minutes")?.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const value = Number(input.value);
    state.settings.fieldBossMinutes = Number.isInteger(value) && value >= 1 && value <= 60 ? value : 5;
    commit();
  });
}

function syncSettings(): void {
  const settings = state.settings;
  setValue("#zone", settings.timeZone);
  setValue("#default-lead", String(settings.defaultLeadMinutes));
  setValue("#hotkey", settings.hotkey);
  setValue("#overlay-hours", String(settings.overlayHours));
  setChecked("#overlay-visible", settings.overlayVisible);
  setValue("#overlay-list", settings.overlayList);
  setChecked("#quiet-enabled", settings.quietEnabled);
  setChecked("#alarm-on-start", settings.alarmOnStart);
  setChecked("#field-boss-auto", settings.fieldBossAuto);
  setValue("#field-boss-minutes", String(settings.fieldBossMinutes));
  setValue("#quiet-from", String(settings.quietFrom));
  setValue("#quiet-until", String(settings.quietUntil));
  setValue("#overlay-monitor", settings.overlayMonitor ?? "");
  setChecked("#click-through", settings.clickThrough);
  setChecked("#always-on-top", settings.alwaysOnTop);
  setValue("#opacity", String(settings.opacity));
  setValue("#scale", String(settings.scale));
  const opacity = document.querySelector("#opacity-value");
  const scale = document.querySelector("#scale-value");
  if (opacity) opacity.textContent = settings.opacity.toFixed(2);
  if (scale) scale.textContent = settings.scale.toFixed(2);
  setValue("#alarm-volume", String(settings.alarmVolume ?? 0.7));
  const alarmVolume = document.querySelector("#alarm-volume-value");
  if (alarmVolume) alarmVolume.textContent = `${Math.round((settings.alarmVolume ?? 0.7) * 100)}%`;
  document.querySelectorAll<HTMLInputElement>("input[name=alarm-tone]").forEach((input) => {
    input.checked = Number(input.value) === settings.alarmTone;
  });
}

function setValue(selector: string, value: string): void {
  const node = document.querySelector<HTMLInputElement>(selector);
  if (node && document.activeElement !== node) node.value = value;
}

function setChecked(selector: string, value: boolean): void {
  const node = document.querySelector<HTMLInputElement>(selector);
  if (node) node.checked = value;
}

async function boot(): Promise<void> {
  await listen("request-state", () => emit("timers-state", state));
  await listen<{ id: string }>("timer-killed", (event) => {
    const timer = state.timers.find((item) => item.id === event.payload.id);
    if (!timer) return;
    const next = markKilled(timer, DateTime.now());
    if (next) replace(next);
  });
  await listen<boolean>("overlay-visibility", (event) => {
    state.settings.overlayVisible = event.payload;
    persist();
    syncOverlayButton();
    syncSettings();
    void emit("timers-state", state);
  });
  await listen<{ x: number; y: number }>("overlay-moved", (event) => {
    state.settings.overlayX = event.payload.x;
    state.settings.overlayY = event.payload.y;
    rememberOverlayGeometry();
  });
  await listen<{ width: number; height: number }>("overlay-resized", (event) => {
    if (event.payload.width < 200 || event.payload.height < 120) return;
    state.settings.overlayWidth = event.payload.width;
    state.settings.overlayHeight = event.payload.height;
    rememberOverlayGeometry();
  });
  await listen("overlay-compact", () => {
    state.settings.overlayList = nextList(state.settings.overlayList);
    commit();
  });
  await listen<{ id: string }>("timer-seen", (event) => {
    const timer = state.timers.find((item) => item.id === event.payload.id);
    if (!timer) return;
    const next = markSeen(timer, DateTime.now(), state.settings.timeZone);
    if (next) replace(next);
  });
  await emit("timers-state", state);
  await applyChrome();
  await invoke("place_overlay", {
    x: state.settings.overlayX ?? 48,
    y: state.settings.overlayY ?? 80,
    width: state.settings.overlayWidth,
    height: state.settings.overlayHeight,
  });
  await invoke("set_hotkey", { accelerator: state.settings.hotkey }).catch((error: unknown) => {
    const node = document.querySelector("#hotkey-error");
    if (node) node.textContent = String(error);
  });
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  if (!granted) {
    const node = document.querySelector("#hotkey-error");
    if (node && !node.textContent) node.textContent = "Desktop notifications are blocked. The sound still plays.";
  }
  document.addEventListener("pointerdown", unlockSound);
  await restoreState();
  paintRefreshStatus();
  void checkForUpdate();
  void refreshSavedTimers();
  void loadMonitors();
}

async function pasteSpawn(): Promise<void> {
  const status = document.querySelector("#paste-status");
  let text = "";
  try {
    text = await navigator.clipboard.readText();
  } catch {
    if (status) status.textContent = "Clipboard blocked.";
    return;
  }
  const hits = parseSpawns(text, DateTime.now(), state.settings.timeZone);
  if (hits.length === 0) {
    if (status) status.textContent = "No spawn time in the clipboard. Use Gartua 00:34.";
    return;
  }
  const result = applySpawns(state.timers, hits, state.settings.defaultLeadMinutes, state.settings.timeZone);
  state.timers = result.timers;
  commit();
  renderList();
  if (status) status.textContent = result.notes.join(" ");
}



function paintRefreshStatus(): void {
  const catalog = document.querySelector("#catalog-status");
  const field = document.querySelector("#field-boss-status");
  if (catalog && !catalogBusy) catalog.textContent = refreshedLabel("Current", state.settings.catalogUpdatedAt);
  if (field && !fieldBossBusy) field.textContent = refreshedLabel("Current", state.settings.fieldBossesUpdatedAt);
}

function refreshedLabel(word: string, iso: string | null, detail = ""): string {
  if (!iso) return "Not checked.";
  const when = DateTime.fromISO(iso).setZone(state.settings.timeZone);
  if (!when.isValid) return "Not checked.";
  return `${word}. Last updated ${when.toFormat("HH:mm")}.${detail ? ` ${detail}` : ""}`;
}

function maybeRefreshFieldBosses(now: DateTime): void {
  if (!state.settings.fieldBossAuto || fieldBossBusy) return;
  const last = state.settings.fieldBossesUpdatedAt;
  const at = last ? DateTime.fromISO(last) : null;
  const age = at?.isValid ? now.toMillis() - at.toMillis() : Number.POSITIVE_INFINITY;
  if (age < state.settings.fieldBossMinutes * 60_000) return;
  void refreshFieldBosses(true);
}

async function refreshCatalog(quiet: boolean): Promise<void> {
  if (catalogBusy) return;
  catalogBusy = true;
  const status = document.querySelector("#catalog-status");
  const button = document.querySelector<HTMLButtonElement>("#catalog-refresh");
  if (status) status.textContent = "Updating…";
  if (button) button.disabled = true;
  try {
    const result = await pullCatalog();
    state = mergeCatalog(state, true);
    state.settings.catalogUpdatedAt = new Date().toISOString();
    commit();
    if (status) status.textContent = refreshedLabel(result.changed ? "Updated" : "Current", state.settings.catalogUpdatedAt, result.changed ? `${result.count} timers.` : "");
  } catch (error) {
    if (status) status.textContent = quiet && state.settings.catalogUpdatedAt ? refreshedLabel("Current", state.settings.catalogUpdatedAt) : error instanceof Error ? error.message : "Catalog fetch failed.";
  } finally {
    catalogBusy = false;
    if (button) button.disabled = false;
  }
}

async function refreshFieldBosses(quiet: boolean): Promise<void> {
  if (fieldBossBusy) return;
  fieldBossBusy = true;
  const status = document.querySelector("#field-boss-status");
  const button = document.querySelector<HTMLButtonElement>("#field-boss-refresh");
  if (status) status.textContent = "Updating…";
  if (button) button.disabled = true;
  try {
    const reports = await pullFieldReports();
    const before = state.timers.length;
    state.timers = applyFieldReports(state.timers, reports, state.settings.defaultLeadMinutes);
    const added = state.timers.length - before;
    state.settings.fieldBossesUpdatedAt = new Date().toISOString();
    commit();
    renderList();
    const up = reports.filter((report) => report.up).length;
    const detail = added > 0 ? `${reports.length} reports, ${added} new, ${up} up.` : `${reports.length} reports, ${up} up.`;
    if (status) status.textContent = refreshedLabel(added > 0 ? "Updated" : "Current", state.settings.fieldBossesUpdatedAt, detail);
  } catch (error) {
    if (status) status.textContent = quiet && state.settings.fieldBossesUpdatedAt ? refreshedLabel("Current", state.settings.fieldBossesUpdatedAt) : error instanceof Error ? error.message : "Field boss report failed.";
  } finally {
    fieldBossBusy = false;
    if (button) button.disabled = false;
  }
}

async function refreshSavedTimers(): Promise<void> {
  await refreshCatalog(true);
  await refreshFieldBosses(true);
}

let pendingUpdate: Update | null = null;

function setUpdateStatus(text: string): void {
  const node = document.querySelector("#update-status");
  if (node) node.textContent = text;
}

async function checkForUpdate(): Promise<void> {
  setUpdateStatus("Checking…");
  document.querySelector("#update-install")?.setAttribute("hidden", "");
  try {
    pendingUpdate = await check();
  } catch (error) {
    pendingUpdate = null;
    setUpdateStatus(`Update check failed. ${error}`);
    return;
  }
  if (!pendingUpdate) {
    setUpdateStatus("Up to date.");
    return;
  }
  setUpdateStatus(`Version ${pendingUpdate.version} is available.`);
  document.querySelector("#update-install")?.removeAttribute("hidden");
  const text = document.querySelector("#update-dialog-text");
  if (text) text.textContent = `Version ${pendingUpdate.version} is ready. It installs and restarts.`;
  document.querySelector<HTMLDialogElement>("#update-dialog")?.showModal();
}

async function installUpdate(): Promise<void> {
  if (!pendingUpdate) return;
  setUpdateStatus("Installing…");
  try {
    await pendingUpdate.downloadAndInstall();
    await relaunch();
  } catch (error) {
    setUpdateStatus(`Install failed. ${error}`);
  }
}

async function applyChrome(): Promise<void> {
  await invoke("set_overlay_visible", { visible: state.settings.overlayVisible });
  await invoke("set_overlay_chrome", {
    alwaysOnTop: state.settings.alwaysOnTop,
    clickThrough: state.settings.clickThrough,
  });
}

function fireAlerts(ranked: { timer: Timer; occurrence: Occurrence }[], now: DateTime, zone: string): void {
  const seen = new Set(state.alerted);
  const quiet = inQuietHours(now, state.settings.quietFrom, state.settings.quietUntil, state.settings.quietEnabled);
  let changed = false;
  for (const item of ranked) {
    for (const due of alertsFrom(item.timer, item.occurrence, now, zone, seen)) {
      if (due.started && !state.settings.alarmOnStart) continue;
      state.alerted.push(due.key);
      seen.add(due.key);
      changed = true;
      if (quiet) continue;
      playAlert(item.timer.alarmTone ?? state.settings.alarmTone, state.settings.alarmVolume);
      const body = due.started ? `${item.timer.name} started` : `${item.timer.name} in ${due.minutes} min`;
      try {
        sendNotification({ title: "Aion 2 Timers", body });
      } catch {
        // A blocked notification must not stop the sound or the next timer.
      }
    }
  }
  if (!changed) return;
  const cutoff = now.minus({ hours: 36 }).toMillis();
  state.alerted = state.alerted.filter((key) => {
    const at = DateTime.fromISO(key.slice(key.indexOf("@") + 1).split("#")[0] ?? "");
    return at.isValid && at.toMillis() >= cutoff;
  });
  persist();
}

let monitors: { name: string; x: number; y: number }[] = [];

let geometryTimer = 0;

function rememberOverlayGeometry(): void {
  window.clearTimeout(geometryTimer);
  geometryTimer = window.setTimeout(() => {
    geometryTimer = 0;
    persist();
  }, 400);
}

function persist(): void {
  if (geometryTimer) {
    window.clearTimeout(geometryTimer);
    geometryTimer = 0;
  }
  saveState(state);
  void invoke("save_state_file", { state: JSON.stringify(state) });
}

async function restoreState(): Promise<void> {
  try {
    const raw = await invoke<string | null>("load_state_file");
    state = mergeStores(state, raw ? parseState(raw) : null);
  } catch {
    // The window store still has this session.
  }
  persist();
  void emit("timers-state", state);
  renderList();
}

function nextList(current: OverlayList): OverlayList {
  if (current === "all") return "next3";
  if (current === "next3") return "soon";
  return "all";
}

function isOverlayList(value: string): value is OverlayList {
  return value === "all" || value === "next3" || value === "soon";
}

function exportList(): void {
  const blob = new Blob([exportTimers(state.timers)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "aion2-timers.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importList(file: File): Promise<void> {
  const status = document.querySelector("#paste-status");
  const result = importTimers(state.timers, await file.text(), state.settings.defaultLeadMinutes);
  if ("error" in result) {
    if (status) status.textContent = result.error;
    return;
  }
  state.timers = result.timers;
  commit();
  if (status) status.textContent = result.note;
}


async function loadMonitors(): Promise<void> {
  const select = document.querySelector<HTMLSelectElement>("#overlay-monitor");
  if (!select) return;
  try {
    const found = await availableMonitors();
    monitors = found.map((monitor, index) => ({
      name: monitor.name ?? `Display ${index + 1}`,
      x: monitor.position.x,
      y: monitor.position.y,
    }));
  } catch {
    return;
  }
  const current = state.settings.overlayMonitor ?? "";
  select.replaceChildren(new Option("Current position", ""));
  for (const monitor of monitors) select.append(new Option(monitor.name, monitor.name));
  select.value = current;
}

async function placeOnMonitor(name: string): Promise<void> {
  state.settings.overlayMonitor = name || null;
  const monitor = monitors.find((item) => item.name === name);
  if (monitor) {
    state.settings.overlayX = monitor.x + 48;
    state.settings.overlayY = monitor.y + 80;
    await invoke("place_overlay", {
      x: state.settings.overlayX,
      y: state.settings.overlayY,
      width: state.settings.overlayWidth,
      height: state.settings.overlayHeight,
    });
  }
  commit();
}

function clockWarning(now: DateTime): string {
  const server = now.setZone(state.settings.timeZone);
  if (!server.isValid) return "";
  const lines: string[] = [];
  const diffHours = (server.offset - now.offset) / 60;
  if (diffHours !== 0) lines.push(`Server zone and this PC differ by ${Math.abs(diffHours)} h.`);
  const berlin = now.setZone("Europe/Berlin");
  if (state.settings.timeZone === "Europe/Berlin" && berlin.month === 10 && berlin.day >= 22 && berlin.day <= 28) {
    lines.push("25 October: Berlin clocks fall back. Daily reset stays 07:00 UTC. Check both clocks against the game.");
  }
  return lines.join(" ");
}
