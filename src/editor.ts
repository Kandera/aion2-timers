import { DateTime } from "luxon";
import { catalog } from "./lib/catalog.ts";
import { esc } from "./lib/html.ts";
import type { Category, Schedule, Timer, Weekday, WindowSlot } from "./lib/types.ts";

const DAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];
const DAY_NAME = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type EditorHandlers = {
  zone: () => string;
  onSave: (timer: Timer) => void;
  onDelete: (id: string) => void;
  onReset: (id: string) => void;
};

export function bindEditor(dialog: HTMLDialogElement, handlers: EditorHandlers): {
  open: (timer: Timer | null, defaultLead: number) => void;
} {
  return {
    open(timer, defaultLead) {
      const zone = handlers.zone();
      dialog.innerHTML = markup(timer, defaultLead, zone);
      const form = dialog.querySelector("form");
      if (!form) return;
      form.dataset.rule = ruleOf(timer);
      form.addEventListener("change", (event) => {
        const target = event.target;
        if (target instanceof HTMLSelectElement && target.name === "rule") {
          form.dataset.rule = target.value;
        }
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const read = readTimer(form, timer, handlers.zone());
        const error = dialog.querySelector("#editor-error");
        if ("error" in read) {
          if (error) error.textContent = read.error;
          return;
        }
        handlers.onSave(read.timer);
        dialog.close();
      });
      dialog.querySelector("[data-cancel]")?.addEventListener("click", () => dialog.close());
      dialog.querySelector("[data-delete]")?.addEventListener("click", () => {
        if (!timer) return;
        const button = dialog.querySelector("[data-delete]");
        if (!(button instanceof HTMLButtonElement)) return;
        if (button.dataset.confirm !== "yes") {
          button.dataset.confirm = "yes";
          button.textContent = "Delete timer";
          return;
        }
        handlers.onDelete(timer.id);
        dialog.close();
      });
      dialog.querySelector("[data-reset]")?.addEventListener("click", () => {
        if (!timer) return;
        handlers.onReset(timer.id);
        dialog.close();
      });
      dialog.showModal();
      dialog.querySelector<HTMLInputElement>("[name=name]")?.focus();
    },
  };
}

function markup(timer: Timer | null, defaultLead: number, zone: string): string {
  const rule = ruleOf(timer);
  const schedule = timer?.schedule;
  const days = schedule?.kind === "weekdays" || schedule?.kind === "utc" ? schedule.days : [1, 4, 6];
  const hour = hourOf(timer);
  const minute = minuteOf(timer);
  const windows = schedule?.kind === "windows" ? schedule.windows : [];
  return `<form class="editor-form" data-rule="${rule}">
    <header class="editor-head">
      <h2>${timer ? "Edit timer" : "Add timer"}</h2>
      <p>${timer?.seeded ? "Saving overrides the catalog entry." : "Custom timers stay on this PC."}</p>
    </header>
    <label class="field">Name
      <input name="name" required maxlength="64" value="${esc(timer?.name ?? "")}" />
    </label>
    <div class="split">
      <label class="field">Category
        <select name="category">
          ${options(
            [
              ["event", "Event"],
              ["boss", "Boss"],
              ["pvp", "PvP"],
              ["system", "System"],
            ],
            timer?.category ?? "boss",
          )}
        </select>
      </label>
      <label class="field">Rule
        <select name="rule">
          ${ruleOptions(rule)}
        </select>
      </label>
    </div>
    <div class="split" data-for="hourly">
      <label class="field">Minute
        <input name="hourlyMinute" type="number" min="0" max="59" value="${schedule?.kind === "hourly" ? schedule.minute : 0}" />
      </label>
    </div>
    <div class="split" data-for="every">
      <label class="field">Every hours
        <input name="everyHours" type="number" min="1" max="24" value="${schedule?.kind === "every" ? schedule.hours : 3}" />
      </label>
      <label class="field">From hour
        <input name="anchorHour" type="number" min="0" max="23" value="${schedule?.kind === "every" ? schedule.anchorHour : 1}" />
      </label>
      <label class="field">From minute
        <input name="anchorMinute" type="number" min="0" max="59" value="${schedule?.kind === "every" ? schedule.anchorMinute : 0}" />
      </label>
    </div>
    <fieldset class="days" data-for="weekdays utc">
      <legend>Days</legend>
      ${DAYS.map(
        (day) =>
          `<label><input type="checkbox" name="days" value="${day}" ${days.includes(day) ? "checked" : ""} /> ${DAY_NAME[day]}</label>`,
      ).join("")}
    </fieldset>
    <div class="split" data-for="weekdays daily utc">
      <label class="field">Hour
        <input name="hour" type="number" min="0" max="23" value="${hour}" />
      </label>
      <label class="field">Minute
        <input name="minute" type="number" min="0" max="59" value="${minute}" />
      </label>
    </div>
    <label class="field" data-for="once">Once, server time
      <input name="once" type="datetime-local" value="${localInput(schedule?.kind === "once" ? schedule.at : null, zone)}" />
    </label>
    <p class="hint" data-for="windows">${windows.map(windowText).join(" · ") || "Daily windows"}</p>
    <p class="hint" data-for="utc">Hours are UTC, not server time. 07:00 UTC is 09:00 in summer and 08:00 after 25 October.</p>
    <div class="split" data-for="hourly every weekdays daily once rolling">
      <label class="field">Open for minutes
        <input name="duration" type="number" min="0" max="1440" value="${timer?.durationMinutes ?? 0}" />
      </label>
      <label class="field">Entry minutes
        <input name="entry" type="number" min="0" max="1440" value="${timer?.entryMinutes ?? 0}" />
      </label>
    </div>
    <div class="split" data-for="rolling">
      <label class="field">Respawn minutes
        <input name="respawn" type="number" min="1" max="10080" value="${timer?.respawnIntervalMinutes ?? ""}" />
      </label>
      <label class="field">Next spawn, server time
        <input name="nextAt" type="datetime-local" value="${localInput(timer?.nextAt ?? null, zone)}" />
      </label>
    </div>
    <label class="field">Note
      <input name="note" maxlength="120" value="${esc(timer?.note ?? "")}" />
    </label>
    <div class="split checks">
      <label><input name="overlay" type="checkbox" ${timer?.overlay ?? true ? "checked" : ""} /> Show on overlay</label>
      <label><input name="alarm" type="checkbox" ${timer?.alarm ?? true ? "checked" : ""} /> Alarm</label>
      <label><input name="alarmOnStart" type="checkbox" ${timer?.alarmOnStart !== false ? "checked" : ""} /> Also when it starts</label>
      <label class="field">Lead minutes
        <input name="lead" type="number" min="0" max="180" value="${timer?.leadMinutes ?? defaultLead}" />
      </label>
      <label class="field">Tone
        <select name="tone">
          ${options(
            [
              ["", "Default"],
              ["1", "Chime"],
              ["2", "Pulse"],
              ["3", "Bell"],
            ],
            timer?.alarmTone == null ? "" : String(timer.alarmTone),
          )}
        </select>
      </label>
    </div>
    <p class="hint">Lead 0 does not notify before the start. Killed rolls an interval. Seen skips this clock time.</p>
    <p id="editor-error" class="error" role="alert"></p>
    <footer class="editor-actions">
      ${timer?.seeded ? `<button type="button" data-reset>Reset to catalog</button>` : ""}
      ${timer && !timer.seeded && timer.id !== "new" ? `<button type="button" data-delete class="danger">Delete</button>` : ""}
      <span class="spacer"></span>
      <button type="button" data-cancel>Cancel</button>
      <button type="submit" class="primary">Save timer</button>
    </footer>
  </form>`;
}

