# Aion 2 Timers

Desktop timers for Aion 2 events, bosses, and your own field bosses. The overlay follows what you pin in the editor.

It does not read the game client, packets, or memory. V:0.1.7 by Kandera. Licensed under MIT.

## Install

Download the Windows setup from the [latest release](https://github.com/Kandera/aion2-timers/releases/latest). It installs for the current user, no admin prompt.

Settings → Updates checks GitHub for a newer signed setup. When one is available, the app shows a dialog, then installs it and restarts.

Timers, pins, and settings are stored in an app data file, so an update does not clear them.

## 0.1.7

- Argo, the Spirit King in the Abyss is a field boss. A down report shows a timer. Fixed world bosses stay on their own timers.

## 0.1.6

- The Edge widget Refresh button pulls field bosses, the same as Settings.

## 0.1.5

- XENEON EDGE widget uses the same pins as the overlay. Killed, Seen, and All, Next 3, Soon write back.
- Import aion-2-timers.icuewidget from the release. Medium replaces the weather tile. Large spans the two right tiles.

## 0.1.4

- Field bosses start off. Turn on overlay or alarm for the ones you want. That choice stays.
- Filters split World bosses and Field bosses. Settings, Catalog, Altgard or Verteron hides the other faction.
- Fixed world bosses stay on their own timers.
- Refresh shows Updating, then Current and the last updated time. Field bosses can refresh every few minutes.
- Also alert when it starts. Drag the overlay from the whole header. The All button stays a button.

## 0.1.3

- Settings, Catalog, Refresh field bosses loads the public EU Marchutan report. Interval, pin, and alarm stay.
- A boss reported up keeps its last spawn time.

## 0.1.2

- Timers, pins, and settings stay in an app data file across updates.
- An available update opens a dialog. Install and restart, or later.

## Use

Paste spawn reads `Gartua 00:34`, `Immortal Gartua Spawns at 6:43 PM`, or a copied timer row. Loot text and a Korean name on the same line are ignored. The clock after `Spawns in` is used, in the server zone. A matching field boss keeps its interval.

Export and import stay in the code, hidden in the window. Field bosses start off. Turn on overlay or alarm for the ones you want. That choice stays across updates.

The overlay button cycles All, Next 3, and Soon. It fades when nothing is soon, and comes back under the pointer. Click-through stays visible. Pick the monitor under Settings → Overlay.

Each timer can have its own tone, and a second alert when it starts. Quiet hours mute the sound. The row stays. Seen skips one clock time. Killed still rolls an interval.

Each row shows the next three times.

Settings → Catalog pulls `catalog.json` from this repo, so a schedule fix lands without a new setup. Pins, alarms, notes, and your own timers stay.

Close the editor window to keep the overlay and alarms in the tray. Quit from the tray icon.

## XENEON EDGE

`edge-widget/` is an iCUE widget for the CORSAIR XENEON EDGE. It shows the same pinned timers as the overlay. Killed, Seen, and All / Next 3 / Soon write back to the app. Refresh pulls field bosses, the same as Settings.

The app listens on `127.0.0.1:47321` while it is running, including from the tray. iCUE asks to allow that address on import. Approve it. A website cannot read the list: the bridge rejects public web origins.

Place the widget as Medium to replace the weather tile, or Large to span the two right tiles. iCUE 5.47 or newer.

Import aion-2-timers.icuewidget from the release. In iCUE, Widgets, +. Regenerate it with:

```
npx --yes icuewidget-cli package edge-widget
```

## Develop

```
npm install
npm test
npm run tauri dev
```
