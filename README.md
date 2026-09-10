# Meet Attendance Tracker

A Manifest V3 Chrome extension that watches Google Meet chat and live captions
for attendance roll-calls ("mark your attendance", "roll number", "say
present", etc.) and fires a loud, hard-to-miss alert (sound + desktop
notification + in-page banner + flashing tab title) so you don't miss one
while multitasking.

Pure vanilla JS/HTML/CSS — **no build step, no npm dependencies** for the
extension itself. A small Python toolchain (isolated in its own venv) is
included only to regenerate the icon images and alarm sound; you never need
it to actually run the extension.

> **There is no server.** This is a Chrome extension, not a web app — there
> is nothing to `npm start`, nothing to run on `localhost`, no backend of any
> kind. Chrome itself runs `content.js` and `background.js` directly, the
> instant you load the folder via `chrome://extensions`. If you're not
> seeing alerts, 9 times out of 10 it's because that loading step below
> hasn't happened yet — see [Troubleshooting](#troubleshooting-no-alerts-firing).

## How to run this (step-by-step)

1. Open a Chrome tab and go to `chrome://extensions`
2. Turn on **Developer mode** — toggle in the top-right corner
3. Click **Load unpacked** (top-left)
4. In the file picker, select this whole folder:
   `E:\vatsal\Gmeet-attendance-tracker-extension`
   (select the folder itself, not an individual file)
5. "Meet Attendance Tracker" now appears as a card on the extensions page —
   that means it's running. There's no separate "start" command; it stays
   active in the background from this point on, in every Chrome window,
   until you remove it or click the card's "Off" toggle.
6. Click the puzzle-piece icon in Chrome's toolbar → click the pin next to
   "Meet Attendance Tracker" so its bell icon stays visible in the toolbar.
7. Click that bell icon to open the popup. The first time, you'll see a
   short welcome screen with the setup steps; click **Get started**. Then
   click **Test alert**. You should immediately hear the alarm and see a
   desktop notification, which confirms the extension works *before* you
   even join a Meet call.
8. Join any `meet.google.com` call. Open the popup again — the **Chat** and
   **Captions** status cards should switch to "Watching" (green dot) once
   you open the chat panel / turn on captions (press `c` in Meet).

**After editing any file:** go back to `chrome://extensions` and click the
circular refresh icon on the extension's card, then reload the Meet tab.
Chrome does not hot-reload extension code automatically.

## Project structure

```
manifest.json       MV3 manifest — permissions, content script, popup, icons
content.js          Primary brain: DOM monitoring, keyword scoring, real-time
                     aggregate alert pipeline (runs inside the Meet tab; owns
                     all monitoring state)
background.js       Service worker: desktop notifications + offscreen audio
offscreen.html/js    Hidden document that plays alarm.wav (service workers
                     can't use the Audio API directly)
popup.html/css/js    Extension popup: first-run welcome screen, on/off
                     switch, chat/captions status, recent detections, test
                     alert
options.html/css/js  Settings page (opens in its own tab): sensitivity,
                     keywords, which alerts fire, alarm volume, quiet time,
                     alert threshold. Same storage as the popup.
theme.css            Colors, switch, button and keyword chip styles shared
                     by the popup and settings page. No remote fonts.
keywords.js          Keyword add/dedupe/chip helpers shared by the popup
                     and settings page
styles.css           Styles injected into meet.google.com (alert overlay,
                     "enable captions/chat" prompts)
alarm.wav            Synthesized alarm tone
icons/               Toolbar icons (normal + red "alert" variant)
tools/               Python scripts that generated icons/ and alarm.wav
                     (dev-only, isolated venv — see below)
```

## Using it

Click the extension icon to open the popup:

- **On/off switch** pauses or resumes monitoring.
- **Chat / Captions cards** show whether each one is being watched in the
  current Meet tab. Captions only work after you press `c` in Meet.
- **Your keywords** lets you add or remove your name, roll number or a
  phrase your teacher always uses, right from the popup.
- **Recent detections** lists the last 100 things the tracker noticed,
  newest first. Greyed-out entries didn't set off an alert, either because
  the quiet time after an earlier alert was still running or because the
  combined score hadn't reached your alert threshold.
- **Test alert** runs every alert you have turned on, so you can check your
  speakers and notifications before class.
- **Settings** opens [options.html](options.html) in its own tab.

The settings page has:

- **Sensitivity** (Low / Normal / High). Low means fewer false alarms, High
  catches weaker signals.
