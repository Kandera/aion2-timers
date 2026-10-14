import { emit, listen } from "@tauri-apps/api/event";
import { DateTime } from "luxon";
import { formatClock } from "./lib/format.ts";
import { esc } from "./lib/html.ts";
import { loadState } from "./lib/state.ts";
import type { AppState } from "./lib/types.ts";
import { ordered, present } from "./lib/view.ts";

let state: AppState = loadState();
let listKey = "";

const rows = document.querySelector<HTMLElement>("#rows");
const panel = document.querySelector<HTMLElement>("#panel");
const note = document.querySelector<HTMLElement>("#overlay-note");
const compact = document.querySelector<HTMLButtonElement>("#compact");

compact?.addEventListener("click", () => emit("overlay-compact"));
rows?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-kill]");
  if (!button || button.disabled) return;
  void emit("timer-killed", { id: button.dataset.kill });
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
    compact.textContent = state.settings.compact ? "All" : "Next 3";
    compact.setAttribute("aria-pressed", String(state.settings.compact));
  }
}

function visibleTimers() {
  const now = DateTime.now();
  const pinned = ordered(
    state.timers.filter((timer) => timer.overlay),
    now,
    state.settings.timeZone,
    "all",
  );
  return state.settings.compact ? pinned.slice(0, 3) : pinned;
}

function render(): void {
  if (!rows) return;
  const now = DateTime.now();
  const timers = visibleTimers();
  listKey = `${state.settings.compact}:${timers.map((timer) => timer.id).join("|")}`;
  if (timers.length === 0) {
    rows.innerHTML = `<p class="empty">No timers on the overlay.</p>`;
    return;
  }
  const extra = state.settings.compact
    ? state.timers.filter((timer) => timer.overlay).length - timers.length
    : 0;
  rows.innerHTML =
    timers
      .map((timer) => {
        const view = present(timer, now, state.settings.timeZone);
        const detail = view.phase === "upcoming" ? view.when : labelFor(view.phase);
        const kill = view.canKill
          ? `<button type="button" class="kill" data-kill="${esc(view.id)}" ${state.settings.clickThrough ? "disabled" : ""}>Killed</button>`
          : "";
        return `<article class="overlay-row" data-id="${esc(view.id)}" data-category="${view.category}" data-phase="${view.phase}">
          <div data-tauri-drag-region>
            <h2 data-tauri-drag-region title="${esc(view.name)}">${esc(view.name)}</h2>
            <p data-tauri-drag-region data-detail>${esc(detail)}</p>
          </div>
          <div class="when">
            <strong class="count" data-tauri-drag-region data-count data-phase="${view.phase}" data-soon="${view.soon}">${esc(view.countdown)}</strong>
            ${kill}
          </div>
        </article>`;
      })
      .join("") + (extra > 0 ? `<p class="panel-note">${extra} more hidden by compact.</p>` : "");
}

function tick(): void {
  const now = DateTime.now();
  const server = now.setZone(state.settings.timeZone);
  const serverNode = document.querySelector("#clock-st");
  const localNode = document.querySelector("#clock-lt");
  if (serverNode) serverNode.textContent = server.isValid ? formatClock(server) : "Invalid";
  if (localNode) localNode.textContent = formatClock(now);
  const timers = visibleTimers();
  const key = `${state.settings.compact}:${timers.map((timer) => timer.id).join("|")}`;
  if (key !== listKey) {
    render();
    return;
  }
  if (!rows) return;
  for (const timer of timers) {
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
