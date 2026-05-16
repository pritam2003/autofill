/* global chrome, JobAutofillDefaults, JobAutofillEngine */

(function initPopup() {
  "use strict";

  const { STORAGE_KEYS, DEFAULT_PROFILE, DEFAULT_SETTINGS } = JobAutofillDefaults;
  const { deepMerge } = JobAutofillEngine;

  const enabledInput = document.getElementById("enabled");
  const statusElement = document.getElementById("status");
  const statsElement = document.getElementById("stats");
  const fillNowButton = document.getElementById("fillNow");
  const pausePageButton = document.getElementById("pausePage");
  const clearMarksButton = document.getElementById("clearMarks");
  const openOptionsButton = document.getElementById("openOptions");

  boot();

  function boot() {
    chrome.storage.local.get(
      [
        STORAGE_KEYS.enabled,
        STORAGE_KEYS.profile,
        STORAGE_KEYS.settings,
        STORAGE_KEYS.learnedAnswers,
        STORAGE_KEYS.stats
      ],
      (stored) => {
        const settings = deepMerge(DEFAULT_SETTINGS, stored[STORAGE_KEYS.settings]);
        const profile = deepMerge(DEFAULT_PROFILE, stored[STORAGE_KEYS.profile]);
        const learned = stored[STORAGE_KEYS.learnedAnswers] || {};
        const stats = stored[STORAGE_KEYS.stats] || {};
        enabledInput.checked = Boolean(stored[STORAGE_KEYS.enabled]);
        statusElement.textContent = buildStatus(profile, learned, settings, enabledInput.checked);
        statsElement.textContent = buildStats(stats);
      }
    );
  }

  enabledInput.addEventListener("change", () => {
    chrome.storage.local.set({ [STORAGE_KEYS.enabled]: enabledInput.checked }, () => {
      boot();
      if (enabledInput.checked) {
        sendToActiveTab({ type: "JOB_AUTOFILL_NOW" });
      }
    });
  });

  fillNowButton.addEventListener("click", () => {
    fillNowButton.disabled = true;
    sendToActiveTab({ type: "JOB_AUTOFILL_NOW" }, (response) => {
      fillNowButton.disabled = false;
      if (!response || !response.ok) {
        statusElement.textContent = "Could not reach this tab. Refresh the page after loading the extension, then try again.";
        return;
      }
      statusElement.textContent = `${response.filledCount} fields filled automatically, ${response.suggestionCount} suggestions need review, ${response.skippedCount} unsafe fields skipped.`;
    });
  });

  clearMarksButton.addEventListener("click", () => {
    sendToActiveTab({ type: "JOB_AUTOFILL_CLEAR_HIGHLIGHTS" }, () => {
      statusElement.textContent = "Marks cleared on this page.";
    });
  });

  pausePageButton.addEventListener("click", () => {
    sendToActiveTab({ type: "JOB_AUTOFILL_PAUSE_PAGE" }, () => {
      statusElement.textContent = "Autofill is paused on this page. Press Autofill this page to resume once.";
    });
  });

  openOptionsButton.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  function sendToActiveTab(message, callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        if (callback) {
          callback(null);
        }
        return;
      }
      chrome.tabs.sendMessage(tab.id, message, (response) => {
        if (chrome.runtime.lastError) {
          if (callback) {
            callback(null);
          }
          return;
        }
        if (callback) {
          callback(response);
        }
      });
    });
  }

  function buildStatus(profile, learned, settings, enabled) {
    const profileCount = countFilledValues(profile);
    const learnedCount = Object.keys(learned).length;
    const mode = enabled ? "Autofill is on." : "Autofill is off.";
    const fillMode = settings.fillKnownAnswersAutomatically
      ? "Saved answers fill automatically."
      : "Review mode is on for uncertain answers.";
    const overwriteMode = settings.overwriteExistingValues
      ? "Existing values are overwritten."
      : "Existing values are preserved.";
    return `${mode} ${profileCount} profile values and ${learnedCount} learned answers are available. ${fillMode} ${overwriteMode}`;
  }

  function buildStats(stats) {
    if (!stats || !stats.lastRunAt) {
      return "No runs yet";
    }
    const date = new Date(stats.lastRunAt);
    return `${Number(stats.filledCount || 0)} total fills, ${Number(stats.learnedCount || 0)} learned answers. Last run ${date.toLocaleString()}.`;
  }

  function countFilledValues(value) {
    if (!value || typeof value !== "object") {
      return value ? 1 : 0;
    }
    return Object.values(value).reduce((count, item) => count + countFilledValues(item), 0);
  }
})();
