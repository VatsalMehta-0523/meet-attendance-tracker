// content.js — primary brain. Lives as long as the Meet tab is open, so all
// monitoring state lives here rather than in the ephemeral service worker.

(function () {
  if (window.__meetAttendanceTrackerLoaded) {
    console.log("[Meet Attendance Tracker] content script already loaded, skipping re-init");
    return;
  }
  window.__meetAttendanceTrackerLoaded = true;
  console.log("[Meet Attendance Tracker] content script loaded on", location.href);

  // ---------------------------------------------------------------------
  // Keyword rules (confidence scoring, not substring matching)
  // ---------------------------------------------------------------------

  const KEYWORD_RULES = [
    // High confidence
    { pattern: /\broll\s*(?:no|number|#|num)\b/i, score: 1.0, label: "roll number" },
    { pattern: /\broll\s*call\b/i, score: 1.0, label: "roll call" },
    { pattern: /\battendance\b/i, score: 0.9, label: "attendance" },
    { pattern: /\bmark\s+(?:your\s+)?(?:attendance|presence|present)\b/i, score: 1.0, label: "mark attendance" },
    { pattern: /\bsay\s+(?:here|present|yeah)\b/i, score: 0.8, label: "say here/present" },
    { pattern: /\btype\s*(?:your)?\s*(?:name|roll)\b/i, score: 0.9, label: "type your name/roll" },
    { pattern: /\bwho\s*(?:is|all)\s*(?:here|present)\b/i, score: 0.5, label: "who is present" },

    // Medium confidence — need corroboration from other signals
    { pattern: /\bpresent\b(?!\s*(?:ation|ing|ed|s|er|ly))/i, score: 0.5, label: "present (standalone)" },
    { pattern: /\bhere\b/i, score: 0.3, label: "here" },
    { pattern: /\broll\b(?!\s*(?:back|out|over|up|down|ing|ed|er))/i, score: 0.4, label: "roll (standalone)" },
    { pattern: /\babsent\b/i, score: 0.4, label: "absent" },

    // Contextual boosters (additive)
    { pattern: /\b(?:type|send|write|put)\s+(?:your|ur)\b/i, score: 0.3, label: "instruction to type" },
    { pattern: /\b\d{2,}\b/, score: 0.1, label: "contains number" },
  ];

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function evaluateText(text, source, settings) {
    let totalScore = 0;
    const matchedLabels = [];

    for (const rule of KEYWORD_RULES) {
      if (rule.pattern.test(text)) {
        totalScore += rule.score;
        matchedLabels.push(rule.label);
      }
    }

    for (const kw of settings.customKeywords || []) {
      if (!kw) continue;
      const escaped = escapeRegExp(kw);
      try {
        if (new RegExp("\\b" + escaped + "\\b", "i").test(text)) {
          totalScore += 1.0;
          matchedLabels.push("custom: " + kw);
        }
      } catch (e) {
        // ignore malformed keyword
      }
    }

    const sensitivityMultiplier = { low: 1.3, normal: 1.0, high: 0.7 }[settings.sensitivity] || 1.0;
    const baseThreshold = source === "chat" ? 0.7 : 1.0;
    const threshold = baseThreshold * sensitivityMultiplier;

    // "qualifies" is a noise floor, not an alert trigger: it decides whether
    // this single message is even worth feeding into the real-time combined
    // score below. Whether an alert actually fires is a separate decision
    // made by recordSignal() against the user's alertThreshold.
    return { qualifies: totalScore >= threshold, score: totalScore, labels: matchedLabels };
  }

  // A short, whole-message roll-call check-in — "3 present", "present",
  // "here", "23. Present!" — anchored so it doesn't match "present" inside
  // an unrelated sentence. Used by the burst detector below: a handful of
  // these arriving close together is one of the strongest possible signals
  // that a roll call is actively happening, even if no single message
  // scores high on its own.
  const SHORT_PRESENCE_PATTERN = /^[\s"'*]*(?:\d{1,4}|[a-z]{2,20})?[\s:.\-]{0,3}(?:present|here)[\s!.]*$/i;

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------

  const state = {
    inMeeting: false,
    meetingPollInterval: null,
    containerCheckInterval: null,

    chatContainer: null,
    chatObserver: null,
    bodyObserver: null,
    processedMessages: new Set(),
    chatNotFoundSince: null,
    chatPromptShown: false,

    captionContainer: null,
    captionObserver: null,
    captionBuffer: "",
    utteranceTimer: null,
    captionNotFoundSince: null,
    captionPromptShown: false,

    lastAlertTime: 0,

    // Real-time combined score: recent qualifying detections (chat and
    // captions together) within RAPID_WINDOW_MS of "now", summed. This is
    // what actually gets compared against alertThreshold — individual
    // messages no longer fire alerts on their own.
    recentEvents: [], // { time, score }
    aggregateScore: 0,

    // Presence-burst detector: counts consecutive short "N present"-style
    // chat messages as long as no gap between them exceeds RAPID_WINDOW_MS.
    burstCount: 0,
    burstLastEventTime: 0,

    originalTitle: null,
    titleFlashInterval: null,
    titleFlashStop: null,

    overlayElement: null,
    overlayTimeout: null,

    // Keep in sync with DEFAULTS in options.js.
    settings: {
      enabled: true,
      customKeywords: [],
      sensitivity: "normal",
      alertThreshold: 2.5,
      alertBanner: true,
      alertTitleFlash: true,
      cooldownSeconds: 30,
    },
  };

  const DETECTION_LOG_CAP = 100;

  // How recent evidence has to be to still count toward the combined score,
  // and the max gap allowed between consecutive presence-burst messages for
  // them to be considered the same ongoing roll call.
  const RAPID_WINDOW_MS = 5000;
  const PRESENCE_BURST_TRIGGER_COUNT = 5;
  // Comfortably clears the default alertThreshold on its own once the burst
  // is confirmed, regardless of whatever partial score already accumulated.
  const PRESENCE_BURST_SCORE_BONUS = 6.0;

  // ---------------------------------------------------------------------
  // Settings load + live sync
  // ---------------------------------------------------------------------

  function loadSettings(cb) {
    // state.settings doubles as the defaults for keys that were never saved.
    chrome.storage.local.get(state.settings, (result) => {
      Object.assign(state.settings, result);
      if (cb) cb();
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const key in changes) {
      if (key in state.settings && changes[key].newValue !== undefined) {
        state.settings[key] = changes[key].newValue;
      }
    }
  });

  // ---------------------------------------------------------------------
  // Meeting detection
  // ---------------------------------------------------------------------

  function isInMeeting() {
    const leaveBtn = document.querySelector(
      '[aria-label*="Leave call" i], [aria-label*="leave call" i]'
    );
    return !!leaveBtn;
  }

  function pollMeetingState() {
    const nowInMeeting = isInMeeting();
    if (nowInMeeting && !state.inMeeting) {
      onMeetingJoined();
    } else if (!nowInMeeting && state.inMeeting) {
      onMeetingLeft();
    }
  }

  function onMeetingJoined() {
    state.inMeeting = true;
    state.processedMessages.clear();
    state.chatNotFoundSince = Date.now();
    state.captionNotFoundSince = Date.now();
    state.chatPromptShown = false;
    state.captionPromptShown = false;
    state.recentEvents = [];
    state.aggregateScore = 0;
    state.burstCount = 0;
    state.burstLastEventTime = 0;

    attachChatObserver();
    attachCaptionObserver();
    attachBodyObserver();

    if (!state.containerCheckInterval) {
      state.containerCheckInterval = setInterval(recheckContainers, 5000);
    }
  }

  function onMeetingLeft() {
    state.inMeeting = false;
    teardownObservers();
    hideOverlay();
    stopTitleFlash();
    removePrompt("chat");
    removePrompt("caption");

    if (state.containerCheckInterval) {
      clearInterval(state.containerCheckInterval);
      state.containerCheckInterval = null;
    }
  }

  function teardownObservers() {
    if (state.chatObserver) {
      state.chatObserver.disconnect();
      state.chatObserver = null;
    }
    if (state.captionObserver) {
      state.captionObserver.disconnect();
      state.captionObserver = null;
    }
    if (state.bodyObserver) {
      state.bodyObserver.disconnect();
      state.bodyObserver = null;
    }
    if (state.utteranceTimer) {
      clearTimeout(state.utteranceTimer);
      state.utteranceTimer = null;
    }
    state.captionBuffer = "";
    state.chatContainer = null;
    state.captionContainer = null;
  }

  // ---------------------------------------------------------------------
  // Chat panel discovery + observation
  // ---------------------------------------------------------------------

  function findChatContainer() {
    // Current Meet markup has no role="list"/"log" for chat — the message
    // container is just an aria-live div that lives alongside the compose
    // box. The compose box's aria-label is the stable anchor point: walk up
    // from it, and at each ancestor level look for an aria-live sibling
    // subtree (the smallest enclosing scope wins, to avoid picking up
    // unrelated aria-live regions elsewhere on the page).
    const composeBox = document.querySelector(
      '[aria-label="Send a message"], [aria-label*="Send a message" i]'
    );
    if (composeBox) {
      let scope = composeBox.parentElement;
      for (let i = 0; i < 24 && scope; i++) {
        const liveRegions = scope.querySelectorAll("[aria-live]");
        for (const region of liveRegions) {
          if (region === composeBox || composeBox.contains(region)) continue;
          // Skip visually-hidden screen-reader-only announcers (Meet fires
          // several of these — "you joined", "panel is open", etc.) — they're
          // also aria-live but are ~0px/off-screen, not the real message list.
          const rect = region.getBoundingClientRect();
          if (rect.width < 20 || rect.height < 20) continue;
          const text = (region.innerText || region.textContent || "").trim();
          if (/you (have )?joined|live captions? (are|is)|left the (call|meeting)|you are the first/i.test(text)) {
            continue;
          }
          return region;
        }
        scope = scope.parentElement;
      }
    }

    // Fallbacks in case a future Meet redeploy restores role-based markup.
    let el = document.querySelector('[aria-label*="Chat messages" i][role="list"]');
    if (el) return el;

    el = document.querySelector('[aria-label*="chat" i][role="list"]');
    if (el) return el;

    const complementaryPanels = document.querySelectorAll('[role="complementary"]');
    for (const panel of complementaryPanels) {
      const list = panel.querySelector('[role="list"], [role="log"]');
      if (list) return list;
    }

    return null;
  }

  function attachChatObserver() {
    const container = findChatContainer();
    if (!container) {
      if (state.chatContainer && !state.chatNotFoundSince) {
        state.chatNotFoundSince = Date.now();
      }
      state.chatContainer = null;
      return false;
    }
    if (state.chatContainer === container && state.chatObserver) return true;

    if (state.chatObserver) state.chatObserver.disconnect();

    state.chatContainer = container;
    state.chatNotFoundSince = null;
    state.chatPromptShown = false;
    removePrompt("chat");

    // Scan messages already present when the extension attaches mid-meeting.
    for (const node of container.children) {
      processChatNode(node);
    }

    state.chatObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            processChatNode(node);
          }
        }
      }
    });
    state.chatObserver.observe(container, { childList: true, subtree: true });
    return true;
  }

  function hashMessage(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    return hash >>> 0;
  }

  function processChatNode(node) {
    const text = (node.innerText || node.textContent || "").trim();
    if (!text) return;

    const hash = hashMessage(text);
    if (state.processedMessages.has(hash)) return;
    state.processedMessages.add(hash);

    if (!state.settings.enabled) return;

    // Runs independently of the general keyword floor below — a burst of
    // short, anchored "N present" check-ins is a strong signal on its own
    // even when no individual message scores high.
    checkPresenceBurst(text);

    const result = evaluateText(text, "chat", state.settings);
    if (result.qualifies) {
      recordSignal(text, result.score, "chat", result.labels);
    }
  }

  // Tracks consecutive short roll-call check-ins ("1 present", "here", ...).
  // As long as each new one arrives within RAPID_WINDOW_MS of the previous
  // one, the streak keeps extending — so a real burst spread over dozens of
  // seconds (13 students typing one after another) still counts correctly,
  // while an unrelated "present" days apart from another doesn't.
  function checkPresenceBurst(text) {
    if (!SHORT_PRESENCE_PATTERN.test(text)) return;

    const now = Date.now();
    if (now - state.burstLastEventTime <= RAPID_WINDOW_MS) {
      state.burstCount += 1;
    } else {
      state.burstCount = 1;
    }
    state.burstLastEventTime = now;

    if (state.burstCount === PRESENCE_BURST_TRIGGER_COUNT) {
      recordSignal(
        text,
        PRESENCE_BURST_SCORE_BONUS,
        "chat",
        ["presence burst: " + state.burstCount + " consecutive check-ins"]
      );
    }
  }

  // ---------------------------------------------------------------------
  // Caption discovery + observation (with utterance buffering)
  // ---------------------------------------------------------------------

  function findCaptionContainer() {
    // Meet exposes the live transcript as a labeled landmark region — far
    // more reliable than guessing by position among all aria-live elements.
    const byRegion = document.querySelector('[role="region"][aria-label="Captions" i]');
    if (byRegion) return byRegion;

    // Fallback for a differently-labeled region — explicitly excludes
    // buttons/controls (the caption *toggle* button's aria-label also
    // contains "caption" and would otherwise be matched forever, since
    // unlike the real transcript it never leaves the DOM).
    const labelCandidates = document.querySelectorAll('[aria-label="Captions" i], [aria-label*="caption" i]');
    for (const el of labelCandidates) {
      if (el.tagName === "BUTTON" || el.getAttribute("role") === "button") continue;
      return el;
    }

    // Positional fallback for older/future Meet markup that doesn't label
    // the region: an aria-live element sitting in the lower half of the
    // viewport, roughly caption-banner sized.
    const liveRegions = document.querySelectorAll("[aria-live]");
    const viewportH = window.innerHeight;
    for (const el of liveRegions) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom > viewportH * 0.55 && rect.height > 20 && rect.height < 300 && rect.width > 20) {
        return el;
      }
    }

    return null;
  }

  function attachCaptionObserver() {
    const container = findCaptionContainer();
    if (!container) {
      if (state.captionContainer && !state.captionNotFoundSince) {
        state.captionNotFoundSince = Date.now();
      }
      state.captionContainer = null;
      return false;
    }
    if (state.captionContainer === container && state.captionObserver) return true;

    if (state.captionObserver) state.captionObserver.disconnect();

    state.captionContainer = container;
    state.captionNotFoundSince = null;
    state.captionPromptShown = false;
    removePrompt("caption");
    state.captionBuffer = "";

    state.captionObserver = new MutationObserver(() => {
      handleCaptionMutation(container);
    });
    state.captionObserver.observe(container, { childList: true, subtree: true, characterData: true });
    return true;
  }

  function handleCaptionMutation(container) {
    const currentText = (container.innerText || container.textContent || "").trim();
    if (!currentText) return;

    if (currentText.startsWith(state.captionBuffer) || state.captionBuffer === "") {
      state.captionBuffer = currentText;
      resetUtteranceTimer();
    } else {
      finalizeCaptionBuffer();
      state.captionBuffer = currentText;
      resetUtteranceTimer();
    }
  }

  function resetUtteranceTimer() {
    if (state.utteranceTimer) clearTimeout(state.utteranceTimer);
    state.utteranceTimer = setTimeout(finalizeCaptionBuffer, 2000);
  }

  function finalizeCaptionBuffer() {
    const text = state.captionBuffer.trim();
    state.captionBuffer = "";
    if (state.utteranceTimer) {
      clearTimeout(state.utteranceTimer);
      state.utteranceTimer = null;
    }
    if (!text || !state.settings.enabled) return;

    const result = evaluateText(text, "caption", state.settings);
    if (result.qualifies) {
      recordSignal(text, result.score, "caption", result.labels);
    }
  }

  // ---------------------------------------------------------------------
  // Body-level observer + periodic recheck (containers appear/disappear
  // as the user opens/closes panels, or Meet re-renders them)
  // ---------------------------------------------------------------------

  function attachBodyObserver() {
    // Cheap "did we lose it" check on every body mutation (this fires very
    // often during an active call, so avoid unconditional re-discovery
    // here). The 5s recheckContainers() poll is what upgrades a wrongly-
    // matched-but-still-present element once the real target appears.
    if (state.bodyObserver) state.bodyObserver.disconnect();
    state.bodyObserver = new MutationObserver(() => {
      if (!state.chatContainer || !document.contains(state.chatContainer)) {
        attachChatObserver();
      }
      if (!state.captionContainer || !document.contains(state.captionContainer)) {
        attachCaptionObserver();
      }
    });
    state.bodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  function recheckContainers() {
    if (!state.inMeeting) return;

    // Always re-run discovery, even if the cached container is technically
    // still in the DOM — a wrongly-matched but persistent element (like a
    // toolbar button) would otherwise "look fine" forever and we'd never
    // upgrade to the real one once it appears. attachXObserver() is cheap
    // when the best match hasn't changed (it no-ops via reference equality).
    {
      const found = attachChatObserver();
      if (!found && state.chatNotFoundSince && !state.chatPromptShown) {
        if (Date.now() - state.chatNotFoundSince > 30000) {
          showPrompt("chat", "Open the chat panel for full attendance monitoring.");
          state.chatPromptShown = true;
        }
      }
    }

    {
      const found = attachCaptionObserver();
      if (!found && state.captionNotFoundSince && !state.captionPromptShown) {
        if (Date.now() - state.captionNotFoundSince > 30000) {
          showPrompt("caption", 'Enable captions (press "c") for voice-based attendance detection.');
          state.captionPromptShown = true;
        }
      }
    }
  }

  // ---------------------------------------------------------------------
  // In-page prompt banners
  // ---------------------------------------------------------------------

  const prompts = {};

  function showPrompt(kind, message) {
    removePrompt(kind);
    const banner = document.createElement("div");
    banner.className =
      kind === "chat" ? "meet-attendance-chat-prompt" : "meet-attendance-caption-prompt";
    banner.innerHTML =
      '<span class="meet-attendance-prompt-text"></span>' +
      '<button type="button" class="meet-attendance-prompt-dismiss" aria-label="Dismiss">✕</button>';
    banner.querySelector(".meet-attendance-prompt-text").textContent = message;
    banner.querySelector(".meet-attendance-prompt-dismiss").addEventListener("click", () => removePrompt(kind));
    document.body.appendChild(banner);
    prompts[kind] = banner;
  }

  function removePrompt(kind) {
    if (prompts[kind]) {
      prompts[kind].remove();
      delete prompts[kind];
    }
  }

  // ---------------------------------------------------------------------
  // Alert manager — combines recent chat + caption evidence into one
  // real-time score instead of firing on a single isolated keyword hit.
  // ---------------------------------------------------------------------

  function recordSignal(text, score, source, labels) {
    const now = Date.now();
    state.recentEvents.push({ time: now, score });
    state.recentEvents = state.recentEvents.filter((e) => now - e.time <= RAPID_WINDOW_MS);
    state.aggregateScore = state.recentEvents.reduce((sum, e) => sum + e.score, 0);

    const crossedThreshold = state.aggregateScore >= state.settings.alertThreshold;
    const cooldownActive = now - state.lastAlertTime < state.settings.cooldownSeconds * 1000;
    const suppressed = !crossedThreshold || cooldownActive;

    logDetection(text, score, source, suppressed, labels);

    if (crossedThreshold && !cooldownActive) {
      const combinedScore = state.aggregateScore;
      state.lastAlertTime = now;
      state.recentEvents = [];
      state.aggregateScore = 0;
      fireAllAlerts(text, combinedScore, source);
    }
  }

  function logDetection(text, score, source, suppressed, labels) {
    chrome.storage.local.get({ detectionLog: [] }, (result) => {
      const log = result.detectionLog || [];
      log.unshift({
        time: Date.now(),
        text: text.slice(0, 200),
        source,
        score,
        suppressed,
        labels,
      });
      if (log.length > DETECTION_LOG_CAP) log.length = DETECTION_LOG_CAP;
      chrome.storage.local.set({ detectionLog: log });
    });
  }

  function fireAllAlerts(text, score, source) {
    try {
      chrome.runtime.sendMessage({ type: "ALERT", text, score, source });
    } catch (e) {
      // service worker may be waking up; ignore
    }
    showVisualAlerts(text);
  }

  // The service worker handles sound + notification; these two live in the
  // Meet tab. Each one can be switched off on the settings page.
  function showVisualAlerts(text) {
    if (state.settings.alertBanner) showOverlay(text);
    if (state.settings.alertTitleFlash) startTitleFlash();
  }

  // ---------------------------------------------------------------------
  // Visual overlay
  // ---------------------------------------------------------------------

  function showOverlay(text) {
    hideOverlay();

    const overlay = document.createElement("div");
    overlay.className = "meet-attendance-overlay";
    overlay.innerHTML =
      '<div class="meet-attendance-overlay-inner">' +
      '<span class="meet-attendance-overlay-title">ATTENDANCE CHECK DETECTED</span>' +
      '<span class="meet-attendance-overlay-sub">Respond now: ' +
      (text ? escapeHtml(truncate(text, 80)) : "") +
      '</span>' +
      '</div>' +
      '<button type="button" class="meet-attendance-overlay-dismiss" aria-label="Dismiss alert">✕</button>';

    overlay.querySelector(".meet-attendance-overlay-dismiss").addEventListener("click", hideOverlay);
    document.body.appendChild(overlay);
    state.overlayElement = overlay;

    requestAnimationFrame(() => overlay.classList.add("meet-attendance-overlay-visible"));

    state.overlayTimeout = setTimeout(hideOverlay, 15000);
  }

  function hideOverlay() {
    if (state.overlayTimeout) {
      clearTimeout(state.overlayTimeout);
      state.overlayTimeout = null;
    }
    if (state.overlayElement) {
      state.overlayElement.remove();
      state.overlayElement = null;
    }
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function truncate(str, n) {
    return str.length > n ? str.slice(0, n) + "…" : str;
  }

  // ---------------------------------------------------------------------
  // Tab title flashing
  // ---------------------------------------------------------------------

  function startTitleFlash() {
    stopTitleFlash();
    state.originalTitle = document.title;

    let flashOn = false;
    state.titleFlashInterval = setInterval(() => {
      flashOn = !flashOn;
      document.title = flashOn ? "⚠ ATTENDANCE" : state.originalTitle;
    }, 1000);

    const onVisible = () => {
      if (document.visibilityState === "visible") stopTitleFlash();
    };
    document.addEventListener("visibilitychange", onVisible);
    state.titleFlashStop = onVisible;

    setTimeout(stopTitleFlash, 60000);
  }

  function stopTitleFlash() {
    if (state.titleFlashInterval) {
      clearInterval(state.titleFlashInterval);
      state.titleFlashInterval = null;
      if (state.originalTitle !== null) document.title = state.originalTitle;
    }
    if (state.titleFlashStop) {
      document.removeEventListener("visibilitychange", state.titleFlashStop);
      state.titleFlashStop = null;
    }
  }

  // ---------------------------------------------------------------------
  // Diagnostics — lets the popup grab the live Meet DOM shape with one
  // click, so selectors can be fixed without anyone touching DevTools.
  // ---------------------------------------------------------------------

  function describeEl(el, label) {
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      label,
      tag: el.tagName,
      role: el.getAttribute("role"),
      ariaLabel: el.getAttribute("aria-label"),
      ariaLabelledby: el.getAttribute("aria-labelledby"),
      contentEditable: el.getAttribute("contenteditable"),
      className: (el.className || "").toString().slice(0, 80),
      childCount: el.children.length,
      text: (el.innerText || "").slice(0, 60),
      rect: { top: Math.round(rect.top), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height) },
    };
  }

  function collectDiagnostics() {
    const composeBox = Array.from(
      document.querySelectorAll('[contenteditable="true"], textarea, input[type="text"]')
    ).find((el) => {
      const label = (el.getAttribute("aria-label") || "") + " " + (el.getAttribute("placeholder") || "");
      return /send a message|message/i.test(label);
    });

    const ancestors = [];
    let el = composeBox;
    let i = 0;
    while (el && i < 8) {
      ancestors.push(describeEl(el, "ancestor-" + i));
      el = el.parentElement;
      i++;
    }

    const lists = Array.from(document.querySelectorAll('[role="list"], [role="log"]')).map((e, idx) =>
      describeEl(e, "list-" + idx)
    );

    const liveRegions = Array.from(document.querySelectorAll("[aria-live]")).map((e, idx) =>
      describeEl(e, "live-" + idx)
    );

    // Broader fallbacks in case the label-matching heuristics above miss —
    // dump anything editable, and anything whose aria-label mentions chat/caption,
    // regardless of whether it matched the primary heuristics.
    const allEditable = Array.from(
      document.querySelectorAll('[contenteditable="true"], textarea, input[type="text"]')
    )
      .slice(0, 15)
      .map((e, idx) => describeEl(e, "editable-" + idx));

    const chatLabeled = Array.from(document.querySelectorAll('[aria-label*="chat" i]'))
      .slice(0, 10)
      .map((e, idx) => describeEl(e, "chat-labeled-" + idx));

    const captionLabeled = Array.from(document.querySelectorAll('[aria-label*="caption" i]'))
      .slice(0, 10)
      .map((e, idx) => describeEl(e, "caption-labeled-" + idx));

    const complementaryPanels = Array.from(document.querySelectorAll('[role="complementary"]'))
      .slice(0, 10)
      .map((e, idx) => describeEl(e, "complementary-" + idx));

    return {
      url: location.href,
      inMeeting: state.inMeeting,
      chatFound: !!(state.chatContainer && document.contains(state.chatContainer)),
      captionsFound: !!(state.captionContainer && document.contains(state.captionContainer)),
      composeBox: describeEl(composeBox, "composeBox"),
      ancestors,
      lists,
      liveRegions,
      allEditable,
      chatLabeled,
      captionLabeled,
      complementaryPanels,
    };
  }

  // ---------------------------------------------------------------------
  // Messaging (popup <-> content script)
  // ---------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("[Meet Attendance Tracker] received message:", message.type);
    if (message.type === "GET_STATUS") {
      sendResponse({
        connected: true,
        inMeeting: state.inMeeting,
        monitoring: {
          chat: !!(state.chatContainer && document.contains(state.chatContainer)),
          captions: !!(state.captionContainer && document.contains(state.captionContainer)),
        },
        aggregateScore: state.aggregateScore,
        alertThreshold: state.settings.alertThreshold,
      });
      return;
    }

    if (message.type === "TEST_VISUAL_ALERT") {
      showVisualAlerts("Test alert");
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "COLLECT_DEBUG") {
      sendResponse(collectDiagnostics());
      return;
    }
  });

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  loadSettings(() => {
    pollMeetingState();
    state.meetingPollInterval = setInterval(pollMeetingState, 5000);
  });
})();
