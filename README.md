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
7. Click that bell icon to open the popup, then click **Test alert**. You
   should immediately hear the alarm and see a Windows notification — this
   confirms the extension is working *before* you even join a Meet call.
8. Join any `meet.google.com` call. Open the popup again — the **Chat** and
   **Captions** status cards should switch to "Watching" (green dot) once
   you open the chat panel / turn on captions (press `c` in Meet).

**After editing any file:** go back to `chrome://extensions` and click the
circular refresh icon on the extension's card, then reload the Meet tab.
Chrome does not hot-reload extension code automatically.

## Project structure

```
manifest.json       MV3 manifest — permissions, content script, popup, icons
content.js          Primary brain: DOM monitoring, keyword scoring, alerts
                     (runs inside the Meet tab; owns all monitoring state)
background.js       Service worker: desktop notifications + offscreen audio
offscreen.html/js    Hidden document that plays alarm.wav (service workers
                     can't use the Audio API directly)
popup.html/css/js    Extension popup UI (toggle, sensitivity, keywords, log)
styles.css           Styles injected into meet.google.com (alert overlay,
                     "enable captions/chat" prompts)
alarm.wav            Synthesized alarm tone
icons/               Toolbar icons (normal + red "alert" variant)
tools/               Python scripts that generated icons/ and alarm.wav
                     (dev-only, isolated venv — see below)
```

## Using it

Click the extension icon to open the popup:

- **Master toggle** — pause/resume monitoring entirely
- **Chat / Captions status cards** — show whether each source is currently
  being watched in the active Meet tab (captions require you to press `c`
  in Meet to turn them on)
- **Sensitivity** — Low / Normal / High. Low = fewer false alarms, needs a
  stronger match. High = catches weaker signals, more prone to false
  positives.
- **My Keywords** — add your name / roll number; any exact word-boundary
  match scores as a strong signal
- **Detection Log** — last 100 detections (chat or voice), newest first.
  Greyed-out entries were suppressed by the 30-second alert cooldown but are
  still logged for your own reference.
- **Test alert** — fires the full alert chain (sound, notification, overlay,
  title flash) on demand, without needing a real roll-call, so you can
  confirm your speakers/notification settings work before you actually need
  it.

## How detection works

- **Chat**: every new chat message is scored against a set of weighted
  regex rules (e.g. "roll number" = 1.0, "attendance" = 0.9, bare "present"
  = 0.5 with a negative lookahead so "presentation" doesn't match) plus your
  custom keywords. Chat needs a total score ≥ 0.7 (× sensitivity).
- **Captions**: live captions update word-by-word in the same DOM node, so
  the extension buffers text and waits for 2 seconds of silence before
  scoring the full utterance (avoids scoring partial words). Captions need
  a score ≥ 1.0 (× sensitivity) since speech-to-text is noisier than typed
  text.
- **Cooldown**: once an alert fires, further detections are logged but
  suppressed for 30 seconds, so one roll-call doesn't spam four alerts.
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

## Manual verification checklist

1. Load unpacked (see above), join a Meet call
2. Open chat, type "please mark your attendance" → sound + notification +
   red banner + flashing tab title should all fire within ~1s
3. Enable captions (press `c`), say "roll number" out loud → same alert
   after ~2s of silence
4. Say something unrelated ("let's roll with this presentation") → should
   **not** trigger (word-boundary/lookahead rules filter these out)
5. Toggle monitoring off in the popup → further messages should not alert
6. Click **Test alert** in the popup with the Meet tab in the background →
   confirm the notification still reaches you
7. Switch your OS theme light/dark → popup should re-theme automatically

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
   - Notification fires but no sound? Check your system volume and that no
     other app has exclusive audio control.
3. **Test alert works, but real detection doesn't fire in a Meet call?**
   Open the popup while in the call and check the **Chat**/**Captions**
   status cards:
   - "Open chat panel" / "Enable in Meet" → the extension can't find that
     panel yet. Open the chat sidebar, or press `c` to enable captions.
     After ~30s of not finding it, an in-meeting banner also prompts for
     this automatically.
   - Both say "Watching" but a real roll-call still doesn't alert → check
     the **Detection Log** in the popup. If your message *is* logged but
     greyed out, it was suppressed by the 30-second cooldown (a previous
     alert already fired recently) — that's working as intended, not a bug.
     If it's not logged at all, the phrase likely scored below the
     threshold; lower sensitivity to **High** or add the exact phrase your
     class uses as a custom keyword.
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