function readTimer(
  form: HTMLFormElement,
  original: Timer | null,
  zone: string,
): { timer: Timer } | { error: string } {
  const data = new FormData(form);
  const name = String(data.get("name") ?? "").trim();
  if (!name) return { error: "Name is required." };
  const category = String(data.get("category") ?? "boss") as Category;
  const rule = String(data.get("rule") ?? "rolling");
  const lead = numberValue(data, "lead");
  const duration = numberValue(data, "duration");
  const entry = numberValue(data, "entry");
  if (!Number.isInteger(lead) || lead < 0) return { error: "Lead minutes must be 0 or more." };
  if (!Number.isInteger(duration) || duration < 0) return { error: "Open minutes must be 0 or more." };
  if (!Number.isInteger(entry) || entry < 0) return { error: "Entry minutes must be 0 or more." };
  if (duration > 0 && entry > duration) return { error: "Entry is longer than the open window." };

  const built = buildSchedule(rule, data, original, zone);
  if ("error" in built) return built;

  const id = original && original.id !== "new" ? original.id : `custom-${crypto.randomUUID()}`;
  const tone = String(data.get("tone") ?? "");
  const timer: Timer = {
    id,
    name,
    category,
    schedule: built.schedule,
    durationMinutes: rule === "windows" ? 0 : duration,
    entryMinutes: rule === "windows" ? 0 : entry,
    overlay: data.get("overlay") === "on",
    alarm: data.get("alarm") === "on",
    leadMinutes: lead,
    seeded: original?.seeded ?? false,
    customized: false,
    respawnIntervalMinutes: built.respawn,
    nextAt: built.nextAt,
    alarmTone: tone === "1" ? 1 : tone === "2" ? 2 : tone === "3" ? 3 : null,
    alarmOnStart: data.get("alarmOnStart") === "on",
    seenUntil: original?.seenUntil ?? null,
    note: String(data.get("note") ?? "").trim(),
  };
  timer.customized = differsFromCatalog(timer);
  return { timer };
}

