// keywords.js — custom keyword helpers shared by popup.js and options.js, so
// both pages add, dedupe and display keywords exactly the same way.

function hasKeywordIn(keywords, value) {
  return keywords.some((k) => k.toLowerCase() === value.toLowerCase());
}

// Returns the new list, or null when the value is blank or already there
// (case-insensitive).
function addKeywordTo(keywords, value) {
  const trimmed = value.trim();
  if (!trimmed || hasKeywordIn(keywords, trimmed)) return null;
  return [...keywords, trimmed];
}

function renderKeywordChips(container, keywords, onRemove) {
  container.innerHTML = "";
  for (const kw of keywords) {
    const chip = document.createElement("span");
    chip.className = "chip";
    const label = document.createElement("span");
    label.textContent = kw;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "chip-remove";
    removeBtn.setAttribute("aria-label", "Remove " + kw);
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => onRemove(kw));
    chip.appendChild(label);
    chip.appendChild(removeBtn);
    container.appendChild(chip);
  }
}
