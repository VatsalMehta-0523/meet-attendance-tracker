// options.js — settings page. Reads/writes the same chrome.storage.local keys
// as popup.js, content.js and background.js. Every write comes back through
// storage.onChanged, which re-renders, so the page stays in sync with other
// open pages without extra bookkeeping. Keyword helpers come from keywords.js.

// Keep in sync with the defaults in content.js (state.settings) and
// background.js (ALERT_DEFAULTS). The custom alarm audio itself lives under
// "customAlarm" and is deliberately not loaded here; only its name is.
const DEFAULTS = {
  enabled: true,
  customKeywords: [],
  sensitivity: "normal",
  alertThreshold: 2.5,
  alertSound: true,
  alertNotification: true,
  alertBanner: true,
  alertTitleFlash: true,
  alarmVolume: 1,
  cooldownSeconds: 30,
  customAlarmName: "",
};

const SUGGESTED_KEYWORDS = ["Yes", "Y", "Available", "Here", "Ready"];

// Stored as a base64 data URL (~4 MB for a 3 MB file), well inside
// chrome.storage.local's 10 MB quota.
const MAX_ALARM_BYTES = 3 * 1024 * 1024;
const MAX_ALARM_SECONDS = 30;

const el = {
  toggles: Array.from(document.querySelectorAll(".toggle[data-setting]")),
  segmentedPills: Array.from(document.querySelectorAll(".segmented-pill")),
  thresholdSlider: document.getElementById("thresholdSlider"),
  thresholdValue: document.getElementById("thresholdValue"),
  volumeSlider: document.getElementById("volumeSlider"),
  volumeValue: document.getElementById("volumeValue"),
  cooldownSelect: document.getElementById("cooldownSelect"),
  testAlertBtn: document.getElementById("testAlertBtn"),
  alarmToneName: document.getElementById("alarmToneName"),
  alarmToneError: document.getElementById("alarmToneError"),
  uploadAlarmBtn: document.getElementById("uploadAlarmBtn"),
  resetAlarmBtn: document.getElementById("resetAlarmBtn"),
  alarmFileInput: document.getElementById("alarmFileInput"),
  chipsContainer: document.getElementById("chipsContainer"),
  suggestedContainer: document.getElementById("suggestedContainer"),
  keywordInput: document.getElementById("keywordInput"),
  addKeywordBtn: document.getElementById("addKeywordBtn"),
};

let settings = { ...DEFAULTS };

function save(key, value) {
  settings[key] = value;
  chrome.storage.local.set({ [key]: value });
}

function render() {
  for (const toggle of el.toggles) {
    toggle.setAttribute("aria-checked", String(settings[toggle.dataset.setting]));
  }
  for (const pill of el.segmentedPills) {
    pill.setAttribute("aria-checked", String(pill.dataset.value === settings.sensitivity));
  }
  el.thresholdSlider.value = settings.alertThreshold;
  el.thresholdValue.textContent = Number(settings.alertThreshold).toFixed(1);
  el.volumeSlider.value = Math.round(settings.alarmVolume * 100);
  el.volumeValue.textContent = el.volumeSlider.value + "%";
  el.volumeSlider.disabled = !settings.alertSound;
  el.cooldownSelect.value = String(settings.cooldownSeconds);
  el.alarmToneName.textContent = settings.customAlarmName || "Built-in alarm";
  el.alarmToneName.title = settings.customAlarmName;
  el.resetAlarmBtn.hidden = !settings.customAlarmName;
  renderKeywordChips(el.chipsContainer, settings.customKeywords, removeKeyword);
  renderSuggested();
}

// --- Switches, sensitivity, sliders, select ---------------------------------

for (const toggle of el.toggles) {
  toggle.addEventListener("click", () => save(toggle.dataset.setting, !settings[toggle.dataset.setting]));
}

for (const pill of el.segmentedPills) {
  pill.addEventListener("click", () => save("sensitivity", pill.dataset.value));
}

