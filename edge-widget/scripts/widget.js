const PORT = 47321;
const BASE = "http://127.0.0.1:" + PORT;
const HEADERS = { "X-Aion-Edge": "1" };

const board = document.querySelector("#board");
const hero = document.querySelector("#hero");
const rows = document.querySelector("#rows");
const note = document.querySelector("#note");
const empty = document.querySelector("#empty");
const emptyText = document.querySelector("#empty-text");
const status = document.querySelector("#status");
const clock = document.querySelector("#clock");
const mode = document.querySelector("#mode");
const refresh = document.querySelector("#refresh");
const rift = document.querySelector("#rift");
const kicker = document.querySelector("#kicker");

let started = false;
let pulling = false;
let locked = false;
let last = null;
let structureKey = "";

icueEvents = {
  onICUEInitialized: init,
  onDataUpdated: applyColors,
};

if (typeof iCUE_initialized !== "undefined" && iCUE_initialized) init();
window.addEventListener("load", () => {
  if (typeof iCUE_initialized === "undefined") init();
});

function init() {
  if (started) return;
  started = true;
  applyColors();
  document.querySelector(".shell")?.addEventListener("click", onClick);
  void pull();
  window.setInterval(() => void pull(), 1000);
}

function applyColors() {
  const root = document.documentElement;
  root.style.setProperty("--text-color", colorOf("textColor", "#E8EDF4"));
  root.style.setProperty("--accent-color", colorOf("accentColor", "#7DD8D8"));
  root.style.setProperty("--bg-color", colorOf("backgroundColor", "#000000"));
}

function colorOf(name, fallback) {
  const value = getIcueProperty(name);
  return typeof value === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? value : fallback;
}

function getIcueProperty(name) {
  if (typeof window !== "undefined" && Object.prototype.hasOwnProperty.call(window, name)) {
    const value = window[name];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  try {
    const value = Function('return typeof ' + name + ' !== "undefined" ? ' + name + ' : undefined')();
    if (value !== undefined && value !== null && value !== "") return value;
  } catch (error) {
    return undefined;
  }
  return undefined;
}

async function pull() {
  if (pulling) return;
  pulling = true;
  try {
    const response = await fetch(BASE + "/v1/overlay", { headers: HEADERS, cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    const data = await response.json();
    if (!data || data.ok !== true || !Array.isArray(data.rows)) {
      if (!last) showEmpty("Waiting for timers…");
      return;
    }
    last = data;
    showSnapshot(data, false);
  } catch (error) {
    if (last) showSnapshot(last, true);
    else showEmpty("Aion 2 Timers is not running, or iCUE blocked 127.0.0.1:" + PORT + ".");
  } finally {
    pulling = false;
  }
}

function showSnapshot(data, stale) {
  status.hidden = !stale;
  status.dataset.link = stale ? "stale" : "live";
  status.textContent = stale ? "App not reachable. Last timers." : "";
  clock.textContent = data.clock || "--:--:--";
  mode.textContent = data.listLabel || "All";
  mode.setAttribute("aria-pressed", String(data.overlayList !== "all"));
  if (rift) rift.setAttribute("aria-pressed", String(data.rift === true));
  if (kicker) kicker.textContent = data.rift ? "Yustiel" : "Aion 2";
  if (refresh) {
    const busy = data.refreshing === true;
    refresh.textContent = busy ? "…" : "Refresh";
    refresh.disabled = busy;
    refresh.setAttribute("aria-busy", String(busy));
  }
  if (!data.rows.length) {
    board.hidden = true;
    empty.hidden = false;
    emptyText.textContent = data.empty || "No timers on the overlay.";
    structureKey = "";
    return;
  }
  empty.hidden = true;
  board.hidden = false;
  board.classList.toggle("solo", data.rows.length === 1);
  const key = data.rows.map((row) => [row.id, row.name, row.kind, row.canKill, row.canSee].join(":")).join("|");
  if (key !== structureKey) {
    structureKey = key;
    paintHero(data.rows[0]);
    rows.innerHTML = data.rows.slice(1).map(rowHtml).join("");
  }
  paintValues(data.rows);
  note.textContent = data.note || "";
  note.hidden = !data.note;
}

function showEmpty(text) {
  board.hidden = true;
  empty.hidden = false;
  status.hidden = true;
  emptyText.textContent = text;
  structureKey = "";
}

function paintHero(row) {
  hero.dataset.kind = row.kind;
  hero.innerHTML =
    '<p class="meta" data-detail></p>' +
    '<strong class="hero-name"></strong>' +
    '<div class="hero-count" data-count></div>' +
    '<div class="actions">' +
    (row.canKill ? '<button type="button" class="act" data-act="kill" data-id="' + esc(row.id) + '">Killed</button>' : "") +
    (row.canSee ? '<button type="button" class="act" data-act="seen" data-id="' + esc(row.id) + '">Seen</button>' : "") +
    "</div>";
  hero.querySelector(".hero-name").textContent = row.name;
}

function rowHtml(row) {
  return (
    '<article class="row" data-id="' + esc(row.id) + '" data-kind="' + esc(row.kind) + '">' +
    '<div><strong class="row-name"></strong><p class="meta" data-detail></p></div>' +
    '<div class="row-side"><div class="row-count" data-count></div>' +
    (row.canKill ? '<button type="button" class="act" data-act="kill" data-id="' + esc(row.id) + '">Killed</button>' : "") +
    (row.canSee ? '<button type="button" class="act" data-act="seen" data-id="' + esc(row.id) + '">Seen</button>' : "") +
    "</div></article>"
  );
}

function paintValues(items) {
  const heroRow = items[0];
  if (heroRow) fill(hero, heroRow);
  for (const item of items.slice(1)) {
    const node = rows.querySelector('[data-id="' + CSS.escape(item.id) + '"]');
    if (!node) continue;
    const name = node.querySelector(".row-name");
    if (name) name.textContent = item.name;
    fill(node, item);
  }
}

function fill(node, item) {
  const detail = node.querySelector("[data-detail]");
  const count = node.querySelector("[data-count]");
  if (detail) detail.textContent = kindLabel(item.kind) + " · " + (item.detail || "");
  if (count) {
    count.textContent = item.countdown || "—";
    count.dataset.phase = item.phase || "";
    count.dataset.soon = String(item.soon === true);
  }
}

function onClick(event) {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.id === "mode") {
    void act("list");
    return;
  }
  if (button.id === "refresh") {
    void act("bosses");
    return;
  }
  if (button.id === "rift") {
    void act("rift");
    return;
  }
  if (button.dataset.act && button.dataset.id) void act(button.dataset.act, button.dataset.id);
}

async function act(type, id) {
  if (locked) return;
  locked = true;
  try {
    const response = await fetch(BASE + "/v1/action", {
      method: "POST",
      headers: { ...HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify(id ? { type, id } : { type }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(String(response.status));
    await pull();
  } catch (error) {
    if (last) showSnapshot(last, true);
  } finally {
    window.setTimeout(() => {
      locked = false;
    }, 400);
  }
}

function kindLabel(kind) {
  if (kind === "pvp") return "PvP";
  if (kind === "field") return "Field";
  return kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : "";
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}
