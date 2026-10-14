import { emit, listen } from "@tauri-apps/api/event";
import { DateTime } from "luxon";
import { formatClock } from "./lib/format.ts";
import { esc } from "./lib/html.ts";
import { loadState } from "./lib/state.ts";
import type { AppState, Timer } from "./lib/types.ts";
import { dueOnOverlay, ordered, present } from "./lib/view.ts";

let state: AppState = loadState();
let listKey = "";

const rows = document.querySelector<HTMLElement>("#rows");
const panel = document.querySelector<HTMLElement>("#panel");
const note = document.querySelector<HTMLElement>("#overlay-note");
const compact = document.querySelector<HTMLButtonElement>("#compact");

compact?.addEventListener("click", () => emit("overlay-compact"));
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
window.setInterval(tick, 250);

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

function visibleTimers() {
  const now = DateTime.now();
  const pinned = ordered(
    state.timers.filter((timer) => timer.overlay),
    now,
    state.settings.timeZone,
    "all",
  );
  const due = pinned.filter((timer) => dueOnOverlay(timer, now, state.settings.timeZone, state.settings.overlayHours));
  const listed = state.settings.overlayList === "soon" ? due.filter((timer) => isSoon(timer, now)) : due;
  const shown = state.settings.overlayList === "next3" ? listed.slice(0, 3) : listed;
  return {
    shown,
    later: pinned.length - listed.length,
    compactHidden: state.settings.overlayList === "next3" ? Math.max(0, listed.length - 3) : 0,
  };
}

function render(): void {
  if (!rows) return;
  const now = DateTime.now();
  const { shown, later, compactHidden } = visibleTimers();
  listKey = `${state.settings.overlayList}:${state.settings.overlayHours}:${shown.map((timer) => timer.id).join("|")}`;
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
      .map((timer) => {
        const view = present(timer, now, state.settings.timeZone);
        const detail = view.phase === "upcoming" ? view.when : labelFor(view.phase);
        const kill = view.canKill
          ? `<button type="button" class="overlay-act" data-kill="${esc(view.id)}" aria-label="Killed ${esc(view.name)}">Killed</button>`
          : "";
        const seen = view.canSee
          ? `<button type="button" class="overlay-act" data-seen="${esc(view.id)}" aria-label="Seen ${esc(view.name)}">Seen</button>`
          : "";
        return `<article class="overlay-row" data-id="${esc(view.id)}" data-category="${esc(view.category)}" data-phase="${esc(view.phase)}">
          <div class="overlay-copy">
            <strong>${esc(view.name)}</strong>
            <p><span>${esc(view.category)}</span> · <span data-detail>${esc(detail)}</span></p>
          </div>
          <div class="overlay-side">
            <div class="data-count" data-count data-phase="${esc(view.phase)}">${esc(view.countdown)}</div>
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
  const { shown } = visibleTimers();
  const key = `${state.settings.overlayList}:${state.settings.overlayHours}:${shown.map((timer) => timer.id).join("|")}`;
  if (key !== listKey) {
    render();
    return;
  }
  if (!rows) return;
  for (const timer of shown) {
    const row = rows.querySelector(`[data-id="${CSS.escape(timer.id)}"]`);
    if (!row) continue;
    const view = present(timer, now, state.settings.timeZone);
    const count = row.querySelector("[data-count]");
    if (count) {
      count.textContent = view.countdown;
      count.setAttribute("data-phase", view.phase);
      count.setAttribute("data-soon", String(view.soon));
    }
    const detail = row.querySelector("[data-detail]");
    if (detail) detail.textContent = view.phase === "upcoming" ? view.when : labelFor(view.phase);
    row.setAttribute("data-phase", view.phase);
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
  const view = present(timer, now, state.settings.timeZone);
  return view.phase === "live" || view.phase === "entry" || view.phase === "overdue" || view.soon;
}
