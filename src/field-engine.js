(function initFieldEngine(root) {
  "use strict";

  let defaults = root.JobAutofillDefaults;
  if (!defaults && typeof require === "function") {
    defaults = require("./defaults.js");
  }

  const {
    DEFAULT_PROFILE,
    FIELD_DEFINITIONS,
    NEVER_FILL_PATTERNS,
    SENSITIVE_KEYS,
    BOOLEAN_YES,
    BOOLEAN_NO
  } = defaults;

  const VALUE_ALIASES = [
    ["canada", ["canada", "can", "ca", "canadian"]],
    ["british columbia", ["british columbia", "bc", "b c", "b c canada"]]
  ];

  function normalize(value) {
    return String(value || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_\-./]+/g, " ")
      .replace(/([,?*:;()[\]{}])/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function memoryKey(value) {
    return normalize(value).replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  }

  function getByPath(object, path) {
    return String(path || "")
      .split(".")
      .filter(Boolean)
      .reduce((current, part) => (current && current[part] !== undefined ? current[part] : undefined), object);
  }

  function setByPath(object, path, value) {
    const parts = String(path || "").split(".").filter(Boolean);
    let current = object;
    parts.slice(0, -1).forEach((part) => {
      if (!current[part] || typeof current[part] !== "object") {
        current[part] = {};
      }
      current = current[part];
    });
    current[parts[parts.length - 1]] = value;
    return object;
  }

  function deepMerge(base, override) {
    if (!override || typeof override !== "object") {
      return structuredCloneSafe(base);
    }
    const output = structuredCloneSafe(base);
    Object.keys(override).forEach((key) => {
      if (override[key] && typeof override[key] === "object" && !Array.isArray(override[key])) {
        output[key] = deepMerge(output[key] || {}, override[key]);
      } else {
        output[key] = override[key];
      }
    });
    return output;
  }

  function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function includesAny(text, patterns) {
    return patterns.some((pattern) => normalize(text).includes(normalize(pattern)));
  }

  function scoreDefinition(text, fieldType, definition) {
    const normalizedText = normalize(text);
    if (!normalizedText) {
      return 0;
    }
    if (definition.antiPatterns && includesAny(normalizedText, definition.antiPatterns)) {
      return 0;
    }

    let score = 0;
    if (definition.inputTypes && fieldType && definition.inputTypes.includes(fieldType)) {
      score = Math.max(score, 0.84);
    }

    definition.patterns.forEach((pattern) => {
      const normalizedPattern = normalize(pattern);
      if (!normalizedPattern) {
        return;
      }
      if (normalizedText === normalizedPattern) {
        score = Math.max(score, 0.98);
      } else if (normalizedText.includes(normalizedPattern)) {
        const density = normalizedPattern.length / Math.max(normalizedText.length, 1);
        score = Math.max(score, Math.min(0.95, 0.72 + density * 0.22));
      }
    });

    return score;
  }

  function inferFromText(text, options) {
    const opts = options || {};
    const fieldType = normalize(opts.fieldType || opts.inputType || "");
    const normalizedText = normalize(text);
    const blockedPattern = NEVER_FILL_PATTERNS.find((pattern) => normalizedText.includes(normalize(pattern)));
    if (blockedPattern) {
      return {
        key: "",
        profilePath: "",
        confidence: 1,
        sensitive: true,
        blocked: true,
        blockedReason: `Refusing to fill ${blockedPattern}`,
        label: String(text || ""),
        normalizedLabel: normalizedText,
        memoryKey: memoryKey(text)
      };
    }

    const forcedEmailDefinition = emailDefinitionFor(normalizedText, fieldType);
    if (forcedEmailDefinition) {
      return {
        ...forcedEmailDefinition,
        confidence: 0.99,
        label: String(text || ""),
        normalizedLabel: normalizedText,
        memoryKey: memoryKey(text),
        sensitive: false,
        blocked: false
      };
    }

    let best = null;
    FIELD_DEFINITIONS.forEach((definition) => {
      const confidence = scoreDefinition(normalizedText, fieldType, definition);
      if (!best || confidence > best.confidence) {
        best = {
          ...definition,
          confidence,
          label: String(text || ""),
          normalizedLabel: normalizedText,
          memoryKey: memoryKey(text),
          sensitive: Boolean(definition.sensitive || SENSITIVE_KEYS.includes(definition.key)),
          blocked: false
        };
      }
    });

    if (!best || best.confidence < 0.38) {
      return {
        key: "",
        profilePath: "",
        confidence: 0,
        sensitive: false,
        blocked: false,
        label: String(text || ""),
        normalizedLabel: normalizedText,
        memoryKey: memoryKey(text)
      };
    }

    return best;
  }

  function emailDefinitionFor(normalizedText, fieldType) {
    if (fieldType !== "email" && !normalizedText.includes("email")) {
      return null;
    }

    const coopPatterns = [
      "co op",
      "coop",
      "co-op",
      "cooperative education",
      "school email",
      "student email",
      "university email"
    ];
    const workPatterns = [
      "work email",
      "business email",
      "company email",
      "corporate email",
      "employer email"
    ];

    if (includesAny(normalizedText, coopPatterns)) {
      return FIELD_DEFINITIONS.find((definition) => definition.key === "coopEmail");
    }
    if (includesAny(normalizedText, workPatterns)) {
      return FIELD_DEFINITIONS.find((definition) => definition.key === "workEmail");
    }
    return null;
  }

  function textFromElement(element, doc) {
    if (!element) {
      return "";
    }

    const ownerDocument = doc || element.ownerDocument || document;
    const directBits = [];
    const fallbackBits = [];
    const attributes = ["aria-label", "placeholder", "name", "id", "autocomplete", "title"];
    attributes.forEach((attribute) => {
      const value = element.getAttribute && element.getAttribute(attribute);
      if (value) {
        directBits.push(value);
      }
    });

    const labelledBy = element.getAttribute && element.getAttribute("aria-labelledby");
    if (labelledBy) {
      labelledBy.split(/\s+/).forEach((id) => {
        const labelledElement = ownerDocument.getElementById(id);
        if (labelledElement) {
          directBits.push(labelledElement.textContent || "");
        }
      });
    }

    const id = element.id;
    if (id && ownerDocument.querySelector) {
      const label = ownerDocument.querySelector(`label[for="${cssEscape(id)}"]`);
      if (label) {
        directBits.push(label.textContent || "");
      }
    }

    const wrappingLabel = element.closest && element.closest("label");
    if (wrappingLabel) {
      directBits.push(wrappingLabel.textContent || "");
    }

    const fieldset = element.closest && element.closest("fieldset");
    if (fieldset) {
      const legend = fieldset.querySelector && fieldset.querySelector("legend");
      if (legend) {
        fallbackBits.push(legend.textContent || "");
      }
    }

    const parent = element.parentElement;
    if (parent) {
      const labelLike = parent.querySelector && parent.querySelector(".label, [class*='label'], [data-automation-id*='label']");
      if (labelLike) {
        fallbackBits.push(labelLike.textContent || "");
      }
      if (parent.textContent && parent.textContent.length < 240) {
        fallbackBits.push(parent.textContent);
      }
    }

    const previous = element.previousElementSibling;
    if (previous && previous.textContent && previous.textContent.length < 160) {
      fallbackBits.push(previous.textContent);
    }

    const directText = dedupeWords(directBits.join(" "));
    if (directText) {
      return directText;
    }
    return dedupeWords(fallbackBits.join(" "));
  }

  function dedupeWords(value) {
    const seen = new Set();
    return String(value || "")
      .split(/\s+/)
      .filter((word) => {
        const normalizedWord = normalize(word);
        if (!normalizedWord || seen.has(normalizedWord)) {
          return false;
        }
        seen.add(normalizedWord);
        return true;
      })
      .join(" ");
  }

  function analyzeElement(element, doc) {
    const inputType = normalize(element && (element.type || element.getAttribute && element.getAttribute("type")));
    const text = textFromElement(element, doc);
    return inferFromText(text, { inputType });
  }

  function getProfileValue(profile, analysis) {
    if (!analysis || !analysis.profilePath) {
      return "";
    }
    const profileValue = getByPath(profile, analysis.profilePath);
    if (hasValue(profileValue)) {
      return profileValue;
    }
    if (analysis.key === "state" || analysis.key === "country") {
      return getByPath(DEFAULT_PROFILE, analysis.profilePath) || "";
    }
    return "";
  }

  function bestValueFor(analysis, profile, learnedAnswers) {
    if (!analysis || analysis.blocked) {
      return null;
    }

    const profileValue = getProfileValue(profile, analysis);
    if (hasValue(profileValue)) {
      return {
        value: profileValue,
        source: "profile",
        sensitive: Boolean(analysis.sensitive),
        confidence: analysis.confidence
      };
    }

    const learned = learnedAnswers && learnedAnswers[analysis.memoryKey];
    if (learned && hasValue(learned.value)) {
      return {
        value: learned.value,
        source: "learned",
        sensitive: Boolean(learned.sensitive || analysis.sensitive),
        confidence: Math.max(analysis.confidence, 0.74)
      };
    }

    return null;
  }

  function hasValue(value) {
    return value !== undefined && value !== null && String(value).trim() !== "";
  }

  function optionMatches(optionText, value) {
    const option = normalize(optionText);
    const desired = normalize(value);
    if (!option || !desired) {
      return false;
    }
    const desiredAliases = aliasesFor(desired);
    if (desiredAliases.some((alias) => option === alias || containsPhrase(option, alias))) {
      return true;
    }
    if (desired.length > 4 && desiredAliases.some((alias) => alias.length > 4 && containsPhrase(alias, option))) {
      return true;
    }
    if (BOOLEAN_YES.includes(desired) && ["yes", "true", "i agree"].some((word) => containsPhrase(option, word))) {
      return true;
    }
    if (BOOLEAN_NO.includes(desired) && ["no", "false", "decline"].some((word) => containsPhrase(option, word))) {
      return true;
    }
    return false;
  }

  function aliasesFor(value) {
    const normalizedValue = normalize(value);
    const aliases = new Set([normalizedValue]);
    VALUE_ALIASES.forEach(([, values]) => {
      const normalizedAliases = values.map(normalize);
      if (normalizedAliases.includes(normalizedValue)) {
        normalizedAliases.forEach((alias) => aliases.add(alias));
      }
    });
    return Array.from(aliases).filter(Boolean);
  }

  function containsPhrase(text, phrase) {
    const normalizedText = ` ${normalize(text)} `;
    const normalizedPhrase = ` ${normalize(phrase)} `;
    return normalizedText.includes(normalizedPhrase);
  }

  function isPositive(value) {
    return BOOLEAN_YES.some((word) => normalize(value) === word || normalize(value).includes(word));
  }

  function isNegative(value) {
    return BOOLEAN_NO.some((word) => normalize(value) === word || normalize(value).includes(word));
  }

  function cssEscape(value) {
    if (root.CSS && typeof root.CSS.escape === "function") {
      return root.CSS.escape(value);
    }
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  const exported = {
    analyzeElement,
    bestValueFor,
    cssEscape,
    deepMerge,
    getByPath,
    getProfileValue,
    hasValue,
    inferFromText,
    isNegative,
    isPositive,
    memoryKey,
    normalize,
    optionMatches,
    aliasesFor,
    setByPath,
    structuredCloneSafe,
    textFromElement
  };

  root.JobAutofillEngine = exported;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exported;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
