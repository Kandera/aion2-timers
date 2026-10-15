import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { DateTime } from "luxon";
import { formatClock, formatCountdown, formatWhen } from "./lib/format.ts";
import { esc } from "./lib/html.ts";
import { evaluate, type Occurrence } from "./lib/schedule.ts";
import { loadState } from "./lib/state.ts";
import type { AppState, Timer } from "./lib/types.ts";
import { rankValue, shownTimers } from "./lib/view.ts";

let state: AppState = loadState();
let listKey = "";

const rows = document.querySelector<HTMLElement>("#rows");
const panel = document.querySelector<HTMLElement>("#panel");
const note = document.querySelector<HTMLElement>("#overlay-note");
const compact = document.querySelector<HTMLButtonElement>("#compact");

compact?.addEventListener("click", () => emit("overlay-compact"));
document.querySelector(".panel-head")?.addEventListener("pointerdown", (event) => {
  if (!(event instanceof PointerEvent) || event.button !== 0) return;
  const target = event.target;
  if (!(target instanceof Element) || target.closest("button")) return;
  event.preventDefault();
  void getCurrentWindow().startDragging();
});
rows?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!button) return;
  if (button.dataset.kill) void emit("timer-killed", { id: button.dataset.kill });
  if (button.dataset.seen) void emit("timer-seen", { id: button.dataset.seen });
});

void listen<AppState>("timers-state", (event) => {
  state = event.payload;
  applyChrome();
  render();
});
void emit("request-state");
applyChrome();
render();
window.setInterval(tick, 1000);

function applyChrome(): void {
  if (!panel) return;
  panel.style.setProperty("--opacity", String(state.settings.opacity));
  panel.style.setProperty("--scale", String(state.settings.scale));
  if (note) note.hidden = !state.settings.clickThrough;
  if (compact) {
    compact.textContent = listLabel(state.settings.overlayList);
    compact.setAttribute("aria-pressed", String(state.settings.overlayList !== "all"));
  }
  panel.classList.toggle("idle", idleOverlay() && !state.settings.clickThrough);
}


function overlayMeta(now: DateTime): { shown: { timer: Timer; occurrence: Occurrence }[]; later: number; compactHidden: number } {
  const zone = state.settings.timeZone;
  const limit = Math.min(48, Math.max(1, state.settings.overlayHours)) * 3_600_000;
  const ranked = shownTimers(state.timers, state.settings.fieldZone)
    .filter((timer) => timer.overlay)
    .map((timer) => ({ timer, occurrence: evaluate(timer, now, zone) }))
    .sort((left, right) => rankValue(left.occurrence) - rankValue(right.occurrence) || left.timer.name.localeCompare(right.timer.name));
  const due = ranked.filter((item) => onOverlay(item.occurrence, limit));
  const listed = state.settings.overlayList === "soon" ? due.filter((item) => soon(item.occurrence)) : due;
  const shown = state.settings.overlayList === "next3" ? listed.slice(0, 3) : listed;
  return {
    shown,
    later: ranked.length - listed.length,
    compactHidden: state.settings.overlayList === "next3" ? Math.max(0, listed.length - 3) : 0,
  };
}

function onOverlay(occurrence: Occurrence, limit: number): boolean {
  if (occurrence.phase === "unset") return false;
  if (occurrence.phase !== "upcoming") return true;
  return occurrence.remainingMs != null && occurrence.remainingMs <= limit;
}

function soon(occurrence: Occurrence): boolean {
  return (
    occurrence.phase === "live" ||
    occurrence.phase === "entry" ||
    occurrence.phase === "overdue" ||
    (occurrence.phase === "upcoming" && occurrence.remainingMs != null && occurrence.remainingMs <= 15 * 60_000)
  );
}

