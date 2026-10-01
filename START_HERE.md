# PLUMA Autofill: install and use your own data

## Install in Chrome or Edge

1. Extract `PLUMA-Autofill-0.3.0.zip` into a permanent folder. Keep this folder: the browser loads the extension from it.
2. Open `chrome://extensions` or `edge://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select the extracted folder containing `manifest.json`.
4. Pin **PLUMA Autofill** using the browser's Extensions menu. If you already loaded this repository, use **Reload** on that extension instead of installing a second copy.

No build, npm install, server, PLUMA application or API key is required for local profiles. Chrome/Edge 106 or later is required.

## Enter your real data

**You do not need to change any source files.** Open the extension's Settings (or its browser extension Details > Extension options).

1. Click **Use local profiles**.
2. Under **Profiles**, choose Personal, College or Professional, enter a name, and click **Create**. This explicitly selects the new profile for scans.
3. Click **Add fact** for each detail. Supply a stable key, a descriptive label, your value, a source such as ?Entered by me?, and appropriate aliases/type. Examples below show field metadata; enter your own values.
4. Click **Save profile changes**. For an existing profile, choose it and click **Use selected profile** to make it active. Merely opening an editor does not switch the scan profile.
5. Create separate profiles when needed. Only the selected profile supplies facts; missing facts are not borrowed from another profile.

| Key | Label | Fact type | Example aliases |
|---|---|---|---|
| fullName | Full name | Text | full name, applicant name |
| firstName | First name | Text | first name, given name |
| lastName | Last name | Text | last name, surname |
| email | Email | Email | email, email address |
| personalEmail | Personal email | Email | personal email |
| collegeEmail | College email | Email | college email, student email |
| phone | Phone | Phone | phone, phone number, mobile number |
| college | College | Text | college, university, institution |
| degree | Degree | Text | degree, degree program |
| studyYear | Current study year | Text | current year of study, class standing |
| graduationYear | Graduation year | Year | graduation year |
| github | GitHub | Link | github, github profile |
| portfolio | Portfolio | Link | portfolio, personal website |
| currentAddressLine1 | Current address line 1 | Text | current address line 1, current street |
| currentCity | Current city | Text | current city |
| currentRegion | Current state | Text | current state, current region |
| currentPostalCode | Current postal code | Postal code | current postal code, current zip code |

Use separate permanentAddressLine1/permanentCity/permanentRegion/permanentPostalCode keys for permanent address facts. Keep phone and postal values as text. Enter a complete date as YYYY-MM-DD with Day precision only when the complete date is known; use Year precision for year-only information. Enter first and last names explicitly if you want them filled separately. Add only facts you approve for reuse. Project snapshots must contain your explicitly approved text and still require a per-form choice.

Local facts persist across browser restarts in this browser profile's extension storage. They are not encrypted or synced, are not added to repository files, and are removed when you uninstall the extension. **Delete this local profile** removes a profile and its saved mappings. Removing individual fact rows takes effect on Save. Do not store passwords, API keys or payment credentials as facts.

## Fill a form

1. Open a normal HTTP/HTTPS form page and click the extension, then **Scan this page**.
2. Review the selected profile, proposed values and explanations. Select only the rows you want filled. A correction can be remembered only by explicitly checking its Remember option.
3. Click **Approve and fill selected**. Existing entries require separate overwrite approval.
4. Check the page and any validation messages yourself. The extension never submits or clicks Next. Rescan after navigation, a new form step, changed page fields or profile edits.

For no suggestions, check the active profile and saved facts, and use specific aliases matching the intended meaning. Ambiguous fields need review. Browser settings pages, file URLs, custom widgets, frames and shadow-root controls are not supported.

## Which files need real-data changes?

**None for normal local use.** Enter/edit facts in Settings. Do not replace fictional values in `extension/development/profile.js`, tests or evaluation fixtures: those are demo/regression data.

POD-16 is optional. If using its supported local endpoint, enter the API origin and key in Settings; never hardcode a key. A different backend deployment requires changing only `manifest.json`'s `optional_host_permissions` to its exact origin pattern, reloading, and entering the same origin in Settings. See the repository README for POD-16 setup. Connecting selects the API source; switching back to local profiles is explicit and requires selecting a local profile again.

## Verification limits

Version 0.3.0 passes 72 automated Node/VM checks, including local profile persistence, explicit approval and stale edit rejection. Chrome/Edge end-to-end testing remains unverified because browser automation was unavailable in this environment. This package is ready to load unpacked, but does not claim universal website support or certified fill reliability. The optional PLUMA native bridge remains absent and is not required for toolbar-driven use.