- **Your keywords**, like your name or roll number. An exact word match
  counts as a strong signal. There are one-click suggestions too.
- **Alerts**: turn the alarm sound, desktop notification, Meet banner and
  flashing tab title on or off separately, upload your own alarm tone (any
  audio clip up to 30 seconds and 3 MB, kept in local storage), set the
  alarm volume, and pick
  how long the tracker stays quiet after an alert (15 seconds to 2 minutes,
  30 seconds by default).
- **Alert threshold**: how high the combined score has to get before an
  alert goes off (2.5 by default).

Everything is stored locally in `chrome.storage.local`. Nothing leaves your
computer.

## How detection works

Individual messages no longer fire an alert by themselves — this changed
after real classroom testing showed that a single ambiguous phrase (or one
ambiguous keyword hit) was too eager. Detection is now two layers:

1. **Per-message scoring** (mostly unchanged) — each new chat message or
   finalized caption utterance is scored against weighted regex rules (e.g.
   "roll number" = 1.0, "attendance" = 0.9, bare "present" = 0.5 with a
   negative lookahead so "presentation" doesn't match) plus your custom
   keywords. This score only has to clear a low floor (0.7 for chat, 1.0
   for captions, × sensitivity) to be considered "worth paying attention
   to" — it does **not** fire an alert on its own anymore.
2. **Real-time combined score** — every qualifying detection from *both*
   chat and captions feeds into one rolling score covering the last 5
   seconds. The alarm fires only once that combined score crosses your
   **alert threshold** (set via the slider on the options page, default
   2.5). This is what lets two moderate, related signals arriving close
   together (e.g. a caption mentioning "attendance" plus a chat message
   about "roll number") trigger together, while a single throwaway mention
   of "present" alone does not.

There's also a dedicated **presence-burst detector**: a short, whole-message
chat reply like "3 present" or "here" (anchored so it can't match inside an
unrelated sentence) scores too low to qualify on its own — real classrooms
generate a *lot* of these in a row during an actual roll call. Each new one
extends an ongoing streak as long as it arrives within 5 seconds of the
previous one (so 13 students typing one after another over 40 seconds still
counts as one continuous burst — a fixed "last 5 seconds" window couldn't
catch that). Five in a row is treated as very strong evidence on its own and
injects a large score bump into the combined total above, regardless of what
each individual message scored.

- **Quiet time**: once an alert fires, further detections are logged but
  don't alert again until the quiet time you picked in Settings runs out
  (30 seconds by default), so one roll call doesn't set off four alarms. The
  combined score also resets after firing.
- **Repeats count**: every new chat message is scored, even when it has the
  same text as an earlier one, so five students typing "present" is five
  check-ins. Messages already on screen when the tracker attaches (say,
  after you reopen the chat panel) are skipped. For captions, only speech
  that's new since the last check is scored, so lines Meet keeps on screen
  aren't counted twice. Run `tools/detection-check.html` (see below) after
  changing any of this.
- **Resilient selectors**: Google Meet's class names are obfuscated and
  change often, so the DOM lookup cascades through `aria-label` → ARIA
  `role` → structural fallbacks, and re-attaches automatically if you open
  or close the chat/captions panel mid-call.

## Regenerating icons / alarm sound (optional, dev-only)

You will not normally need this — the generated files are already checked
into `icons/` and `alarm.wav`. If you want to tweak their design, the
scripts live in `tools/` with their own isolated virtual environment (kept
out of your global Python and out of git via `.gitignore`).

**One-time setup:**

```bash
cd E:\vatsal\Gmeet-attendance-tracker-extension
python -m venv tools/.venv
tools\.venv\Scripts\pip install -r tools\requirements.txt
```

**Regenerate assets:**

```bash
tools\.venv\Scripts\python tools\generate_icons.py
tools\.venv\Scripts\python tools\generate_alarm.py
```

(On macOS/Linux, replace `tools\.venv\Scripts\` with `tools/.venv/bin/`.)

## Automated detection check (dev-only)

`tools/detection-check.html` loads the real `content.js` into a fake Meet
call and checks that chat messages and captions are each counted once,
including repeats. Drag the file into a Chrome tab and wait about 15
seconds: the tab title turns to PASS or FAIL, and every case is listed on
the page. It isn't part of the Web Store zip.

## Manual verification checklist

1. Load unpacked (see above), join a Meet call
2. Open chat, type "please mark your attendance" → scores 1.9, which is
   **below** the default 2.5 threshold, so it should log in the Detection
   Log (greyed out) but **not** alert by itself — this is intentional, not
   a bug
3. Immediately send a second related message (e.g. "roll number please") →
   combined score should now cross 2.5 and the full alert chain (sound,
   notification, red banner, flashing tab title) should fire within ~1s
4. Open the popup → **Settings** → drag the alert threshold slider
   down to ~1.5 → a single "mark your attendance" message should now alert
   on its own
5. Test the burst detector: send "1 present", "2 present", "3 present",
   "4 present", "5 present" as separate chat messages a second or two apart
   → the first four should be silent (individually too weak to even
   qualify), the fifth should immediately trigger a full alert
6. Say something unrelated ("let's roll with this presentation") → should
   **not** contribute meaningfully (word-boundary/lookahead rules filter
   these out)
7. Toggle monitoring off in the popup → further messages should not alert
8. Click **Test alert** in the popup with the Meet tab in the background →
   confirm the notification still reaches you
9. Switch your OS theme light/dark → popup and options page should both
   re-theme automatically
10. On the settings page, click a suggested keyword → it should appear
    under "Your keywords" and grey itself out
11. In Settings, turn off **Banner in Meet**, then click **Test alert** in
    the popup while on the Meet tab → sound and notification fire, no red
    banner. Set **Alarm volume** to 20% and test again → noticeably quieter
12. In Settings, click **Upload sound** and pick a short MP3 → its file name
    shows under "Alarm tone" and **Test sound and notification** plays it.
    Try a PDF or a clip over 30 seconds → you get an error and nothing is
    saved. **Use built-in** switches back to the default alarm

## Troubleshooting: no alerts firing

Work through these in order — each rules out one layer.

1. **Is it actually loaded?** Go to `chrome://extensions` and confirm a
   "Meet Attendance Tracker" card exists and its toggle is blue/on. If it's
   not there, you skipped [How to run this](#how-to-run-this-step-by-step) —
   there's no server or command that makes it appear on its own.
2. **Click Test alert first**, before anything Meet-related. Open the
   popup → **Test alert**. This bypasses all DOM/detection logic and
   directly exercises sound + notification, so it isolates whether the
   problem is "the extension's core plumbing is broken" vs. "it can't find
   the roll-call in Meet's chat/captions."
   - Still nothing? Click **"service worker"** on the extension's card in
     `chrome://extensions` to open its DevTools console, click **Test
     alert** again, and read the error printed there. Common causes:
     Windows Focus Assist / notification settings blocking Chrome, system
     volume muted, or (very old Chrome versions) a missing `offscreen` API —
     update Chrome if so.
   - Notification fires but no sound? In Settings, check that **Alarm
     sound** is on and **Alarm volume** isn't at 0%. Then check your system
     volume and that no other app has exclusive audio control.
   - No notification? Check that **Desktop notification** is on in Settings.
3. **Test alert works, but real detection doesn't fire in a Meet call?**
   Open the popup while in the call and check the **Chat**/**Captions**
   status cards:
   - "Open the chat panel" / "Press C in Meet" → the extension can't find
     that panel yet. Open the chat sidebar, or press `c` to turn on
     captions. After ~30s of not finding it, an in-meeting banner also
     prompts for this automatically.
   - Both say "Watching" but a real roll call still doesn't alert → check
     **Recent detections** in the popup. If your message *is* logged but
     greyed out, either the quiet time after an earlier alert was still
     running, or the combined score hasn't reached your **alert threshold**
     yet (in Settings). Both are working as intended, and a second related
     message usually pushes it over. If it's not logged at all, the phrase scored below the
     per-message floor; lower sensitivity to **High** or add the exact
     phrase your class uses as a custom keyword.
4. **Nothing above explains it** — Google Meet changes its DOM often enough
   that the selector cascade in `content.js` (`findChatContainer` /
   `findCaptionContainer`) can go stale. Open the Meet tab's own DevTools
   console (not the service worker's) and look for errors from
   `content.js`; that's the file to patch if Meet has changed its markup.

## Notes on tooling used to build this

- No JS dependencies were installed anywhere (system or project) — the
  extension is hand-written vanilla JS/HTML/CSS per the original design.
- Icon/alarm generation used Python + Pillow. Pillow now lives only inside
  `tools/.venv/`, not your global Python install.
- This folder is now a git repository (`git init` was run) but nothing has
  been committed yet — that's left for you to do when ready:
  ```bash
  git add .
  git commit -m "Initial commit: Meet Attendance Tracker extension"
  ```
