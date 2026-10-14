import { DateTime } from "luxon";
import type { Timer, Weekday } from "./types.ts";

const DAY: Record<Weekday, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  7: "Sun",
};

export function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatClock(value: DateTime): string {
  return value.toFormat("HH:mm:ss");
}

export function formatWhen(value: DateTime): string {
  return value.toFormat("ccc HH:mm");
}

export function formatCountdown(ms: number): string {
  const total = Math.floor(Math.abs(ms) / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return days > 0 ? `${days}d ${clock}` : clock;
}

export function formatRule(timer: Timer): string {
  const schedule = timer.schedule;
  switch (schedule.kind) {
    case "hourly":
      return `Hourly at :${pad(schedule.minute)}`;
    case "every":
      return `Every ${schedule.hours}h from ${pad(schedule.anchorHour)}:${pad(schedule.anchorMinute)}`;
    case "daily":
      return `Daily at ${pad(schedule.hour)}:${pad(schedule.minute)}`;
    case "weekdays":
      return `${schedule.days.map((day) => DAY[day]).join(", ")} at ${pad(schedule.hour)}:${pad(schedule.minute)}`;
    case "utc": {
      const clock = `${pad(schedule.hour)}:${pad(schedule.minute)} UTC`;
      const everyDay = schedule.days.length === 0 || schedule.days.length === 7;
      return everyDay ? `Daily at ${clock}` : `${schedule.days.map((day) => DAY[day]).join(", ")} at ${clock}`;
    }
    case "windows":
      return schedule.windows
        .map(
          (slot) =>
            `${pad(slot.startHour)}:${pad(slot.startMinute)}–${pad(slot.endHour)}:${pad(slot.endMinute)}`,
        )
        .join(", ");
    case "once":
      return "Once";
    case "rolling":
      return timer.respawnIntervalMinutes
        ? `${timer.respawnIntervalMinutes} min after a kill`
        : "After a kill";
  }
}

export function categoryLabel(category: Timer["category"]): string {
  if (category === "pvp") return "PvP";
  return category[0].toUpperCase() + category.slice(1);
}
