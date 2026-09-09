// popup.js — reads/writes chrome.storage.local settings and talks to the
// content script on the active tab for live monitoring status.

const DEFAULTS = {
  enabled: true,
  customKeywords: [],
  sensitivity: "normal",
  detectionLog: [],
};

const el = {
  masterToggle: document.getElementById("masterToggle"),
  statusDot: document.getElementById("statusDot"),
  statusText: document.getElementById("statusText"),
  chatDot: document.getElementById("chatDot"),
  chatDetail: document.getElementById("chatDetail"),
  captionDot: document.getElementById("captionDot"),
  captionDetail: document.getElementById("captionDetail"),
  segmentedPills: Array.from(document.querySelectorAll(".segmented-pill")),
  chipsContainer: document.getElementById("chipsContainer"),
  keywordInput: document.getElementById("keywordInput"),
  addKeywordBtn: document.getElementById("addKeywordBtn"),
  detectionLog: document.getElementById("detectionLog"),
  emptyState: document.getElementById("emptyState"),
  testAlertBtn: document.getElementById("testAlertBtn"),
  clearLogBtn: document.getElementById("clearLogBtn"),
  copyDebugBtn: document.getElementById("copyDebugBtn"),
};

let settings = { ...DEFAULTS };

function load() {
  chrome.storage.local.get(DEFAULTS, (result) => {
    settings = { ...DEFAULTS, ...result };
    renderToggle();
    renderSensitivity();
    renderChips();
    renderLog();
  });
}

// --- Master toggle ---------------------------------------------------

function renderToggle() {
  el.masterToggle.setAttribute("aria-checked", String(settings.enabled));
  el.statusText.textContent = settings.enabled ? "Monitoring active" : "Monitoring paused";
  el.statusDot.classList.toggle("is-active", settings.enabled);
  el.statusDot.classList.toggle("is-off", !settings.enabled);
}

el.masterToggle.addEventListener("click", () => {
  settings.enabled = !settings.enabled;
  chrome.storage.local.set({ enabled: settings.enabled });
  renderToggle();
});

// --- Sensitivity -------------------------------------------------------

function renderSensitivity() {
  for (const pill of el.segmentedPills) {
    const active = pill.dataset.value === settings.sensitivity;
    pill.setAttribute("aria-checked", String(active));
  }
}

for (const pill of el.segmentedPills) {
  pill.addEventListener("click", () => {
    settings.sensitivity = pill.dataset.value;
    chrome.storage.local.set({ sensitivity: settings.sensitivity });
    renderSensitivity();
  });
}

// --- Keyword chips -------------------------------------------------------

function renderChips() {
  el.chipsContainer.innerHTML = "";
  for (const kw of settings.customKeywords) {
    const chip = document.createElement("span");
    chip.className = "chip";
    const label = document.createElement("span");
    label.textContent = kw;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "chip-remove";
    removeBtn.setAttribute("aria-label", "Remove " + kw);
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => removeKeyword(kw));
    chip.appendChild(label);
    chip.appendChild(removeBtn);
    el.chipsContainer.appendChild(chip);
  }
}

function addKeyword() {
  const value = el.keywordInput.value.trim();
  if (!value) return;
  if (settings.customKeywords.some((k) => k.toLowerCase() === value.toLowerCase())) {
    el.keywordInput.value = "";
    return;
  }
  settings.customKeywords = [...settings.customKeywords, value];
  chrome.storage.local.set({ customKeywords: settings.customKeywords });
  el.keywordInput.value = "";
  renderChips();
}

function removeKeyword(kw) {
  settings.customKeywords = settings.customKeywords.filter((k) => k !== kw);
  chrome.storage.local.set({ customKeywords: settings.customKeywords });
  renderChips();
}

el.addKeywordBtn.addEventListener("click", addKeyword);
el.keywordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addKeyword();
  }
});

