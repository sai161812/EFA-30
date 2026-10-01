# EFA-30 daily-use check

The standalone local-profile workflow has 77 passing automated Node/VM checks. These cover approval, wrong-tab/navigation rejection, overwrite consent, sensitive-field exclusions, stale mapping rejection, profile persistence, native validity/retention simulations, and save errors. The latest fixes prevent duplicate profile saves and preserve edits made while a save is pending; source changes clear the previous editor.

This is not browser end-to-end certification. Browser automation failed to initialize in this environment, and live Chrome/Edge and POD-16 sessions remain unverified. Custom widgets, frames and shadow roots are unsupported. Always inspect the filled page before submitting.

## One-time check in your installed browser

1. Reload EFA-30 on the extensions page and reopen Settings.
2. Use local profiles. Save your name/email and reopen Settings to confirm they persisted.
3. On a form, scan and confirm the displayed profile and values are correct. Nothing should fill before approval.
4. Approve one empty field and check the page retained the correct value.
5. Enter a value manually, rescan, and confirm replacement requires the separate overwrite checkbox.
6. Restart the browser and confirm your profile remains available.

If any step fails, stop using it on important forms and record the exact message and browser version. Local profile storage is not encrypted or synced and is removed on uninstall; keep the original information elsewhere.

The compact popup bulk selector is covered for eligible empty-field selection and failure handling. It never sends fill authorization or grants overwrite permission. Correction-memory toggles preserve in-progress value edits. Live browser layout and end-to-end use remain unverified.