function render(): void {
  if (!rows) return;
  const now = DateTime.now();
  const { shown, later, compactHidden } = overlayMeta(now);
  listKey = `${state.settings.overlayList}:${state.settings.overlayHours}:${shown.map((item) => item.timer.id).join("|")}`;
  if (shown.length === 0) {
    rows.innerHTML = `<p class="empty">${later > 0 ? `Nothing due in the next ${state.settings.overlayHours} h.` : "No timers on the overlay."}</p>`;
    return;
  }
  const notes = [
    compactHidden > 0 ? `${compactHidden} more hidden by compact.` : "",
    later > 0 ? `${later} later, outside ${state.settings.overlayHours} h.` : "",
  ].filter(Boolean);
  rows.innerHTML =
    shown
      .map((item) => {
        const view = item.occurrence;
        const name = item.timer.name;
        const kind = item.timer.id.startsWith("nm-") || item.timer.schedule.kind === "rolling" ? "field" : item.timer.category;
        const detail = view.phase === "upcoming" ? (view.start ? formatWhen(view.start.setZone(state.settings.timeZone)) : "No time set") : labelFor(view.phase);
        const countdown = view.remainingMs == null ? "—" : formatCountdown(view.remainingMs);
        const kill = item.timer.respawnIntervalMinutes != null && item.timer.respawnIntervalMinutes >= 1
          ? `<button type="button" class="overlay-act" data-kill="${esc(item.timer.id)}" aria-label="Killed ${esc(name)}">Killed</button>`
          : "";
        const seen = item.timer.schedule.kind !== "rolling" && view.start
          ? `<button type="button" class="overlay-act" data-seen="${esc(item.timer.id)}" aria-label="Seen ${esc(name)}">Seen</button>`
          : "";
        return `<article class="overlay-row" data-id="${esc(item.timer.id)}" data-category="${esc(item.timer.category)}" data-kind="${kind}" data-phase="${esc(view.phase)}">
          <div class="overlay-copy">
            <strong>${esc(name)}</strong>
            <p><span>${esc(kind === "field" ? "Field" : item.timer.category)}</span> · <span data-detail>${esc(detail)}</span></p>
          </div>
          <div class="overlay-side">
            <div class="data-count" data-count data-phase="${esc(view.phase)}">${esc(countdown)}</div>
            ${kill}${seen}
          </div>
        </article>`;
      })
      .join("") + (notes.length > 0 ? `<p class="panel-note">${esc(notes.join(" "))}</p>` : "");
}

function tick(): void {
  const now = DateTime.now();
  const server = now.setZone(state.settings.timeZone);
  const serverNode = document.querySelector("#clock-st");
  const localNode = document.querySelector("#clock-lt");
  if (serverNode) serverNode.textContent = server.isValid ? formatClock(server) : "Invalid";
  if (localNode) localNode.textContent = formatClock(now);
  const shown = overlayMeta(now).shown;
  const key = `${state.settings.overlayList}:${state.settings.overlayHours}:${shown.map((item) => item.timer.id).join("|")}`;
  if (key !== listKey) {
    render();
    return;
  }
  if (!rows) return;
  const zone = state.settings.timeZone;
  for (const item of shown) {
    const row = rows.querySelector(`[data-id="${CSS.escape(item.timer.id)}"]`);
    if (!row) continue;
    const countdown = item.occurrence.remainingMs == null ? "—" : formatCountdown(item.occurrence.remainingMs);
    const count = row.querySelector("[data-count]");
    if (count && count.textContent !== countdown) {
      count.textContent = countdown;
      count.setAttribute("data-phase", item.occurrence.phase);
    }
    const detail = row.querySelector("[data-detail]");
    const text = item.occurrence.phase === "upcoming"
      ? item.occurrence.start ? formatWhen(item.occurrence.start.setZone(zone)) : "No time set"
      : labelFor(item.occurrence.phase);
    if (detail && detail.textContent !== text) detail.textContent = text;
    if (row.getAttribute("data-phase") !== item.occurrence.phase) row.setAttribute("data-phase", item.occurrence.phase);
  }
}

function labelFor(phase: string): string {
  if (phase === "live") return "Live";
  if (phase === "entry") return "Entry";
  if (phase === "overdue") return "Overdue";
  if (phase === "unset") return "Unset";
  return "";
}

function listLabel(mode: string): string {
  if (mode === "next3") return "Next 3";
  if (mode === "soon") return "Soon";
  return "All";
}

function idleOverlay(): boolean {
  const now = DateTime.now();
  return !state.timers.some((timer) => timer.overlay && isSoon(timer, now));
}

function isSoon(timer: Timer, now: DateTime): boolean {
  return soon(evaluate(timer, now, state.settings.timeZone));
}
