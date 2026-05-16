/* global chrome, JobAutofillDefaults, JobAutofillEngine */

(function initOptions() {
  "use strict";

  const {
    STORAGE_KEYS,
    DEFAULT_PROFILE,
    DEFAULT_SETTINGS,
    PROFILE_FIELDS
  } = JobAutofillDefaults;
  const Engine = JobAutofillEngine;

  const profileForm = document.getElementById("profileForm");
  const saveStatus = document.getElementById("saveStatus");
  const memoryList = document.getElementById("memoryList");
  const addMemoryForm = document.getElementById("addMemoryForm");
  const minimumConfidence = document.getElementById("minimumConfidence");
  const minimumConfidenceValue = document.getElementById("minimumConfidenceValue");
  const settingIds = [
    "autofillOnLoad",
    "fillKnownAnswersAutomatically",
    "highlightFilledFields",
    "showReviewPanel",
    "learnFromManualInputs",
    "askBeforeSavingSensitive",
    "fillSensitiveAutomatically",
    "minimumConfidence"
  ];

  let profile = Engine.structuredCloneSafe(DEFAULT_PROFILE);
  let settings = Engine.structuredCloneSafe(DEFAULT_SETTINGS);
  let learnedAnswers = {};
  let saveTimer = 0;

  boot();

  function boot() {
    chrome.storage.local.get(
      [STORAGE_KEYS.profile, STORAGE_KEYS.settings, STORAGE_KEYS.learnedAnswers],
      (stored) => {
        profile = Engine.deepMerge(DEFAULT_PROFILE, stored[STORAGE_KEYS.profile]);
        settings = Engine.deepMerge(DEFAULT_SETTINGS, stored[STORAGE_KEYS.settings]);
        learnedAnswers = stored[STORAGE_KEYS.learnedAnswers] || {};
        renderProfile();
        renderSettings();
        renderMemory();
      }
    );
  }

  function renderProfile() {
    profileForm.innerHTML = PROFILE_FIELDS.map((section) => `
      <section class="profile-section ${section.sensitive ? "sensitive" : ""}">
        <h2>${escapeHtml(section.title)}</h2>
        <p class="section-description">${escapeHtml(section.description)}</p>
        <div class="field-list">
          ${section.fields.map(renderField).join("")}
        </div>
      </section>
    `).join("");

    profileForm.addEventListener("input", handleProfileInput);
    profileForm.addEventListener("change", handleProfileInput);
  }

  function renderField(field) {
    const value = Engine.getByPath(profile, field.path) || "";
    if (field.type === "textarea") {
      return `
        <label class="field">
          <span>${escapeHtml(field.label)}</span>
          <textarea data-path="${escapeHtml(field.path)}">${escapeHtml(value)}</textarea>
        </label>
      `;
    }
    if (field.type === "select") {
      return `
        <label class="field">
          <span>${escapeHtml(field.label)}</span>
          <select data-path="${escapeHtml(field.path)}">
            ${(field.options || ["", "Yes", "No"]).map((option) => `
              <option value="${escapeHtml(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option || "Choose...")}</option>
            `).join("")}
          </select>
        </label>
      `;
    }
    return `
      <label class="field">
        <span>${escapeHtml(field.label)}</span>
        <input data-path="${escapeHtml(field.path)}" type="${escapeHtml(field.type || "text")}" autocomplete="${escapeHtml(field.autocomplete || "off")}" value="${escapeHtml(value)}">
      </label>
    `;
  }

  function renderSettings() {
    settingIds.forEach((id) => {
      const input = document.getElementById(id);
      if (!input) {
        return;
      }
      if (input.type === "checkbox") {
        input.checked = Boolean(settings[id]);
      } else {
        input.value = settings[id];
      }
      input.addEventListener("input", handleSettingInput);
      input.addEventListener("change", handleSettingInput);
    });
    minimumConfidenceValue.textContent = Number(settings.minimumConfidence).toFixed(2);
  }

  function renderMemory() {
    const rows = Object.values(learnedAnswers).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    if (!rows.length) {
      memoryList.innerHTML = `<p class="empty-memory">No learned answers yet. Fill a new question on a job form, or add one here.</p>`;
      return;
    }

    memoryList.innerHTML = rows.map((item) => `
      <article class="memory-item" data-key="${escapeHtml(item.key)}">
        <strong>${escapeHtml(item.label || item.key)}</strong>
        <input type="text" value="${escapeHtml(item.value || "")}" data-memory-value="${escapeHtml(item.key)}">
        ${item.sensitive ? `<span class="pill">Sensitive</span>` : `<span></span>`}
        <button type="button" data-delete-memory="${escapeHtml(item.key)}">Delete</button>
      </article>
    `).join("");
  }

  function handleProfileInput(event) {
    const target = event.target;
    const path = target && target.dataset && target.dataset.path;
    if (!path) {
      return;
    }
    Engine.setByPath(profile, path, target.value);
    queueSave();
  }

  function handleSettingInput(event) {
    const target = event.target;
    if (!target || !settingIds.includes(target.id)) {
      return;
    }
    settings[target.id] = target.type === "checkbox" ? target.checked : Number(target.value);
    minimumConfidenceValue.textContent = Number(settings.minimumConfidence).toFixed(2);
    queueSave();
  }

  memoryList.addEventListener("input", (event) => {
    const key = event.target && event.target.dataset && event.target.dataset.memoryValue;
    if (!key || !learnedAnswers[key]) {
      return;
    }
    learnedAnswers[key].value = event.target.value;
    learnedAnswers[key].updatedAt = new Date().toISOString();
    queueSave();
  });

  memoryList.addEventListener("click", (event) => {
    const key = event.target && event.target.dataset && event.target.dataset.deleteMemory;
    if (!key) {
      return;
    }
    delete learnedAnswers[key];
    renderMemory();
    queueSave();
  });

  addMemoryForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const question = document.getElementById("memoryQuestion").value.trim();
    const answer = document.getElementById("memoryAnswer").value.trim();
    const sensitive = document.getElementById("memorySensitive").checked;
    if (!question || !answer) {
      setStatus("Add both a question and answer.");
      return;
    }
    const key = Engine.memoryKey(question);
    learnedAnswers[key] = {
      key,
      label: question,
      fieldKey: "",
      value: answer,
      sensitive,
      sourceHost: "manual",
      count: 1,
      updatedAt: new Date().toISOString()
    };
    addMemoryForm.reset();
    renderMemory();
    queueSave();
  });

  document.getElementById("exportData").addEventListener("click", () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      profile,
      settings,
      learnedAnswers
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "job-autofill-copilot-data.json";
    link.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("importData").addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result);
        profile = Engine.deepMerge(DEFAULT_PROFILE, payload.profile || {});
        settings = Engine.deepMerge(DEFAULT_SETTINGS, payload.settings || {});
        learnedAnswers = payload.learnedAnswers || {};
        saveNow();
        renderProfile();
        renderSettings();
        renderMemory();
        setStatus("Imported data.");
      } catch (error) {
        setStatus("Import failed. Use a JSON export from this extension.");
      }
    };
    reader.readAsText(file);
  });

  document.getElementById("resetData").addEventListener("click", () => {
    const confirmed = confirm("Reset profile, settings, and learned answers?");
    if (!confirmed) {
      return;
    }
    profile = Engine.structuredCloneSafe(DEFAULT_PROFILE);
    settings = Engine.structuredCloneSafe(DEFAULT_SETTINGS);
    learnedAnswers = {};
    saveNow();
    renderProfile();
    renderSettings();
    renderMemory();
  });

  function queueSave() {
    setStatus("Saving...");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 250);
  }

  function saveNow() {
    chrome.storage.local.set(
      {
        [STORAGE_KEYS.profile]: profile,
        [STORAGE_KEYS.settings]: settings,
        [STORAGE_KEYS.learnedAnswers]: learnedAnswers
      },
      () => setStatus("Saved.")
    );
  }

  function setStatus(message) {
    saveStatus.textContent = message;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
