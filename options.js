// options.js — full settings page. Reads/writes the same chrome.storage.local
// keys as popup.js, so both stay in sync automatically via storage.onChanged.

const DEFAULTS = {
  enabled: true,
  customKeywords: [],
  sensitivity: "normal",
  alertThreshold: 2.5,
};

const SUGGESTED_KEYWORDS = ["Yes", "Y", "Available", "Here", "Ready"];

const el = {
  masterToggle: document.getElementById("masterToggle"),
  segmentedPills: Array.from(document.querySelectorAll(".segmented-pill")),
  thresholdSlider: document.getElementById("thresholdSlider"),
  thresholdValue: document.getElementById("thresholdValue"),
  chipsContainer: document.getElementById("chipsContainer"),
  suggestedContainer: document.getElementById("suggestedContainer"),
  keywordInput: document.getElementById("keywordInput"),
  addKeywordBtn: document.getElementById("addKeywordBtn"),
  uploadSoundBtn: document.getElementById("uploadSoundBtn"),
  comingSoonModal: document.getElementById("comingSoonModal"),
  closeModalBtn: document.getElementById("closeModalBtn"),
};

let settings = { ...DEFAULTS };

function load() {
  chrome.storage.local.get(DEFAULTS, (result) => {
    settings = { ...DEFAULTS, ...result };
    renderToggle();
    renderSensitivity();
    renderThreshold();
    renderChips();
    renderSuggested();
  });
}

// --- Master toggle ---------------------------------------------------

function renderToggle() {
  el.masterToggle.setAttribute("aria-checked", String(settings.enabled));
}

el.masterToggle.addEventListener("click", () => {
  settings.enabled = !settings.enabled;
  chrome.storage.local.set({ enabled: settings.enabled });
  renderToggle();
});

// --- Sensitivity -------------------------------------------------------

function renderSensitivity() {
  for (const pill of el.segmentedPills) {
    pill.setAttribute("aria-checked", String(pill.dataset.value === settings.sensitivity));
  }
}

for (const pill of el.segmentedPills) {
  pill.addEventListener("click", () => {
    settings.sensitivity = pill.dataset.value;
    chrome.storage.local.set({ sensitivity: settings.sensitivity });
    renderSensitivity();
  });
}

// --- Alert threshold -------------------------------------------------------

function renderThreshold() {
  el.thresholdSlider.value = settings.alertThreshold;
  el.thresholdValue.textContent = Number(settings.alertThreshold).toFixed(1);
}

el.thresholdSlider.addEventListener("input", () => {
  el.thresholdValue.textContent = Number(el.thresholdSlider.value).toFixed(1);
});

el.thresholdSlider.addEventListener("change", () => {
  settings.alertThreshold = Number(el.thresholdSlider.value);
  chrome.storage.local.set({ alertThreshold: settings.alertThreshold });
});

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

function hasKeyword(kw) {
  return settings.customKeywords.some((k) => k.toLowerCase() === kw.toLowerCase());
}

function addKeywordValue(value) {
  const trimmed = value.trim();
  if (!trimmed || hasKeyword(trimmed)) return;
  settings.customKeywords = [...settings.customKeywords, trimmed];
  chrome.storage.local.set({ customKeywords: settings.customKeywords });
  renderChips();
  renderSuggested();
}

function removeKeyword(kw) {
  settings.customKeywords = settings.customKeywords.filter((k) => k !== kw);
  chrome.storage.local.set({ customKeywords: settings.customKeywords });
  renderChips();
  renderSuggested();
}

el.addKeywordBtn.addEventListener("click", () => {
  addKeywordValue(el.keywordInput.value);
  el.keywordInput.value = "";
});
el.keywordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addKeywordValue(el.keywordInput.value);
    el.keywordInput.value = "";
  }
});

// --- Suggested keywords -------------------------------------------------------

function renderSuggested() {
  el.suggestedContainer.innerHTML = "";
  for (const kw of SUGGESTED_KEYWORDS) {
    const added = hasKeyword(kw);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.added = String(added);
    chip.disabled = added;
    chip.setAttribute("aria-label", added ? kw + " already added" : "Add " + kw);
    chip.innerHTML =
      '<span class="chip-add-icon">' + (added ? "✓" : "+") + "</span><span>" + kw + "</span>";
    chip.addEventListener("click", () => addKeywordValue(kw));
    el.suggestedContainer.appendChild(chip);
  }
}

// --- Alarm sound placeholder -------------------------------------------------------

el.uploadSoundBtn.addEventListener("click", () => {
  el.comingSoonModal.hidden = false;
  el.closeModalBtn.focus();
});

el.closeModalBtn.addEventListener("click", () => {
  el.comingSoonModal.hidden = true;
  el.uploadSoundBtn.focus();
});

el.comingSoonModal.addEventListener("click", (e) => {
  if (e.target === el.comingSoonModal) el.comingSoonModal.hidden = true;
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !el.comingSoonModal.hidden) {
    el.comingSoonModal.hidden = true;
  }
});

// --- Live sync if popup changes something while this page is open ---------

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.enabled) {
    settings.enabled = changes.enabled.newValue;
    renderToggle();
  }
  if (changes.sensitivity) {
    settings.sensitivity = changes.sensitivity.newValue;
    renderSensitivity();
  }
  if (changes.alertThreshold) {
    settings.alertThreshold = changes.alertThreshold.newValue;
    renderThreshold();
  }
  if (changes.customKeywords) {
    settings.customKeywords = changes.customKeywords.newValue || [];
    renderChips();
    renderSuggested();
  }
});

load();
