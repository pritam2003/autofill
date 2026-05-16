const assert = require("node:assert/strict");
const test = require("node:test");

require("../src/defaults.js");
const engine = require("../src/field-engine.js");

test("infers common identity fields", () => {
  assert.equal(engine.inferFromText("Candidate first name").key, "firstName");
  assert.equal(engine.inferFromText("Email address").key, "email");
  assert.equal(engine.inferFromText("LinkedIn profile URL").key, "linkedin");
});

test("keeps co-op and school email separate from personal email", () => {
  assert.equal(engine.inferFromText("Co-op email address").key, "coopEmail");
  assert.equal(engine.inferFromText("SFU co-op email").key, "coopEmail");
  assert.equal(engine.inferFromText("Student email").key, "coopEmail");
  assert.equal(engine.inferFromText("Company email").key, "workEmail");
  assert.equal(engine.inferFromText("Work email").key, "workEmail");
  assert.equal(engine.inferFromText("sfuCoopEmail email SFU co-op email", { inputType: "email" }).profilePath, "personal.coopEmail");
  assert.equal(engine.inferFromText("companyEmail email Company email", { inputType: "email" }).profilePath, "personal.workEmail");
  assert.equal(engine.inferFromText("candidateEmail email Email Address", { inputType: "email" }).profilePath, "personal.email");
});

test("infers work authorization and sponsorship questions", () => {
  assert.equal(engine.inferFromText("Are you legally authorized to work in the United States?").key, "authorizedToWorkUS");
  assert.equal(engine.inferFromText("Will you now or in the future require visa sponsorship?").key, "needsSponsorshipUS");
});

test("recognizes job source questions and reuses learned answers by field key", () => {
  const first = engine.inferFromText("Where did you hear about this job?");
  const second = engine.inferFromText("How did you learn about this opportunity?");
  const learned = {
    "where did you hear about this job": {
      fieldKey: "jobSource",
      value: "LinkedIn",
      updatedAt: "2026-05-16T20:00:00.000Z"
    }
  };
  assert.equal(first.key, "jobSource");
  assert.equal(second.key, "jobSource");
  assert.equal(engine.bestValueFor(second, { career: {} }, learned).value, "LinkedIn");
});

test("saved profile answers always win over conflicting learned memory", () => {
  const email = engine.inferFromText("Email address");
  const learned = {
    "email address": {
      fieldKey: "email",
      value: "wrong@example.com",
      updatedAt: "2026-05-16T20:00:00.000Z"
    }
  };
  const match = engine.bestValueFor(email, { personal: { email: "right@example.com" } }, learned);

  assert.equal(engine.hasProfileAnswer({ personal: { email: "right@example.com" } }, email), true);
  assert.equal(match.value, "right@example.com");
  assert.equal(match.source, "profile");
});

test("marks sensitive fields", () => {
  const gender = engine.inferFromText("Gender");
  assert.equal(gender.key, "gender");
  assert.equal(gender.sensitive, true);
});

test("blocks unsafe fields", () => {
  const ssn = engine.inferFromText("Social Security Number");
  assert.equal(ssn.blocked, true);
});

test("matches select options to yes and no answers", () => {
  assert.equal(engine.optionMatches("Yes, I am authorized", "Yes"), true);
  assert.equal(engine.optionMatches("No, I do not require sponsorship", "No"), true);
  assert.equal(engine.optionMatches("Woman", "Man"), false);
  assert.equal(engine.optionMatches("Non-binary", "No"), false);
});

test("matches Canada and British Columbia dropdown aliases", () => {
  assert.equal(engine.optionMatches("Canada CA", "Canada"), true);
  assert.equal(engine.optionMatches("CA", "Canada"), true);
  assert.equal(engine.optionMatches("British Columbia", "BC"), true);
  assert.equal(engine.optionMatches("BC", "British Columbia"), true);
  assert.equal(engine.optionMatches("B.C.", "British Columbia"), true);
});

test("uses Canada and British Columbia as location defaults", () => {
  assert.equal(engine.getProfileValue({ personal: {} }, engine.inferFromText("Country")).toLowerCase(), "canada");
  assert.equal(engine.getProfileValue({ personal: {} }, engine.inferFromText("State/Province")).toLowerCase(), "british columbia");
});
