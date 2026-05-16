/* global chrome, JobAutofillDefaults, JobAutofillEngine */

try {
  importScripts("defaults.js", "field-engine.js");
} catch (error) {
  console.warn("Job Autofill Copilot could not import shared scripts.", error);
}

const { STORAGE_KEYS, DEFAULT_PROFILE, DEFAULT_SETTINGS } = JobAutofillDefaults;
const { deepMerge } = JobAutofillEngine;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(
    [
      STORAGE_KEYS.enabled,
      STORAGE_KEYS.profile,
      STORAGE_KEYS.settings,
      STORAGE_KEYS.learnedAnswers,
      STORAGE_KEYS.stats
    ],
    (existing) => {
      const patch = {};
      if (existing[STORAGE_KEYS.enabled] === undefined) {
        patch[STORAGE_KEYS.enabled] = false;
      }
      patch[STORAGE_KEYS.profile] = deepMerge(DEFAULT_PROFILE, existing[STORAGE_KEYS.profile]);
      patch[STORAGE_KEYS.settings] = deepMerge(DEFAULT_SETTINGS, existing[STORAGE_KEYS.settings]);
      if (!existing[STORAGE_KEYS.learnedAnswers]) {
        patch[STORAGE_KEYS.learnedAnswers] = {};
      }
      if (!existing[STORAGE_KEYS.stats]) {
        patch[STORAGE_KEYS.stats] = { filledCount: 0, learnedCount: 0, lastRunAt: "" };
      }
      chrome.storage.local.set(patch, updateBadge);
    }
  );
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEYS.enabled]) {
    updateBadge();
  }
});

function updateBadge() {
  chrome.storage.local.get([STORAGE_KEYS.enabled], (state) => {
    const enabled = Boolean(state[STORAGE_KEYS.enabled]);
    chrome.action.setBadgeText({ text: enabled ? "ON" : "" });
    chrome.action.setBadgeBackgroundColor({ color: enabled ? "#16794c" : "#6b7280" });
  });
}