function buildSchedule(
  rule: string,
  data: FormData,
  original: Timer | null,
  zone: string,
): { schedule: Schedule; respawn: number | null; nextAt: string | null } | { error: string } {
  if (rule === "hourly") {
    const minute = numberValue(data, "hourlyMinute");
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) return { error: "Minute must be 0–59." };
    return { schedule: { kind: "hourly", minute }, respawn: null, nextAt: null };
  }
  if (rule === "every") {
    const hours = numberValue(data, "everyHours");
    const anchorHour = numberValue(data, "anchorHour");
    const anchorMinute = numberValue(data, "anchorMinute");
    if (!Number.isInteger(hours) || hours < 1 || hours > 24) return { error: "Interval must be 1–24 hours." };
    if (!clockOk(anchorHour, anchorMinute)) return { error: "Anchor time is invalid." };
    return { schedule: { kind: "every", hours, anchorHour, anchorMinute }, respawn: null, nextAt: null };
  }
  if (rule === "daily") {
    const hour = numberValue(data, "hour");
    const minute = numberValue(data, "minute");
    if (!clockOk(hour, minute)) return { error: "Time is invalid." };
    return { schedule: { kind: "daily", hour, minute }, respawn: null, nextAt: null };
  }
  if (rule === "weekdays" || rule === "utc") {
    const hour = numberValue(data, "hour");
    const minute = numberValue(data, "minute");
    const days = data
      .getAll("days")
      .map((value) => Number(value))
      .filter((day): day is Weekday => DAYS.includes(day as Weekday));
    if (days.length === 0) return { error: "Pick at least one day." };
    if (!clockOk(hour, minute)) return { error: "Time is invalid." };
    return rule === "utc"
      ? { schedule: { kind: "utc", hour, minute, days }, respawn: null, nextAt: null }
      : { schedule: { kind: "weekdays", days, hour, minute }, respawn: null, nextAt: null };
  }
  if (rule === "once") {
    const at = toUtc(String(data.get("once") ?? ""), zone);
    if (!at) return { error: "Once needs a server time." };
    return { schedule: { kind: "once", at }, respawn: null, nextAt: null };
  }
  if (rule === "windows" && original?.schedule.kind === "windows") {
    return { schedule: original.schedule, respawn: null, nextAt: null };
  }
  const respawn = numberValue(data, "respawn");
  if (!Number.isInteger(respawn) || respawn < 1) return { error: "Respawn minutes are required." };
  const nextRaw = String(data.get("nextAt") ?? "");
  const nextAt = nextRaw ? toUtc(nextRaw, zone) : null;
  if (nextRaw && !nextAt) return { error: "Next spawn is not a valid server time." };
  return { schedule: { kind: "rolling" }, respawn, nextAt };
}

function differsFromCatalog(timer: Timer): boolean {
  if (!timer.seeded) return false;
  const seed = catalog().find((item) => item.id === timer.id);
  if (!seed) return true;
  return (
    seed.name !== timer.name ||
    seed.category !== timer.category ||
    seed.durationMinutes !== timer.durationMinutes ||
    seed.entryMinutes !== timer.entryMinutes ||
    seed.respawnIntervalMinutes !== timer.respawnIntervalMinutes ||
    seed.note !== timer.note ||
    JSON.stringify(seed.schedule) !== JSON.stringify(timer.schedule)
  );
}

function ruleOf(timer: Timer | null): string {
  return timer?.schedule.kind ?? "rolling";
}

function hourOf(timer: Timer | null): number {
  const schedule = timer?.schedule;
  if (!schedule) return 21;
  if (schedule.kind === "daily" || schedule.kind === "weekdays" || schedule.kind === "utc") return schedule.hour;
  return 21;
}

function minuteOf(timer: Timer | null): number {
  const schedule = timer?.schedule;
  if (!schedule) return 0;
  if (schedule.kind === "daily" || schedule.kind === "weekdays" || schedule.kind === "utc") return schedule.minute;
  return 0;
}

function ruleOptions(selected: string): string {
  const rules: [string, string][] = [
    ["rolling", "After a kill"],
    ["hourly", "Hourly"],
    ["every", "Every N hours"],
    ["weekdays", "Weekdays"],
    ["daily", "Daily"],
    ["once", "Once"],
    ["utc", "UTC clock"],
  ];
  if (selected === "windows") rules.push(["windows", "Daily windows"]);
  return options(rules, selected);
}

function options(items: [string, string][], selected: string): string {
  return items
    .map(
      ([value, label]) =>
        `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`,
    )
    .join("");
}

function windowText(slot: WindowSlot): string {
  const start = `${String(slot.startHour).padStart(2, "0")}:${String(slot.startMinute).padStart(2, "0")}`;
  const end = `${String(slot.endHour).padStart(2, "0")}:${String(slot.endMinute).padStart(2, "0")}`;
  return `${start}–${end}`;
}

function localInput(iso: string | null, zone: string): string {
  if (!iso) return "";
  const value = DateTime.fromISO(iso).setZone(zone);
  return value.isValid ? value.toFormat("yyyy-MM-dd'T'HH:mm") : "";
}

function toUtc(value: string, zone: string): string | null {
  const parsed = DateTime.fromISO(value, { zone });
  return parsed.isValid ? parsed.toUTC().toISO() : null;
}

function numberValue(data: FormData, key: string): number {
  return Number(data.get(key));
}

function clockOk(hour: number, minute: number): boolean {
  return Number.isInteger(hour) && Number.isInteger(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}
