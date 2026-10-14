import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { DateTime } from "luxon";
import { bindEditor } from "./editor.ts";
import { esc } from "./lib/html.ts";
import { pullCatalog } from "./lib/catalog.ts";
import { applySpawns, parseSpawns } from "./lib/paste.ts";
import { dueAlert, markKilled, zoneOk } from "./lib/schedule.ts";
import { playAlert, unlockSound } from "./lib/sound.ts";
import { loadState, mergeCatalog, resetToCatalog, saveState } from "./lib/state.ts";
import type { AppState, Category, Timer } from "./lib/types.ts";
import { formatClock } from "./lib/format.ts";
import { ordered, present, type RowView } from "./lib/view.ts";

type Filter = Category | "all";

const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["event", "Events"],
  ["boss", "Bosses"],
  ["pvp", "PvP"],
  ["system", "System"],
];

const EYE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="2.4" fill="currentColor"/></svg>`;
const BELL = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 19a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`;
const PEN = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;

let state: AppState = loadState();
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
document.querySelector("#update-check")?.addEventListener("click", () => {
  void checkForUpdate();
});
document.querySelector("#update-install")?.addEventListener("click", () => {
  void installUpdate();
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
  if (act === "overlay") replace({ ...timer, overlay: !timer.overlay });
  if (act === "alarm") replace({ ...timer, alarm: !timer.alarm });
  if (act === "kill") {
    const next = markKilled(timer, DateTime.now());
    if (next) replace(next);
  }
});

bindSettings();
renderFilters();
renderList();
syncOverlayButton();
void boot();
window.setInterval(tick, 250);
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