el.thresholdSlider.addEventListener("input", () => {
  el.thresholdValue.textContent = Number(el.thresholdSlider.value).toFixed(1);
});
el.thresholdSlider.addEventListener("change", () => save("alertThreshold", Number(el.thresholdSlider.value)));

el.volumeSlider.addEventListener("input", () => {
  el.volumeValue.textContent = el.volumeSlider.value + "%";
});
el.volumeSlider.addEventListener("change", () => save("alarmVolume", Number(el.volumeSlider.value) / 100));

el.cooldownSelect.addEventListener("change", () => save("cooldownSeconds", Number(el.cooldownSelect.value)));

el.testAlertBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "TEST_ALERT" });
});

// --- Custom alarm tone -------------------------------------------------------

function showAlarmError(message) {
  el.alarmToneError.textContent = message;
  el.alarmToneError.hidden = !message;
}

// The file comes from the user's disk, so check it before storing: it has to
// be audio Chrome can actually play, and short enough to work as an alarm
// (it plays three times in a row).
async function readAlarmFile(file) {
  if (!file.type.startsWith("audio/")) throw new Error("That isn't an audio file.");
  if (file.size > MAX_ALARM_BYTES) throw new Error("That file is over 3 MB. Try a shorter clip.");

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(file);
  });

  const duration = await new Promise((resolve, reject) => {
    const audio = new Audio(dataUrl);
    audio.onloadedmetadata = () => resolve(audio.duration);
    audio.onerror = () => reject(new Error("Chrome can't play that file. Try an MP3 or WAV."));
  });
  if (!(duration <= MAX_ALARM_SECONDS)) throw new Error("That clip is longer than 30 seconds. Pick a shorter one.");

  return dataUrl;
}

el.uploadAlarmBtn.addEventListener("click", () => el.alarmFileInput.click());

el.alarmFileInput.addEventListener("change", async () => {
  const file = el.alarmFileInput.files[0];
  el.alarmFileInput.value = ""; // so picking the same file again still fires "change"
  if (!file) return;
  try {
    const dataUrl = await readAlarmFile(file);
    await chrome.storage.local.set({ customAlarm: dataUrl, customAlarmName: file.name });
    showAlarmError("");
  } catch (e) {
    showAlarmError(e.message);
  }
});

el.resetAlarmBtn.addEventListener("click", () => {
  showAlarmError("");
  chrome.storage.local.remove(["customAlarm", "customAlarmName"]);
});

// --- Keywords -------------------------------------------------------

function addKeyword(value) {
  const next = addKeywordTo(settings.customKeywords, value);
  if (next) save("customKeywords", next);
}

function removeKeyword(kw) {
  save("customKeywords", settings.customKeywords.filter((k) => k !== kw));
}

function addFromInput() {
  addKeyword(el.keywordInput.value);
  el.keywordInput.value = "";
}

el.addKeywordBtn.addEventListener("click", addFromInput);
el.keywordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addFromInput();
  }
});

function renderSuggested() {
  el.suggestedContainer.innerHTML = "";
  for (const kw of SUGGESTED_KEYWORDS) {
    const added = hasKeywordIn(settings.customKeywords, kw);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.disabled = added;
    chip.setAttribute("aria-label", added ? kw + " already added" : "Add " + kw);
    chip.innerHTML = '<span class="chip-add-icon">' + (added ? "✓" : "+") + "</span><span>" + kw + "</span>";
    chip.addEventListener("click", () => addKeyword(kw));
    el.suggestedContainer.appendChild(chip);
  }
}

// --- Load + live sync -------------------------------------------------------

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const keys = Object.keys(changes).filter((k) => k in DEFAULTS);
  if (!keys.length) return;
  for (const k of keys) settings[k] = changes[k].newValue ?? DEFAULTS[k];
  render();
});

chrome.storage.local.get(DEFAULTS, (result) => {
  settings = result;
  render();
});
