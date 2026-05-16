(function initDefaults(root) {
  "use strict";

  const STORAGE_KEYS = {
    enabled: "jobAutofill.enabled",
    profile: "jobAutofill.profile",
    settings: "jobAutofill.settings",
    learnedAnswers: "jobAutofill.learnedAnswers",
    stats: "jobAutofill.stats"
  };

  const DEFAULT_SETTINGS = {
    autofillOnLoad: true,
    fillKnownAnswersAutomatically: true,
    fillSensitiveAutomatically: false,
    learnFromManualInputs: true,
    askBeforeSavingSensitive: true,
    highlightFilledFields: true,
    showReviewPanel: true,
    minimumConfidence: 0.72
  };

  const DEFAULT_PROFILE = {
    personal: {
      firstName: "",
      middleName: "",
      lastName: "",
      fullName: "",
      preferredName: "",
      email: "",
      coopEmail: "",
      workEmail: "",
      phone: "",
      address1: "",
      address2: "",
      city: "",
      state: "British Columbia",
      postalCode: "",
      country: "Canada",
      location: ""
    },
    links: {
      linkedin: "",
      github: "",
      portfolio: "",
      website: ""
    },
    career: {
      currentCompany: "",
      currentTitle: "",
      yearsExperience: "",
      desiredSalary: "",
      noticePeriod: "",
      earliestStartDate: "",
      remotePreference: "",
      willingToRelocate: "",
      authorizedToWorkUS: "",
      needsSponsorshipUS: "",
      over18: ""
    },
    education: {
      highestDegree: "",
      school: "",
      major: "",
      graduationYear: ""
    },
    demographics: {
      gender: "",
      pronouns: "",
      raceEthnicity: "",
      veteranStatus: "",
      disabilityStatus: ""
    },
    openText: {
      whyInterested: "",
      coverLetterSnippet: "",
      additionalInfo: ""
    }
  };

  const PROFILE_FIELDS = [
    {
      title: "Personal",
      description: "Core identity and contact details used on almost every application.",
      fields: [
        { path: "personal.firstName", label: "First name", autocomplete: "given-name" },
        { path: "personal.middleName", label: "Middle name", autocomplete: "additional-name" },
        { path: "personal.lastName", label: "Last name", autocomplete: "family-name" },
        { path: "personal.fullName", label: "Full legal name", autocomplete: "name" },
        { path: "personal.preferredName", label: "Preferred name" },
        { path: "personal.email", label: "Email", type: "email", autocomplete: "email" },
        { path: "personal.coopEmail", label: "Co-op / school email", type: "email", autocomplete: "email" },
        { path: "personal.workEmail", label: "Work / company email", type: "email", autocomplete: "email" },
        { path: "personal.phone", label: "Phone", type: "tel", autocomplete: "tel" },
        { path: "personal.address1", label: "Address line 1", autocomplete: "address-line1" },
        { path: "personal.address2", label: "Address line 2", autocomplete: "address-line2" },
        { path: "personal.city", label: "City", autocomplete: "address-level2" },
        { path: "personal.state", label: "State / province", autocomplete: "address-level1" },
        { path: "personal.postalCode", label: "Postal / ZIP code", autocomplete: "postal-code" },
        { path: "personal.country", label: "Country", autocomplete: "country-name" },
        { path: "personal.location", label: "Current location" }
      ]
    },
    {
      title: "Links",
      description: "Professional URLs commonly requested by job portals.",
      fields: [
        { path: "links.linkedin", label: "LinkedIn URL", type: "url" },
        { path: "links.github", label: "GitHub URL", type: "url" },
        { path: "links.portfolio", label: "Portfolio URL", type: "url" },
        { path: "links.website", label: "Personal website", type: "url" }
      ]
    },
    {
      title: "Career",
      description: "Reusable job-application answers. Use exact wording you want inserted.",
      fields: [
        { path: "career.currentCompany", label: "Current company" },
        { path: "career.currentTitle", label: "Current job title" },
        { path: "career.yearsExperience", label: "Years of experience", type: "number" },
        { path: "career.desiredSalary", label: "Desired salary / compensation" },
        { path: "career.noticePeriod", label: "Notice period" },
        { path: "career.earliestStartDate", label: "Earliest start date" },
        { path: "career.remotePreference", label: "Remote / hybrid preference" },
        { path: "career.willingToRelocate", label: "Willing to relocate", type: "select", options: ["", "Yes", "No"] },
        { path: "career.authorizedToWorkUS", label: "Authorized to work in the US", type: "select", options: ["", "Yes", "No"] },
        { path: "career.needsSponsorshipUS", label: "Needs visa sponsorship in the US", type: "select", options: ["", "Yes", "No"] },
        { path: "career.over18", label: "Over 18", type: "select", options: ["", "Yes", "No"] }
      ]
    },
    {
      title: "Education",
      description: "Highest education details for quick repeat use.",
      fields: [
        { path: "education.highestDegree", label: "Highest degree" },
        { path: "education.school", label: "School / university" },
        { path: "education.major", label: "Major / field of study" },
        { path: "education.graduationYear", label: "Graduation year" }
      ]
    },
    {
      title: "Sensitive / EEO",
      description: "These are never auto-filled unless you explicitly allow sensitive autofill.",
      sensitive: true,
      fields: [
        { path: "demographics.gender", label: "Gender" },
        { path: "demographics.pronouns", label: "Pronouns" },
        { path: "demographics.raceEthnicity", label: "Race / ethnicity" },
        { path: "demographics.veteranStatus", label: "Veteran status" },
        { path: "demographics.disabilityStatus", label: "Disability status" }
      ]
    },
    {
      title: "Open Text",
      description: "Short reusable text snippets. Keep these review-ready, not auto-submit-ready.",
      fields: [
        { path: "openText.whyInterested", label: "Why are you interested?", type: "textarea" },
        { path: "openText.coverLetterSnippet", label: "Cover letter snippet", type: "textarea" },
        { path: "openText.additionalInfo", label: "Additional information", type: "textarea" }
      ]
    }
  ];

  const BOOLEAN_YES = ["yes", "y", "true", "authorized", "i am", "i do"];
  const BOOLEAN_NO = ["no", "n", "false", "not authorized", "i am not", "i do not"];

  const SENSITIVE_KEYS = [
    "gender",
    "pronouns",
    "raceEthnicity",
    "veteranStatus",
    "disabilityStatus",
    "dateOfBirth"
  ];

  const NEVER_FILL_PATTERNS = [
    "password",
    "passcode",
    "social security",
    "ssn",
    "sin",
    "national insurance",
    "credit card",
    "card number",
    "cvv",
    "cvc",
    "bank account",
    "routing number",
    "iban",
    "passport number",
    "driver license",
    "drivers license"
  ];

  const FIELD_DEFINITIONS = [
    {
      key: "firstName",
      profilePath: "personal.firstName",
      patterns: ["first name", "given name", "forename"],
      antiPatterns: ["preferred first", "manager first"]
    },
    {
      key: "middleName",
      profilePath: "personal.middleName",
      patterns: ["middle name", "middle initial"]
    },
    {
      key: "lastName",
      profilePath: "personal.lastName",
      patterns: ["last name", "family name", "surname"]
    },
    {
      key: "fullName",
      profilePath: "personal.fullName",
      patterns: ["full name", "legal name", "name as it appears", "applicant name", "your name"]
    },
    {
      key: "preferredName",
      profilePath: "personal.preferredName",
      patterns: ["preferred name", "chosen name", "nickname"]
    },
    {
      key: "coopEmail",
      profilePath: "personal.coopEmail",
      patterns: [
        "co op email",
        "coop email",
        "co-op email",
        "email co op",
        "email coop",
        "email co-op",
        "cooperative education email",
        "co operative education email",
        "school email",
        "student email",
        "university email"
      ]
    },
    {
      key: "workEmail",
      profilePath: "personal.workEmail",
      patterns: [
        "work email",
        "business email",
        "company email",
        "corporate email",
        "employer email"
      ]
    },
    {
      key: "email",
      profilePath: "personal.email",
      inputTypes: ["email"],
      patterns: ["email", "e-mail", "email address"],
      antiPatterns: [
        "co op",
        "coop",
        "co-op",
        "cooperative education",
        "school email",
        "student email",
        "university email",
        "work email",
        "business email",
        "company email",
        "corporate email",
        "employer email"
      ]
    },
    {
      key: "phone",
      profilePath: "personal.phone",
      inputTypes: ["tel", "phone"],
      patterns: ["phone", "telephone", "mobile", "cell"]
    },
    {
      key: "address1",
      profilePath: "personal.address1",
      patterns: ["address line 1", "street address", "home address", "mailing address", "address 1"]
    },
    {
      key: "address2",
      profilePath: "personal.address2",
      patterns: ["address line 2", "apartment", "suite", "unit", "address 2"]
    },
    {
      key: "city",
      profilePath: "personal.city",
      patterns: ["city", "town"]
    },
    {
      key: "state",
      profilePath: "personal.state",
      patterns: ["state", "province", "region"]
    },
    {
      key: "postalCode",
      profilePath: "personal.postalCode",
      patterns: ["postal code", "zip code", "zipcode", "postcode"]
    },
    {
      key: "country",
      profilePath: "personal.country",
      patterns: ["country", "country of residence"]
    },
    {
      key: "location",
      profilePath: "personal.location",
      patterns: ["current location", "where are you located", "location"]
    },
    {
      key: "linkedin",
      profilePath: "links.linkedin",
      patterns: ["linkedin", "linked in"]
    },
    {
      key: "github",
      profilePath: "links.github",
      patterns: ["github", "git hub"]
    },
    {
      key: "portfolio",
      profilePath: "links.portfolio",
      patterns: ["portfolio", "personal portfolio", "work samples"]
    },
    {
      key: "website",
      profilePath: "links.website",
      inputTypes: ["url"],
      patterns: ["website", "personal site", "web site", "url"]
    },
    {
      key: "currentCompany",
      profilePath: "career.currentCompany",
      patterns: ["current company", "current employer", "employer name"]
    },
    {
      key: "currentTitle",
      profilePath: "career.currentTitle",
      patterns: ["current title", "job title", "current role", "position title"]
    },
    {
      key: "yearsExperience",
      profilePath: "career.yearsExperience",
      patterns: ["years of experience", "total experience", "professional experience"]
    },
    {
      key: "desiredSalary",
      profilePath: "career.desiredSalary",
      patterns: ["desired salary", "salary expectation", "compensation expectation", "expected compensation"]
    },
    {
      key: "noticePeriod",
      profilePath: "career.noticePeriod",
      patterns: ["notice period", "how much notice"]
    },
    {
      key: "earliestStartDate",
      profilePath: "career.earliestStartDate",
      patterns: ["start date", "available to start", "earliest start"]
    },
    {
      key: "remotePreference",
      profilePath: "career.remotePreference",
      patterns: ["remote preference", "work preference", "hybrid", "remote work"]
    },
    {
      key: "willingToRelocate",
      profilePath: "career.willingToRelocate",
      patterns: ["relocate", "willing to relocate", "open to relocation"]
    },
    {
      key: "authorizedToWorkUS",
      profilePath: "career.authorizedToWorkUS",
      patterns: ["authorized to work", "legally authorized", "work authorization", "eligible to work", "right to work"]
    },
    {
      key: "needsSponsorshipUS",
      profilePath: "career.needsSponsorshipUS",
      patterns: ["require sponsorship", "need sponsorship", "visa sponsorship", "employment sponsorship", "future sponsorship"]
    },
    {
      key: "over18",
      profilePath: "career.over18",
      patterns: ["over 18", "at least 18", "18 years of age"]
    },
    {
      key: "highestDegree",
      profilePath: "education.highestDegree",
      patterns: ["highest degree", "education level", "degree"]
    },
    {
      key: "school",
      profilePath: "education.school",
      patterns: ["school", "university", "college", "institution"]
    },
    {
      key: "major",
      profilePath: "education.major",
      patterns: ["major", "field of study", "discipline"]
    },
    {
      key: "graduationYear",
      profilePath: "education.graduationYear",
      patterns: ["graduation year", "year graduated", "completion year"]
    },
    {
      key: "gender",
      profilePath: "demographics.gender",
      sensitive: true,
      patterns: ["gender", "sex", "identify as"]
    },
    {
      key: "pronouns",
      profilePath: "demographics.pronouns",
      sensitive: true,
      patterns: ["pronouns", "preferred pronouns"]
    },
    {
      key: "raceEthnicity",
      profilePath: "demographics.raceEthnicity",
      sensitive: true,
      patterns: ["race", "ethnicity", "hispanic", "latino", "eeo category"]
    },
    {
      key: "veteranStatus",
      profilePath: "demographics.veteranStatus",
      sensitive: true,
      patterns: ["veteran", "protected veteran", "military service"]
    },
    {
      key: "disabilityStatus",
      profilePath: "demographics.disabilityStatus",
      sensitive: true,
      patterns: ["disability", "disabled", "voluntary self identification of disability"]
    },
    {
      key: "whyInterested",
      profilePath: "openText.whyInterested",
      patterns: ["why are you interested", "why do you want", "why this role"]
    },
    {
      key: "coverLetterSnippet",
      profilePath: "openText.coverLetterSnippet",
      patterns: ["cover letter", "letter of interest", "personal statement"]
    },
    {
      key: "additionalInfo",
      profilePath: "openText.additionalInfo",
      patterns: ["additional information", "anything else", "additional comments"]
    }
  ];

  const exported = {
    STORAGE_KEYS,
    DEFAULT_PROFILE,
    DEFAULT_SETTINGS,
    PROFILE_FIELDS,
    FIELD_DEFINITIONS,
    SENSITIVE_KEYS,
    NEVER_FILL_PATTERNS,
    BOOLEAN_YES,
    BOOLEAN_NO
  };

  root.JobAutofillDefaults = exported;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exported;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