function renderFilters(): void {
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

function renderList(): void {
  if (!list) return;
  const now = DateTime.now();
  const rows = ordered(state.timers, now, state.settings.timeZone, filter);
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
  return `<article class="row" data-id="${esc(view.id)}" data-category="${view.category}" data-overdue="${view.phase === "overdue"}">
    <div class="pip"></div>
    <div class="meta">
      <h2>${esc(view.name)}</h2>
      <p>${esc(view.rule)}${view.note ? ` · ${esc(view.note)}` : ""}</p>
    </div>
    <div class="when">
      <span class="phase" data-phase-label>${esc(phase)}</span>
      <time data-when>${esc(view.when)}</time>
      <strong class="count" data-count data-phase="${view.phase}" data-soon="${view.soon}">${esc(view.countdown)}</strong>
    </div>
    <div class="actions">
      ${kill}
      <button type="button" class="icon" data-act="overlay" aria-pressed="${view.overlay}" aria-label="Show on overlay">${EYE}</button>
      <button type="button" class="icon" data-act="alarm" aria-pressed="${view.alarm}" aria-label="Alarm">${BELL}</button>
      <button type="button" class="icon" data-act="edit" aria-label="Edit">${PEN}</button>
    </div>
  </article>`;
}

function tick(): void {
  const now = DateTime.now();
  const server = now.setZone(state.settings.timeZone);
  const serverNode = document.querySelector("#clock-st");
  const localNode = document.querySelector("#clock-lt");
  if (serverNode) serverNode.textContent = server.isValid ? formatClock(server) : "Invalid";
  if (localNode) localNode.textContent = formatClock(now);
  const rows = ordered(state.timers, now, state.settings.timeZone, filter);
  const key = rows.map((timer) => timer.id).join("|");
  if (key !== listKey) renderList();
  else refreshRows(now);
  void checkAlerts(now);
}

function refreshRows(now: DateTime): void {
  if (!list) return;
  for (const timer of state.timers) {
    const row = list.querySelector(`[data-id="${CSS.escape(timer.id)}"]`);
    if (!row) continue;
    const view = present(timer, now, state.settings.timeZone);
    const count = row.querySelector("[data-count]");
    if (count) {
      count.textContent = view.countdown;
      count.setAttribute("data-phase", view.phase);
      count.setAttribute("data-soon", String(view.soon));
    }
    const when = row.querySelector("[data-when]");
    if (when) when.textContent = view.when;
    const phase = row.querySelector("[data-phase-label]");
    if (phase) phase.textContent = view.phase === "upcoming" ? "" : labelFor(view.phase);
    row.setAttribute("data-overdue", String(view.phase === "overdue"));
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
  saveState(state);
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
  const compact = document.querySelector<HTMLInputElement>("#compact");
  const click = document.querySelector<HTMLInputElement>("#click-through");
  const top = document.querySelector<HTMLInputElement>("#always-on-top");
  const opacity = document.querySelector<HTMLInputElement>("#opacity");
  const scale = document.querySelector<HTMLInputElement>("#scale");
  const hotkey = document.querySelector<HTMLInputElement>("#hotkey");
  const overlayHours = document.querySelector<HTMLInputElement>("#overlay-hours");
  if (!zone || !lead || !visible || !compact || !click || !top || !opacity || !scale || !hotkey || !overlayHours) return;
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
  compact.addEventListener("change", () => {
    state.settings.compact = compact.checked;
    commit();
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
}

function syncSettings(): void {
  const settings = state.settings;
  setValue("#zone", settings.timeZone);
  setValue("#default-lead", String(settings.defaultLeadMinutes));
  setValue("#hotkey", settings.hotkey);
  setValue("#overlay-hours", String(settings.overlayHours));
  setChecked("#overlay-visible", settings.overlayVisible);
  setChecked("#compact", settings.compact);
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
    saveState(state);
    syncOverlayButton();
    syncSettings();
    void emit("timers-state", state);
  });
  await listen<{ x: number; y: number }>("overlay-moved", (event) => {
    state.settings.overlayX = event.payload.x;
    state.settings.overlayY = event.payload.y;
    saveState(state);
  });
  await listen<{ width: number; height: number }>("overlay-resized", (event) => {
    if (event.payload.width < 200 || event.payload.height < 120) return;
    state.settings.overlayWidth = event.payload.width;
    state.settings.overlayHeight = event.payload.height;
    saveState(state);
  });
  await listen("overlay-compact", () => {
    state.settings.compact = !state.settings.compact;
    commit();
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
  unlockSound();
  document.addEventListener("pointerdown", unlockSound);
  void checkForUpdate();
  void refreshCatalog(true);
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

async function refreshCatalog(quiet: boolean): Promise<void> {
  const status = document.querySelector("#catalog-status");
  try {
    const result = await pullCatalog();
    state = mergeCatalog(state, true);
    commit();
    renderList();
    syncSettings();
    if (status) status.textContent = result.changed ? `Catalog updated. ${result.count} timers.` : "Catalog is already current.";
  } catch (error) {
    if (status) status.textContent = quiet ? "Using the saved schedule." : error instanceof Error ? error.message : "Catalog fetch failed.";
  }
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

async function checkAlerts(now: DateTime): Promise<void> {
  const seen = new Set(state.alerted);
  let changed = false;
  for (const timer of state.timers) {
    const due = dueAlert(timer, now, state.settings.timeZone, seen);
    if (!due) continue;
    state.alerted.push(due.key);
    seen.add(due.key);
    changed = true;
    playAlert(state.settings.alarmTone, state.settings.alarmVolume);
    try {
      sendNotification({ title: "Aion 2 Timers", body: `${timer.name} in ${due.minutes} min` });
    } catch {
      // A blocked notification must not stop the sound or the next timer.
    }
  }
  if (!changed) return;
  const cutoff = now.minus({ hours: 36 }).toMillis();
  state.alerted = state.alerted.filter((key) => {
    const at = DateTime.fromISO(key.slice(key.indexOf("@") + 1));
    return at.isValid && at.toMillis() >= cutoff;
  });
  saveState(state);
}
