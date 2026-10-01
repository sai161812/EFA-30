// Ground-truth labels live here, separate from extension/matching/matcher.js.
// These are descriptor groups, not rendered forms. Split labels are historical: all groups have been inspected and are regression-only.
const make = (label, expectedStatus = "matched", expectedProfileKey = null, options = {}) => ({
  label, expectedStatus, expectedProfileKey,
  inputType: options.inputType || "text",
  autocomplete: options.autocomplete || "",
  name: options.name || label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
  context: options.context || "",
  kind: options.kind || (options.inputType === "textarea" ? "textarea" : options.inputType === "select-one" ? "select" : "input"),
  options: options.options || []
});

export const corpus = {
  provenance: "Authored synthetic cases from the PRD examples and approved fictional profile; no production site data or human outcomes.",
  profileId: "professional-demo",
  families: [
    {
      id: "F01", split: "development", template: "Single-page internship portal", blueprint: "One-column labeled controls with a contact card and academic block.",
      cases: [
        make("First name", "matched", "firstName", { autocomplete: "given-name" }),
        make("Last name", "matched", "lastName", { autocomplete: "family-name" }),
        make("Email", "matched", "email", { inputType: "email", autocomplete: "email" }),
        make("Phone", "matched", "phone", { inputType: "tel", autocomplete: "tel" }),
        make("College", "matched", "college"),
        make("Degree", "matched", "degree"),
        make("Graduation year", "matched", "graduationYear"),
        make("GitHub", "matched", "github"),
        make("Portfolio", "matched", "portfolio"),
        make("Current city", "matched", "currentCity")
      ]
    },
    {
      id: "F02", split: "development", template: "Campus placement registration", blueprint: "Fieldset groups for academic records, current address and links.",
      cases: [
        make("Full name", "matched", "fullName"),
        make("College email", "matched", "collegeEmail", { inputType: "email" }),
        make("Current study year", "matched", "studyYear"),
        make("Degree program", "matched", "degree"),
        make("Expected graduation year", "matched", "graduationYear"),
        make("Current address line 1", "matched", "currentAddressLine1"),
        make("Current city", "matched", "currentCity"),
        make("Current state", "matched", "currentRegion"),
        make("Current postal code", "matched", "currentPostalCode"),
        make("Portfolio URL", "matched", "portfolio", { inputType: "url" })
      ]
    },
    {
      id: "F03", split: "development", template: "Hackathon team intake", blueprint: "Applicant and team-leader sections followed by an explicit project-choice section.",
      cases: [
        make("Applicant email", "matched", "email", { inputType: "email", autocomplete: "email", context: "Applicant details" }),
        make("Team leader email", "needs choice", null, { inputType: "email", autocomplete: "email", context: "Team leader details" }),
        make("Phone number", "matched", "phone", { inputType: "tel" }),
        make("GitHub profile", "matched", "github", { inputType: "url" }),
        make("Portfolio URL", "matched", "portfolio", { inputType: "url" }),
        make("Project description", "needs choice", null, { inputType: "textarea", context: "Project selection" }),
        make("Team member name", "needs choice"),
        make("Current city", "matched", "currentCity"),
        make("Degree program", "matched", "degree"),
        make("Study year", "matched", "studyYear")
      ]
    },
    {
      id: "F04", split: "development", template: "Residential details wizard", blueprint: "Two separately headed current and permanent address fieldsets.",
      cases: [
        make("Current address line 1", "matched", "currentAddressLine1"),
        make("Current city", "matched", "currentCity"),
        make("Current state", "matched", "currentRegion"),
        make("Current postal code", "matched", "currentPostalCode"),
        make("Permanent address line 1", "matched", "permanentAddressLine1"),
        make("Permanent city", "matched", "permanentCity"),
        make("Permanent state", "matched", "permanentRegion"),
        make("Permanent postal code", "missing value", null),
        make("Current country", "missing value", null),
        make("Permanent country", "missing value", null)
      ]
    },
    {
      id: "F05", split: "development", template: "Graduate internship profile", blueprint: "Academic record table with links and a date-typed expected completion control.",
      cases: [
        make("Applicant name", "matched", "fullName"),
        make("Academic email", "matched", "collegeEmail", { inputType: "email" }),
        make("College", "matched", "college"),
        make("Degree program", "matched", "degree"),
        make("Graduation year", "matched", "graduationYear"),
        make("Expected graduation date", "missing value", null, { inputType: "date" }),
        make("Phone number", "matched", "phone", { inputType: "tel" }),
        make("GitHub URL", "matched", "github", { inputType: "url" }),
        make("Portfolio URL", "matched", "portfolio", { inputType: "url" }),
        make("Why should we hire you?", "needs choice", null, { inputType: "textarea" })
      ]
    },
    {
      id: "F06", split: "held-out", template: "Unfamiliar ATS profile card", blueprint: "Compact two-column accessible form using autocomplete tokens and less common but equivalent labels.",
      cases: [
        make("Given name", "matched", "firstName", { autocomplete: "given-name" }),
        make("Surname", "matched", "lastName", { autocomplete: "family-name" }),
        make("Contact email", "matched", "email", { inputType: "email", autocomplete: "email" }),
        make("Telephone", "matched", "phone", { inputType: "tel", autocomplete: "tel" }),
        make("University name", "matched", "college"),
        make("Degree program", "matched", "degree"),
        make("Graduation year", "matched", "graduationYear"),
        make("GitHub profile", "matched", "github", { inputType: "url" }),
        make("Personal website", "matched", "portfolio", { inputType: "url" }),
        make("Present city", "needs choice", null)
      ]
    },
    {
      id: "F07", split: "held-out", template: "Employer and education combined profile", blueprint: "Tabbed employer and education sections with deliberately conflicting organization wording.",
      cases: [
        make("Organization name", "needs choice", null, { context: "Education and employer details" }),
        make("Company name", "missing value", null, { context: "Employer details" }),
        make("Institution name", "matched", "college", { context: "Education details" }),
        make("Applicant email", "matched", "email", { inputType: "email" }),
        make("College email", "matched", "collegeEmail", { inputType: "email" }),
        make("Personal email", "matched", "personalEmail", { inputType: "email" }),
        make("Phone number", "matched", "phone", { inputType: "tel" }),
        make("Degree", "matched", "degree"),
        make("Graduation year", "matched", "graduationYear"),
        make("Tell us why you want to join", "needs choice", null, { inputType: "textarea" })
      ]
    },
    {
      id: "F08", split: "held-out", template: "Scholarship date and select form", blueprint: "Native select options, a date control, and separate academic/contact regions.",
      cases: [
        make("Graduation year", "matched", "graduationYear"),
        make("Expected graduation date", "missing value", null, { inputType: "date" }),
        make("Year of graduation", "matched", "graduationYear"),
        make("Current study year", "matched", "studyYear"),
        make("Year in school", "matched", "studyYear", { inputType: "select-one", options: [{ value: "Junior", label: "Junior", disabled: false }, { value: "Senior", label: "Senior", disabled: false }] }),
        make("College email", "matched", "collegeEmail", { inputType: "email" }),
        make("College", "matched", "college"),
        make("Full name", "matched", "fullName"),
        make("Current city", "matched", "currentCity"),
        make("Academic motivation", "needs choice", null, { inputType: "textarea" })
      ]
    },
    {
      id: "F09", split: "held-out", template: "Multi-step internship questionnaire", blueprint: "Repeating contact blocks, project prompt, and free-response application questions.",
      cases: [
        make("Applicant email", "matched", "email", { inputType: "email", context: "Applicant" }),
        make("Team leader email", "needs choice", null, { inputType: "email", context: "Team leader" }),
        make("Project title", "needs choice", null),
        make("Project description", "needs choice", null, { inputType: "textarea" }),
        make("Motivation statement", "needs choice", null, { inputType: "textarea" }),
        make("Why should we select you?", "needs choice", null, { inputType: "textarea" }),
        make("First name", "matched", "firstName", { autocomplete: "given-name" }),
        make("Last name", "matched", "lastName", { autocomplete: "family-name" }),
        make("Phone number", "matched", "phone", { inputType: "tel" }),
        make("GitHub", "matched", "github", { inputType: "url" })
      ]
    },
    {
      id: "F10", split: "held-out", template: "Combined address and applicant intake", blueprint: "Nested address groups with current/permanent contradictions and a prefilled-capable contact row.",
      cases: [
        make("Current address", "needs choice", null, { context: "Permanent address" }),
        make("Permanent address", "needs choice", null, { context: "Current address" }),
        make("Current city", "matched", "currentCity"),
        make("Permanent city", "matched", "permanentCity"),
        make("Current address line 1", "matched", "currentAddressLine1"),
        make("Permanent address line 1", "matched", "permanentAddressLine1"),
        make("Current postal code", "matched", "currentPostalCode"),
        make("Personal email", "matched", "personalEmail", { inputType: "email" }),
        make("Applicant name", "matched", "fullName"),
        make("Complete date of graduation", "missing value", null, { inputType: "date" })
      ]
    }
  ]
};