// --- Detection log -------------------------------------------------------

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function renderLog() {
  el.detectionLog.innerHTML = "";
  const entries = settings.detectionLog || [];
  el.emptyState.hidden = entries.length > 0;

  for (const entry of entries) {
    const li = document.createElement("li");
    li.className = "log-entry" + (entry.suppressed ? " is-suppressed" : "");

    const time = document.createElement("span");
    time.className = "log-time";
    time.textContent = formatTime(entry.time);

    const badge = document.createElement("span");
    badge.className = "log-badge " + (entry.source === "caption" ? "caption" : "chat");
    badge.textContent = entry.source === "caption" ? "Voice" : "Chat";

    const text = document.createElement("span");
    text.className = "log-text";
    text.textContent = entry.text;
    text.title = entry.text;

    li.appendChild(time);
    li.appendChild(badge);
    li.appendChild(text);
    el.detectionLog.appendChild(li);
  }
}

el.clearLogBtn.addEventListener("click", () => {
  settings.detectionLog = [];
  chrome.storage.local.set({ detectionLog: [] });
  renderLog();
});

el.testAlertBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "TEST_ALERT" });
  withActiveMeetTab((tabId) => {
    chrome.tabs.sendMessage(tabId, { type: "TEST_VISUAL_ALERT" }, () => {
      // no content script on this tab / not on Meet — nothing to do
      void chrome.runtime.lastError;
    });
  });
});

function flashDebugBtnLabel(text) {
  const original = "Copy diagnostic info";
  el.copyDebugBtn.textContent = text;
  setTimeout(() => (el.copyDebugBtn.textContent = original), 2500);
}

el.copyDebugBtn.addEventListener("click", () => {
  withActiveMeetTab((tabId) => {
    sendMessageWithRetry(tabId, { type: "COLLECT_DEBUG" }, (response) => {
      if (!response) {
        flashDebugBtnLabel("Not on a Meet call");
        return;
      }
      const json = JSON.stringify(response, null, 2);
      navigator.clipboard.writeText(json).then(
        () => flashDebugBtnLabel("Copied! Paste it to Claude"),
        () => flashDebugBtnLabel("Copy failed — see console")
      );
    });
  });
});

// --- Live status from content script -------------------------------------

function withActiveMeetTab(cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab && tab.id) cb(tab.id);
  });
}

// Right after a Meet tab reload there's a brief window where the content
// script hasn't finished re-injecting yet — retry a few times before giving
// up, instead of surfacing a misleading "not on a Meet call" immediately.
function sendMessageWithRetry(tabId, message, callback, attemptsLeft = 5) {
  chrome.tabs.sendMessage(tabId, message, (response) => {
    if (chrome.runtime.lastError || !response) {
      if (attemptsLeft > 1) {
        setTimeout(() => sendMessageWithRetry(tabId, message, callback, attemptsLeft - 1), 400);
      } else {
        callback(null);
      }
      return;
    }
    callback(response);
  });
}

function renderMonitoringStatus(status) {
  if (!status) {
    el.chatDot.className = "status-dot";
    el.chatDetail.textContent = "Not on a Meet call";
    el.captionDot.className = "status-dot";
    el.captionDetail.textContent = "Not on a Meet call";
    return;
  }

  if (!status.inMeeting) {
    el.chatDot.className = "status-dot is-off";
    el.chatDetail.textContent = "Waiting to join";
    el.captionDot.className = "status-dot is-off";
    el.captionDetail.textContent = "Waiting to join";
    return;
  }

  if (status.monitoring.chat) {
    el.chatDot.className = "status-dot is-active";
    el.chatDetail.textContent = "Watching";
  } else {
    el.chatDot.className = "status-dot is-warning";
    el.chatDetail.textContent = "Open chat panel";
  }

  if (status.monitoring.captions) {
    el.captionDot.className = "status-dot is-active";
    el.captionDetail.textContent = "Watching";
  } else {
    el.captionDot.className = "status-dot is-warning";
    el.captionDetail.textContent = "Enable in Meet";
  }
}

function fetchMonitoringStatus() {
  withActiveMeetTab((tabId) => {
    sendMessageWithRetry(tabId, { type: "GET_STATUS" }, renderMonitoringStatus);
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.detectionLog) {
    settings.detectionLog = changes.detectionLog.newValue || [];
    renderLog();
  }
  if (changes.customKeywords) {
    settings.customKeywords = changes.customKeywords.newValue || [];
    renderChips();
  }
  if (changes.enabled) {
    settings.enabled = changes.enabled.newValue;
    renderToggle();
  }
  if (changes.sensitivity) {
    settings.sensitivity = changes.sensitivity.newValue;
    renderSensitivity();
  }
});

load();
fetchMonitoringStatus();
