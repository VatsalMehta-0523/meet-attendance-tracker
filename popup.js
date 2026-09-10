// popup.js — quick status view: the on/off switch, what's being watched in
// the current Meet tab, your keywords, and recent detections. Everything else
// lives on the settings page (options.html). First-time users see a short
// welcome screen. Keyword helpers come from keywords.js.

const el = {
  welcomeView: document.getElementById("welcomeView"),
  mainView: document.getElementById("mainView"),
  getStartedBtn: document.getElementById("getStartedBtn"),
  masterToggle: document.getElementById("masterToggle"),
  statusDot: document.getElementById("statusDot"),
  statusText: document.getElementById("statusText"),
  chatDot: document.getElementById("chatDot"),
  chatDetail: document.getElementById("chatDetail"),
  captionDot: document.getElementById("captionDot"),
  captionDetail: document.getElementById("captionDetail"),
  chipsContainer: document.getElementById("chipsContainer"),
  keywordInput: document.getElementById("keywordInput"),
  addKeywordBtn: document.getElementById("addKeywordBtn"),
  detectionLog: document.getElementById("detectionLog"),
  emptyState: document.getElementById("emptyState"),
  testAlertBtn: document.getElementById("testAlertBtn"),
  clearLogBtn: document.getElementById("clearLogBtn"),
  copyDebugBtn: document.getElementById("copyDebugBtn"),
  openOptionsBtn: document.getElementById("openOptionsBtn"),
};

el.openOptionsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

let enabled = true;
let keywords = [];

function load() {
  chrome.storage.local.get({ enabled: true, customKeywords: [], detectionLog: [], onboarded: false }, (result) => {
    enabled = result.enabled;
    keywords = result.customKeywords;
    showView(result.onboarded);
    renderToggle();
    renderKeywords();
    renderLog(result.detectionLog);
  });
}

// --- First-run welcome ---------------------------------------------------
// A local flag, nothing more: it only decides whether to show the intro.
// Monitoring works whether or not the user has clicked through it.

function showView(onboarded) {
  el.welcomeView.hidden = onboarded;
  el.mainView.hidden = !onboarded;
}

el.getStartedBtn.addEventListener("click", () => {
  chrome.storage.local.set({ onboarded: true });
});

// --- Master toggle ---------------------------------------------------

function renderToggle() {
  el.masterToggle.setAttribute("aria-checked", String(enabled));
  el.statusText.textContent = enabled ? "Monitoring active" : "Monitoring paused";
  el.statusDot.classList.toggle("is-active", enabled);
}

el.masterToggle.addEventListener("click", () => {
  enabled = !enabled;
  chrome.storage.local.set({ enabled });
  renderToggle();
});

// --- Keywords -------------------------------------------------------

function saveKeywords(next) {
  keywords = next;
  chrome.storage.local.set({ customKeywords: next });
  renderKeywords();
}

function renderKeywords() {
  renderKeywordChips(el.chipsContainer, keywords, (kw) => saveKeywords(keywords.filter((k) => k !== kw)));
}

function addFromInput() {
  const next = addKeywordTo(keywords, el.keywordInput.value);
  el.keywordInput.value = "";
  if (next) saveKeywords(next);
}

el.addKeywordBtn.addEventListener("click", addFromInput);
el.keywordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addFromInput();
  }
});

// --- Detection log -------------------------------------------------------

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function renderLog(entries) {
  el.detectionLog.innerHTML = "";
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
  chrome.storage.local.set({ detectionLog: [] });
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
  el.copyDebugBtn.textContent = text;
  setTimeout(() => (el.copyDebugBtn.textContent = "Copy diagnostic info"), 2500);
}

el.copyDebugBtn.addEventListener("click", () => {
  withActiveMeetTab((tabId) => {
    sendMessageWithRetry(tabId, { type: "COLLECT_DEBUG" }, (response) => {
      if (!response) {
        flashDebugBtnLabel("Not on a Meet call");
        return;
      }
      navigator.clipboard.writeText(JSON.stringify(response, null, 2)).then(
        () => flashDebugBtnLabel("Copied to clipboard"),
        () => flashDebugBtnLabel("Couldn't copy")
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

function setCard(dot, detail, dotClass, text) {
  dot.className = "status-dot " + dotClass;
  detail.textContent = text;
}

function renderMonitoringStatus(status) {
  if (!status) {
    setCard(el.chatDot, el.chatDetail, "", "Not on a Meet call");
    setCard(el.captionDot, el.captionDetail, "", "Not on a Meet call");
  } else if (!status.inMeeting) {
    setCard(el.chatDot, el.chatDetail, "", "Waiting to join");
    setCard(el.captionDot, el.captionDetail, "", "Waiting to join");
  } else {
    setCard(el.chatDot, el.chatDetail, ...(status.monitoring.chat ? ["is-active", "Watching"] : ["is-warning", "Open the chat panel"]));
    setCard(el.captionDot, el.captionDetail, ...(status.monitoring.captions ? ["is-active", "Watching"] : ["is-warning", "Press C in Meet"]));
  }
}

function fetchMonitoringStatus() {
  withActiveMeetTab((tabId) => {
    sendMessageWithRetry(tabId, { type: "GET_STATUS" }, renderMonitoringStatus);
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.onboarded) showView(!!changes.onboarded.newValue);
  if (changes.customKeywords) {
    keywords = changes.customKeywords.newValue || [];
    renderKeywords();
  }
  if (changes.detectionLog) renderLog(changes.detectionLog.newValue || []);
  if (changes.enabled) {
    enabled = changes.enabled.newValue;
    renderToggle();
  }
});

load();
fetchMonitoringStatus();
