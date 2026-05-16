/* global chrome, JobAutofillDefaults, JobAutofillEngine */

(function initContentScript() {
  "use strict";

  if (!globalThis.JobAutofillDefaults || !globalThis.JobAutofillEngine || !globalThis.chrome || !chrome.storage) {
    return;
  }

  const {
    STORAGE_KEYS,
    DEFAULT_PROFILE,
    DEFAULT_SETTINGS
  } = JobAutofillDefaults;
  const Engine = JobAutofillEngine;

  const APPLYING = new WeakSet();
  const pendingSuggestions = new Map();
  const pendingSaves = new Map();
  const dropdownAttemptLog = new Map();
  const CUSTOM_OPTION_SELECTOR = [
    "[role='option']",
    "[aria-selected]",
    ".ant-select-item-option",
    ".rc-select-item-option",
    ".select2-results__option",
    "[data-automation-id*='promptOption']",
    "[id*='option']",
    "[class*='option']"
  ].join(",");
  const PANEL_ID = "job-autofill-panel";
  const DROPDOWN_RETRY_BACKOFF_MS = 120000;
  const FIELD_TYPES_TO_SKIP = new Set([
    "button",
    "color",
    "file",
    "hidden",
    "image",
    "password",
    "reset",
    "submit"
  ]);

  let state = {
    enabled: false,
    profile: Engine.structuredCloneSafe(DEFAULT_PROFILE),
    settings: Engine.structuredCloneSafe(DEFAULT_SETTINGS),
    learnedAnswers: {},
    stats: { filledCount: 0, learnedCount: 0, lastRunAt: "" }
  };
  let observer = null;
  let fillTimer = 0;
  let hiddenUntilNextRun = false;
  let pagePaused = false;
  let runningAutofill = false;
  let suppressObserverUntil = 0;
  let lastCustomSelectInput = null;
  let lastReport = {
    filled: [],
    suggestions: [],
    skipped: [],
    learned: []
  };

  loadState().then(() => {
    bindMessages();
    bindLearning();
    bindObserver();
    if (state.enabled && state.settings.autofillOnLoad) {
      scheduleAutofill("page load", 250);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") {
      return;
    }
    let changed = false;
    if (changes[STORAGE_KEYS.enabled]) {
      state.enabled = Boolean(changes[STORAGE_KEYS.enabled].newValue);
      changed = true;
    }
    if (changes[STORAGE_KEYS.profile]) {
      state.profile = Engine.deepMerge(DEFAULT_PROFILE, changes[STORAGE_KEYS.profile].newValue);
      changed = true;
    }
    if (changes[STORAGE_KEYS.settings]) {
      state.settings = Engine.deepMerge(DEFAULT_SETTINGS, changes[STORAGE_KEYS.settings].newValue);
      changed = true;
    }
    if (changes[STORAGE_KEYS.learnedAnswers]) {
      state.learnedAnswers = changes[STORAGE_KEYS.learnedAnswers].newValue || {};
      changed = true;
    }
    if (state.enabled && changed && state.settings.autofillOnLoad) {
      scheduleAutofill("settings changed", 100);
    }
    if (!state.enabled) {
      removePanel();
    }
  });

  function bindMessages() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || !message.type) {
        return undefined;
      }
      if (message.type === "JOB_AUTOFILL_NOW") {
        pagePaused = false;
        performAutofill("manual request").then(sendResponse);
        return true;
      }
      if (message.type === "JOB_AUTOFILL_PAUSE_PAGE") {
        pauseThisPage();
        sendResponse({ ok: true });
        return undefined;
      }
      if (message.type === "JOB_AUTOFILL_STATUS") {
        sendResponse({
          enabled: state.enabled,
          report: lastReport,
          url: location.href
        });
        return undefined;
      }
      if (message.type === "JOB_AUTOFILL_CLEAR_HIGHLIGHTS") {
        clearHighlights();
        removePanel();
        sendResponse({ ok: true });
        return undefined;
      }
      return undefined;
    });
  }

  function bindLearning() {
    document.addEventListener("focusin", handleCustomSelectFocus, true);
    document.addEventListener("click", handleCustomOptionLearning, true);
    document.addEventListener("change", handlePossibleLearning, true);
    document.addEventListener("blur", handlePossibleLearning, true);
  }

  function bindObserver() {
    observer = new MutationObserver((mutations) => {
      if (!state.enabled || !state.settings.autofillOnLoad || pagePaused || runningAutofill || Date.now() < suppressObserverUntil) {
        return;
      }
      const hasNewFormFields = mutations.some((mutation) =>
        Array.from(mutation.addedNodes || []).some((node) =>
          node.nodeType === Node.ELEMENT_NODE &&
          (isFillable(node) || (node.querySelector && node.querySelector("input, select, textarea, [contenteditable='true']")))
        )
      );
      if (hasNewFormFields) {
        scheduleAutofill("new fields", 350);
      }
    });
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });
  }

  function loadState() {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        [
          STORAGE_KEYS.enabled,
          STORAGE_KEYS.profile,
          STORAGE_KEYS.settings,
          STORAGE_KEYS.learnedAnswers,
          STORAGE_KEYS.stats
        ],
        (stored) => {
          state = {
            enabled: Boolean(stored[STORAGE_KEYS.enabled]),
            profile: Engine.deepMerge(DEFAULT_PROFILE, stored[STORAGE_KEYS.profile]),
            settings: Engine.deepMerge(DEFAULT_SETTINGS, stored[STORAGE_KEYS.settings]),
            learnedAnswers: stored[STORAGE_KEYS.learnedAnswers] || {},
            stats: stored[STORAGE_KEYS.stats] || { filledCount: 0, learnedCount: 0, lastRunAt: "" }
          };
          resolve();
        }
      );
    });
  }

  function scheduleAutofill(reason, delay) {
    if (pagePaused) {
      return;
    }
    clearTimeout(fillTimer);
    fillTimer = setTimeout(() => performAutofill(reason), delay);
  }

  async function performAutofill(reason) {
    if (pagePaused || runningAutofill) {
      return {
        ok: true,
        reason,
        filledCount: 0,
        suggestionCount: 0,
        skippedCount: 0,
        paused: pagePaused
      };
    }

    runningAutofill = true;
    try {
      hiddenUntilNextRun = false;
      pendingSuggestions.clear();
      const fields = getCandidateFields();
      const forceRetry = isManualReason(reason);
      const report = {
        filled: [],
        suggestions: [],
        skipped: [],
        learned: []
      };

      for (const field of fields) {
        const analysis = Engine.analyzeElement(field, document);
        if (analysis.blocked) {
          report.skipped.push({
            label: analysis.label || fieldDescriptor(field),
            reason: analysis.blockedReason
          });
          continue;
        }

        if (hasExistingValue(field)) {
          continue;
        }

        const match = Engine.bestValueFor(analysis, state.profile, state.learnedAnswers);
        if (!match) {
          continue;
        }

        const shouldSuggest =
          !state.settings.fillKnownAnswersAutomatically &&
          (match.confidence < state.settings.minimumConfidence ||
            (match.sensitive && !state.settings.fillSensitiveAutomatically));

        if (shouldSuggest) {
          markSuggestion(field);
          const id = randomId();
          const suggestion = {
            id,
            field,
            label: friendlyLabel(analysis, field),
            value: match.value,
            sensitive: Boolean(match.sensitive),
            source: match.source
          };
          pendingSuggestions.set(id, suggestion);
          report.suggestions.push(stripElement(suggestion));
          continue;
        }

        if (shouldSkipDropdownRetry(field, analysis, match.value, forceRetry)) {
          report.skipped.push({
            label: friendlyLabel(analysis, field),
            reason: "Dropdown already tried. Press Fill to retry or choose it manually."
          });
          continue;
        }

        recordDropdownAttempt(field, analysis, match.value);
        const filled = await applyValue(field, match.value, analysis);
        if (filled) {
          report.filled.push({
            label: friendlyLabel(analysis, field),
            value: safeValueForReport(match.value),
            source: match.source,
            sensitive: Boolean(match.sensitive)
          });
        }
      }

      lastReport = report;
      if (report.filled.length) {
        persistStats(report.filled.length, 0);
      }
      renderPanel(reason, report);
      return {
        ok: true,
        reason,
        filledCount: report.filled.length,
        suggestionCount: report.suggestions.length,
        skippedCount: report.skipped.length
      };
    } finally {
      runningAutofill = false;
    }
  }

  function getCandidateFields() {
    return Array.from(document.querySelectorAll("input, select, textarea, [contenteditable='true']")).filter(isFillable);
  }

  function isFillable(element) {
    if (!element || element.id === PANEL_ID || (element.closest && element.closest(`#${PANEL_ID}`))) {
      return false;
    }
    if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement || element.isContentEditable)) {
      return false;
    }
    if (element.disabled || element.readOnly || element.getAttribute("aria-disabled") === "true") {
      return false;
    }
    const type = String(element.type || element.getAttribute("type") || "").toLowerCase();
    if (FIELD_TYPES_TO_SKIP.has(type)) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function hasExistingValue(element) {
    if (element instanceof HTMLInputElement && isCustomSelectInput(element)) {
      return Engine.hasValue(customSelectSelectedText(element));
    }
    if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) {
      if (element.type === "radio" && element.name) {
        return Array.from(document.querySelectorAll("input[type='radio']")).some((radio) => radio.name === element.name && radio.checked);
      }
      return element.checked;
    }
    if (element instanceof HTMLSelectElement) {
      const selected = element.options[element.selectedIndex];
      return Boolean(selected && selected.value && selected.value.trim() !== "");
    }
    if (element.isContentEditable) {
      return element.textContent.trim() !== "";
    }
    return String(element.value || "").trim() !== "";
  }

  async function applyValue(element, value, analysis) {
    const stringValue = String(value || "").trim();
    if (!stringValue) {
      return false;
    }

    if (element instanceof HTMLInputElement && element.type === "radio") {
      return applyRadioValue(element, stringValue, analysis);
    }

    if (element instanceof HTMLInputElement && element.type === "checkbox") {
      return applyCheckboxValue(element, stringValue);
    }

    if (element instanceof HTMLSelectElement) {
      return applySelectValue(element, stringValue);
    }

    if (element instanceof HTMLInputElement && isCustomSelectInput(element) && ["country", "state"].includes(analysis.key)) {
      return applyCustomComboboxValue(element, stringValue, analysis);
    }

    if (element.isContentEditable) {
      APPLYING.add(element);
      element.textContent = stringValue;
      dispatchInputEvents(element);
      setTimeout(() => APPLYING.delete(element), 0);
      markFilled(element);
      return true;
    }

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      APPLYING.add(element);
      setNativeValue(element, stringValue);
      dispatchInputEvents(element);
      setTimeout(() => APPLYING.delete(element), 0);
      markFilled(element);
      return true;
    }

    return false;
  }

  function applyRadioValue(element, value) {
    const radios = element.name
      ? Array.from(document.querySelectorAll("input[type='radio']")).filter((radio) => radio.name === element.name)
      : [element];
    const target = radios.find((radio) => Engine.optionMatches(optionText(radio), value));
    if (!target) {
      return false;
    }
    APPLYING.add(target);
    target.checked = true;
    dispatchInputEvents(target);
    setTimeout(() => APPLYING.delete(target), 0);
    markFilled(target);
    return true;
  }

  function applyCheckboxValue(element, value) {
    const text = optionText(element);
    const shouldCheck = Engine.optionMatches(text, value) || Engine.isPositive(value);
    const shouldUncheck = Engine.isNegative(value);
    if (!shouldCheck && !shouldUncheck) {
      return false;
    }
    APPLYING.add(element);
    element.checked = shouldCheck && !shouldUncheck;
    dispatchInputEvents(element);
    setTimeout(() => APPLYING.delete(element), 0);
    markFilled(element);
    return true;
  }

  function applySelectValue(element, value) {
    const options = Array.from(element.options || []);
    const match = options.find((option) => Engine.optionMatches(`${option.textContent} ${option.value}`, value));
    if (!match) {
      return false;
    }
    APPLYING.add(element);
    element.value = match.value;
    dispatchInputEvents(element);
    setTimeout(() => APPLYING.delete(element), 0);
    markFilled(element);
    return true;
  }

  async function applyCustomComboboxValue(element, value, analysis) {
    const plan = comboboxPlan(value, analysis.key);
    suppressObserver(1800);
    APPLYING.add(element);
    element.focus();
    element.click();

    for (const searchTerm of plan.searchTerms) {
      setNativeValue(element, searchTerm);
      dispatchInputEvents(element);
      dispatchKeyboardEvent(element, "ArrowDown");

      const option = await findCustomOptionWithRetries(plan.matchTerms);
      if (option) {
        option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        option.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        option.click();
        await wait(90);
        dispatchInputEvents(element);
        APPLYING.delete(element);
        markFilled(element);
        return true;
      }
    }

    setNativeValue(element, "");
    dispatchInputEvents(element);
    dispatchKeyboardEvent(element, "Escape");
    APPLYING.delete(element);
    return false;
  }

  async function findCustomOptionWithRetries(queries) {
    for (const delay of [120, 260, 520]) {
      await wait(delay);
      const option = findCustomOption(queries);
      if (option) {
        return option;
      }
    }
    return null;
  }

  function isCustomSelectInput(element) {
    const role = String(element.getAttribute("role") || "").toLowerCase();
    const id = String(element.id || "");
    const controls = element.getAttribute("aria-controls");
    const wrapper = element.closest("[class*='select'], [class*='Select'], [class*='dropdown'], [class*='Dropdown'], [role='combobox']");
    return role === "combobox" || Boolean(controls) || id.startsWith("rc_select") || Boolean(wrapper);
  }

  function comboboxPlan(value, key) {
    const aliases = Engine.aliasesFor(value);
    if (key === "state") {
      return {
        searchTerms: uniqueStrings(["B", "British Columbia", "BC"]),
        matchTerms: uniqueStrings(["British Columbia", "BC", "B.C.", ...aliases])
      };
    }
    if (key === "country") {
      return {
        searchTerms: uniqueStrings(["C", "Can", "Canada", "CA"]),
        matchTerms: uniqueStrings(["Canada", "CA", "CAN", ...aliases])
      };
    }
    return {
      searchTerms: uniqueStrings([value, ...aliases]),
      matchTerms: uniqueStrings([value, ...aliases])
    };
  }

  function findCustomOption(queries) {
    return Array.from(document.querySelectorAll(CUSTOM_OPTION_SELECTOR)).find((option) => {
      if (!isVisible(option)) {
        return false;
      }
      const text = `${option.textContent || ""} ${option.getAttribute("title") || ""} ${option.getAttribute("aria-label") || ""}`;
      return queries.some((query) => Engine.optionMatches(text, query));
    });
  }

  function handleCustomSelectFocus(event) {
    const element = event.target;
    if (element instanceof HTMLInputElement && isCustomSelectInput(element)) {
      lastCustomSelectInput = element;
    }
  }

  function handleCustomOptionLearning(event) {
    const option = event.target && event.target.closest && event.target.closest(CUSTOM_OPTION_SELECTOR);
    if (!option || !state.settings.learnFromManualInputs || !lastCustomSelectInput || APPLYING.has(lastCustomSelectInput)) {
      return;
    }

    const input = lastCustomSelectInput;
    window.setTimeout(async () => {
      if (APPLYING.has(input) || !document.contains(input)) {
        return;
      }

      const value = customSelectSelectedText(input) || customOptionText(option);
      if (!Engine.hasValue(value)) {
        return;
      }

      const analysis = Engine.analyzeElement(input, document);
      if (analysis.blocked || !analysis.memoryKey || analysis.confidence < 0.35) {
        return;
      }

      const sensitive = Boolean(analysis.sensitive);
      if (sensitive && state.settings.askBeforeSavingSensitive) {
        const id = randomId();
        pendingSaves.set(id, {
          id,
          label: friendlyLabel(analysis, input),
          value,
          analysis,
          sensitive: true
        });
        renderPanel("manual sensitive answer", lastReport);
        return;
      }

      await saveLearnedAnswer(analysis, value, sensitive);
    }, 240);
  }

  function customOptionText(option) {
    return `${option.textContent || ""} ${option.getAttribute("title") || ""} ${option.getAttribute("aria-label") || ""}`
      .replace(/\s+/g, " ")
      .trim();
  }

  function dispatchKeyboardEvent(element, key) {
    ["keydown", "keyup"].forEach((type) => {
      element.dispatchEvent(new KeyboardEvent(type, {
        bubbles: true,
        cancelable: true,
        key,
        code: key,
        view: window
      }));
    });
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function uniqueStrings(values) {
    const seen = new Set();
    return values
      .map((value) => String(value || "").trim())
      .filter((value) => {
        const key = Engine.normalize(value);
        if (!key || seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
  }

  function customSelectSelectedText(element) {
    const wrapper = element.closest("[class*='select'], [class*='Select'], [class*='dropdown'], [class*='Dropdown'], [role='combobox']");
    if (!wrapper) {
      return "";
    }
    const selectedNodes = wrapper.querySelectorAll([
      "[class*='selection-item']",
      "[class*='selected']",
      "[class*='value']",
      "[title]"
    ].join(","));
    const selectedText = Array.from(selectedNodes)
      .map((node) => `${node.textContent || ""} ${node.getAttribute("title") || ""}`.trim())
      .filter(Boolean)
      .join(" ");
    if (!selectedText) {
      return "";
    }
    const normalized = Engine.normalize(selectedText);
    if (!normalized || ["choose", "select", "search"].some((word) => normalized === word || normalized.includes(`${word}...`))) {
      return "";
    }
    return selectedText;
  }

  function shouldSkipDropdownRetry(element, analysis, value, forceRetry) {
    if (forceRetry || !isRetryLimitedDropdown(element)) {
      return false;
    }
    const signature = fillSignature(element, analysis, value);
    const attempt = dropdownAttemptLog.get(signature);
    return Boolean(attempt && attempt.count >= 1 && Date.now() - attempt.lastAt < DROPDOWN_RETRY_BACKOFF_MS);
  }

  function recordDropdownAttempt(element, analysis, value) {
    if (!isRetryLimitedDropdown(element)) {
      return;
    }
    const signature = fillSignature(element, analysis, value);
    const current = dropdownAttemptLog.get(signature) || { count: 0, lastAt: 0 };
    dropdownAttemptLog.set(signature, {
      count: current.count + 1,
      lastAt: Date.now()
    });
  }

  function isRetryLimitedDropdown(element) {
    return element instanceof HTMLSelectElement || (element instanceof HTMLInputElement && isCustomSelectInput(element));
  }

  function fillSignature(element, analysis, value) {
    return Engine.memoryKey([
      location.pathname,
      analysis && analysis.key,
      analysis && analysis.memoryKey,
      element.name,
      element.id,
      element.getAttribute("aria-label"),
      element.placeholder,
      value
    ].filter(Boolean).join(" | "));
  }

  function isManualReason(reason) {
    return /manual|review panel/i.test(String(reason || ""));
  }

  function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function suppressObserver(milliseconds) {
    suppressObserverUntil = Math.max(suppressObserverUntil, Date.now() + milliseconds);
  }

  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
  }

  function dispatchInputEvents(element) {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function optionText(element) {
    const label = element.id ? document.querySelector(`label[for="${Engine.cssEscape(element.id)}"]`) : null;
    const wrappingLabel = element.closest && element.closest("label");
    const parent = element.parentElement;
    return [
      label && label.textContent,
      wrappingLabel && wrappingLabel.textContent,
      parent && parent.textContent && parent.textContent.length < 240 ? parent.textContent : "",
      element.value,
      element.getAttribute("aria-label")
    ]
      .filter(Boolean)
      .join(" ");
  }

  async function handlePossibleLearning(event) {
    const element = event.target;
    if (!state.settings.learnFromManualInputs || APPLYING.has(element) || !isFillable(element)) {
      return;
    }
    const value = readValue(element);
    if (!Engine.hasValue(value)) {
      return;
    }

    const analysis = Engine.analyzeElement(element, document);
    if (analysis.blocked || !analysis.memoryKey || analysis.confidence < 0.35) {
      return;
    }

    const sensitive = Boolean(analysis.sensitive);
    if (sensitive && state.settings.askBeforeSavingSensitive) {
      const id = randomId();
      pendingSaves.set(id, {
        id,
        label: friendlyLabel(analysis, element),
        value,
        analysis,
        sensitive: true
      });
      renderPanel("manual sensitive answer", lastReport);
      return;
    }

    await saveLearnedAnswer(analysis, value, sensitive);
  }

  function readValue(element) {
    if (element instanceof HTMLInputElement && isCustomSelectInput(element)) {
      return customSelectSelectedText(element) || String(element.value || "").trim();
    }
    if (element instanceof HTMLInputElement && element.type === "checkbox") {
      return element.checked ? optionText(element) || "Yes" : "";
    }
    if (element instanceof HTMLInputElement && element.type === "radio") {
      return element.checked ? optionText(element) || element.value : "";
    }
    if (element instanceof HTMLSelectElement) {
      const selected = element.options[element.selectedIndex];
      return selected ? selected.textContent.trim() || selected.value : "";
    }
    if (element.isContentEditable) {
      return element.textContent.trim();
    }
    return String(element.value || "").trim();
  }

  function saveLearnedAnswer(analysis, value, sensitive) {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEYS.learnedAnswers], (stored) => {
        const learned = stored[STORAGE_KEYS.learnedAnswers] || {};
        const key = analysis.memoryKey;
        const existing = learned[key] || {};
        learned[key] = {
          key,
          label: analysis.label || existing.label || key,
          fieldKey: analysis.key || existing.fieldKey || "",
          value,
          sensitive: Boolean(sensitive),
          sourceHost: location.hostname,
          count: Number(existing.count || 0) + 1,
          updatedAt: new Date().toISOString()
        };
        chrome.storage.local.set({ [STORAGE_KEYS.learnedAnswers]: learned }, () => {
          state.learnedAnswers = learned;
          persistStats(0, 1);
          resolve();
        });
      });
    });
  }

  function persistStats(filledDelta, learnedDelta) {
    chrome.storage.local.get([STORAGE_KEYS.stats], (stored) => {
      const current = stored[STORAGE_KEYS.stats] || {};
      const next = {
        filledCount: Number(current.filledCount || 0) + filledDelta,
        learnedCount: Number(current.learnedCount || 0) + learnedDelta,
        lastRunAt: new Date().toISOString()
      };
      chrome.storage.local.set({ [STORAGE_KEYS.stats]: next });
      state.stats = next;
    });
  }

  function renderPanel(reason, report) {
    if (!state.settings.showReviewPanel || hiddenUntilNextRun) {
      return;
    }
    const filled = report.filled || [];
    const suggestions = report.suggestions || [];
    const skipped = report.skipped || [];
    const pendingSaveItems = Array.from(pendingSaves.values());

    if (!filled.length && !suggestions.length && !skipped.length && !pendingSaveItems.length) {
      return;
    }

    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement("aside");
      panel.id = PANEL_ID;
      panel.setAttribute("role", "region");
      panel.setAttribute("aria-label", "Job Autofill Copilot review");
      document.documentElement.appendChild(panel);
    }

    panel.innerHTML = `
      <div class="job-autofill-panel-header">
        <div class="job-autofill-panel-title">Job Autofill Copilot</div>
        <div class="job-autofill-panel-actions">
          <button class="job-autofill-panel-button" data-action="run">Fill</button>
          <button class="job-autofill-panel-button warn" data-action="pause">Pause</button>
          <button class="job-autofill-panel-button" data-action="hide">Hide</button>
        </div>
      </div>
      <p class="job-autofill-summary">${escapeHtml(summaryText(reason, filled, suggestions, skipped, pendingSaveItems))}</p>
      ${renderPendingSaves(pendingSaveItems)}
      ${renderSuggestions(suggestions)}
      ${renderFilled(filled)}
      ${renderSkipped(skipped)}
    `;

    panel.onclick = handlePanelClick;
  }

  function renderPendingSaves(items) {
    if (!items.length) {
      return "";
    }
    return `
      <div class="job-autofill-list">
        ${items.map((item) => `
          <div class="job-autofill-item">
            <strong>Save sensitive answer?</strong>
            <span>${escapeHtml(item.label)}: ${escapeHtml(safeValueForReport(item.value))}</span>
            <button class="job-autofill-panel-button warn" data-action="save" data-id="${escapeHtml(item.id)}">Save</button>
            <button class="job-autofill-panel-button" data-action="forget" data-id="${escapeHtml(item.id)}">Skip</button>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderSuggestions(items) {
    if (!items.length) {
      return "";
    }
    return `
      <div class="job-autofill-list">
        ${items.map((item) => `
          <div class="job-autofill-item">
            <strong>${item.sensitive ? "Sensitive field" : "Needs review"}</strong>
            <span>${escapeHtml(item.label)}: ${escapeHtml(item.value)}</span>
            <button class="job-autofill-panel-button primary" data-action="fill-one" data-id="${escapeHtml(item.id)}">Fill this</button>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderFilled(items) {
    if (!items.length) {
      return "";
    }
    return `
      <div class="job-autofill-list">
        ${items.slice(0, 8).map((item) => `
          <div class="job-autofill-item">
            <strong>Filled ${escapeHtml(item.label)}</strong>
            <span>${escapeHtml(item.value)} from ${escapeHtml(item.source)}</span>
          </div>
        `).join("")}
        ${items.length > 8 ? `<div class="job-autofill-empty">${items.length - 8} more filled fields hidden.</div>` : ""}
      </div>
    `;
  }

  function renderSkipped(items) {
    if (!items.length) {
      return "";
    }
    return `
      <div class="job-autofill-list">
        ${items.slice(0, 3).map((item) => `
          <div class="job-autofill-item">
            <strong>Skipped</strong>
            <span>${escapeHtml(item.label)}: ${escapeHtml(item.reason)}</span>
          </div>
        `).join("")}
      </div>
    `;
  }

  async function handlePanelClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }
    const action = button.dataset.action;
    const id = button.dataset.id;
    if (action === "pause") {
      pauseThisPage();
      return;
    }
    if (action === "hide") {
      hiddenUntilNextRun = true;
      removePanel();
      return;
    }
    if (action === "run") {
      await performAutofill("review panel");
      return;
    }
    if (action === "fill-one") {
      const suggestion = pendingSuggestions.get(id);
      if (suggestion && suggestion.field && applyValue(suggestion.field, suggestion.value, {})) {
        pendingSuggestions.delete(id);
        lastReport.filled.push({
          label: suggestion.label,
          value: safeValueForReport(suggestion.value),
          source: suggestion.source,
          sensitive: suggestion.sensitive
        });
        lastReport.suggestions = lastReport.suggestions.filter((item) => item.id !== id);
        persistStats(1, 0);
        renderPanel("manual suggestion", lastReport);
      }
      return;
    }
    if (action === "save") {
      const pending = pendingSaves.get(id);
      if (pending) {
        await saveLearnedAnswer(pending.analysis, pending.value, true);
        pendingSaves.delete(id);
        renderPanel("saved sensitive answer", lastReport);
      }
      return;
    }
    if (action === "forget") {
      pendingSaves.delete(id);
      renderPanel("skipped sensitive answer", lastReport);
    }
  }

  function pauseThisPage() {
    pagePaused = true;
    clearTimeout(fillTimer);
    pendingSuggestions.clear();
    pendingSaves.clear();
    removePanel();
  }

  function markFilled(element) {
    if (!state.settings.highlightFilledFields) {
      return;
    }
    element.classList.add("job-autofill-filled");
    element.dataset.jobAutofillFilled = "true";
  }

  function markSuggestion(element) {
    if (!state.settings.highlightFilledFields) {
      return;
    }
    element.classList.add("job-autofill-suggestion");
  }

  function clearHighlights() {
    document.querySelectorAll(".job-autofill-filled, .job-autofill-suggestion").forEach((element) => {
      element.classList.remove("job-autofill-filled", "job-autofill-suggestion");
      delete element.dataset.jobAutofillFilled;
    });
  }

  function removePanel() {
    const panel = document.getElementById(PANEL_ID);
    if (panel) {
      panel.remove();
    }
  }

  function summaryText(reason, filled, suggestions, skipped, pendingSaveItems) {
    const parts = [];
    if (filled.length) {
      parts.push(`${filled.length} filled`);
    }
    if (suggestions.length) {
      parts.push(`${suggestions.length} need review`);
    }
    if (pendingSaveItems.length) {
      parts.push(`${pendingSaveItems.length} waiting to save`);
    }
    if (skipped.length) {
      parts.push(`${skipped.length} intentionally skipped`);
    }
    return `${parts.join(", ") || "Nothing to fill yet"} after ${reason}.`;
  }

  function friendlyLabel(analysis, element) {
    const label = analysis && analysis.label ? analysis.label : fieldDescriptor(element);
    return label.length > 90 ? `${label.slice(0, 87)}...` : label;
  }

  function fieldDescriptor(element) {
    return [element.getAttribute("aria-label"), element.placeholder, element.name, element.id, element.type]
      .filter(Boolean)
      .join(" ")
      .trim() || "field";
  }

  function stripElement(suggestion) {
    return {
      id: suggestion.id,
      label: suggestion.label,
      value: safeValueForReport(suggestion.value),
      sensitive: suggestion.sensitive,
      source: suggestion.source
    };
  }

  function safeValueForReport(value) {
    const stringValue = String(value || "");
    return stringValue.length > 80 ? `${stringValue.slice(0, 77)}...` : stringValue;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function randomId() {
    return Math.random().toString(36).slice(2, 10);
  }
})();
