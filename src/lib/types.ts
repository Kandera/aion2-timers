export type Category = "event" | "boss" | "pvp" | "system";

/** ISO weekday: Monday = 1, Sunday = 7. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type WindowSlot = {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
};

export type Schedule =
  | { kind: "hourly"; minute: number }
  | { kind: "every"; hours: number; anchorHour: number; anchorMinute: number }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekdays"; days: Weekday[]; hour: number; minute: number }
  | { kind: "windows"; windows: WindowSlot[] }
  | { kind: "utc"; hour: number; minute: number; days: Weekday[] }
  | { kind: "once"; at: string }
  | { kind: "rolling" };

export type Timer = {
  id: string;
  name: string;
  category: Category;
  schedule: Schedule;
  /** Open window after start, in minutes. 0 = a point in time. Ignored for window schedules. */
  durationMinutes: number;
  /** First minutes of a window shown as entry. 0 = the whole window is live. */
  entryMinutes: number;
  overlay: boolean;
  alarm: boolean;
  leadMinutes: number;
  seeded: boolean;
  customized: boolean;
  /** Set only when a witnessed kill should roll the next spawn. */
  respawnIntervalMinutes: number | null;
  /** Absolute next spawn for rolling timers. Null until set. */
  nextAt: string | null;
  note: string;
};

export type CatalogSeed = {
  id: string;
  name: string;
  category: Category;
  schedule: Schedule;
  durationMinutes: number;
  entryMinutes: number;
  note: string;
};

export type Settings = {
  timeZone: string;
  defaultLeadMinutes: number;
  alarmTone: 1 | 2 | 3;
  alarmVolume: number;
  hotkey: string;
  opacity: number;
  scale: number;
  clickThrough: boolean;
  alwaysOnTop: boolean;
  compact: boolean;
  overlayHours: number;
  overlayVisible: boolean;
  overlayX: number | null;
  overlayY: number | null;
  overlayWidth: number;
  overlayHeight: number;
};

export type AppState = {
  settings: Settings;
  timers: Timer[];
  alerted: string[];
};
