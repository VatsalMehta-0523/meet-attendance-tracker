// background.js — coordinator. The content script is the primary brain;
// this worker only creates notifications and manages the offscreen audio
// document (MV3 service workers cannot use the Audio API directly).

const OFFSCREEN_PATH = "offscreen.html";
const NORMAL_ICONS = { 16: "icons/icon16.png", 48: "icons/icon48.png", 128: "icons/icon128.png" };
const ALERT_ICONS = { 16: "icons/icon-alert16.png", 48: "icons/icon-alert48.png", 128: "icons/icon-alert128.png" };
let iconResetTimeout = null;

async function hasOffscreenDocument() {
  if (chrome.runtime.getContexts) {
    const existing = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
    });
    return existing.length > 0;
  }
  // Fallback for Chrome < 116, which lacks getContexts().
  const clients = await self.clients.matchAll();
  return clients.some((c) => c.url.endsWith(OFFSCREEN_PATH));
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Playing the attendance alert alarm sound",
    });
  } catch (e) {
    // Two alerts racing to create the document both pass the check above;
    // the loser hits "Only a single offscreen document may be created" —
    // harmless, the winner's document is what we wanted anyway.
    if (!String(e).includes("single offscreen")) throw e;
  }
}

async function playAlarm() {
  try {
    await ensureOffscreenDocument();
    chrome.runtime.sendMessage({ type: "PLAY_ALARM" });
  } catch (e) {
    console.error("Meet Attendance Tracker: failed to play alarm", e);
  }
}

function notify(text, source) {
  const id = "attendance-" + Date.now();
  chrome.notifications.create(id, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "ATTENDANCE ALERT",
    message: text ? "Detected in " + source + ": " + text : "Attendance check detected",
    priority: 2,
    requireInteraction: true,
  });
}

function showAlertIcon() {
  chrome.action.setIcon({ path: ALERT_ICONS });
  if (iconResetTimeout) clearTimeout(iconResetTimeout);
  iconResetTimeout = setTimeout(() => {
    chrome.action.setIcon({ path: NORMAL_ICONS });
  }, 30000);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ALERT") {
    notify(message.text, message.source);
    playAlarm();
    showAlertIcon();
    return;
  }

  if (message.type === "TEST_ALERT") {
    notify("Test alert", "test");
    playAlarm();
    showAlertIcon();
    sendResponse({ ok: true });
    return;
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.notifications.clear(notificationId);
  chrome.action.setIcon({ path: NORMAL_ICONS });
});

chrome.notifications.onClosed.addListener(() => {
  chrome.action.setIcon({ path: NORMAL_ICONS });
});
