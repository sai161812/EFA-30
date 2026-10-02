# EFA-30: simple usage guide

EFA-30 fills your approved details after one confirmation. Local mode requires no account, server or API key.

## Install or update

Already installed from this folder? Open `chrome://extensions` or `edge://extensions` and click **Reload**. Reloading the same unpacked extension preserves its saved profiles. Loading a copy from a different path may create a separate extension identity and storage; keep using the same installation folder when updating.

For a new installation, extract `EFA-30-1.1.0.zip` into a permanent folder. Enable **Developer mode** on the browser extensions page, select **Load unpacked**, and choose the extracted folder containing `manifest.json`. You can also load the repository root directly.

## Create profiles for different uses

1. Open **EFA-30 > Open settings > Use local profiles**.
2. Choose a category, give the profile a distinct name, and click **Create**. Examples of names: Personal, Work, College, Travel.
3. Enter the details you want to reuse. Nothing is copied from another profile or invented for you.
4. Click **Save profile changes**. Repeat to create other profiles. Multiple named profiles in the same category are supported.

| Profile category | Optional details offered |
|---|---|
| Personal / signup | Full name, separate first/last names, email, phone with country code, username, contact address, company, job title, website |
| College / education | Common contact details plus institution, college email, degree, year of study, graduation year and full graduation date |
| Professional / work | Common contact details plus GitHub URL |

Use the email and address intended for each use. Leave irrelevant details blank; blank optional setup fields are not saved. First and last names must be supplied separately; the extension never splits a full name. Enter a full date only if you know it. Phone and postal/PIN codes remain text, preserving leading zeroes.

**Advanced mapping details** lets you change aliases, types and sources. **Add fact** supports custom reusable information. Changing profiles warns before discarding unsaved edits. Contact messages and application answers are entered per form instead of using an assumed universal answer.

## Fill a form

1. Open an HTTPS signup or contact form. Loopback HTTP is available for local development.
2. Open **EFA-30** and choose **Profile for this form**. Switching clears the old preview; profiles are never combined automatically.
3. Click **Scan this page**. Clear matches for empty fields are ready automatically.
4. Review the displayed website and values. Edit or exclude suggestions as needed. Missing or unclear details need your input; existing values need separate overwrite approval.
5. Click **Confirm and fill** once. Check the result for each field, then submit the form yourself.

The last result summary remains available if the popup closes. It expires after ten minutes and stores field labels/status, website origin and profile name, without filled values. A new scan or profile change clears it.

Dynamic forms need a new scan after changing steps. Native inputs, textareas, dates and single selects are supported. Embedded frames, shadow DOM and custom dropdowns need manual entry. A site's scripts may reject or later change a value; success means it was retained at verification time.

## Privacy and removal

Profiles remain in this browser's extension storage until edited, deleted or the extension is uninstalled. They are unencrypted and are not synced. **Delete this local profile** removes the profile and its remembered mappings. Removing a fact takes effect on Save. Keep credentials, payment details and government identifiers out of profiles.

After filling, the destination website and its scripts can read those values immediately. Review the recipient before confirming. The extension never submits forms. See [PRIVACY.md](PRIVACY.md), [SECURITY_REVIEW.md](SECURITY_REVIEW.md) and [PROTOTYPE_AUDIT.md](PROTOTYPE_AUDIT.md) for data retention, tested protections and limits.

POD-16 and the fictional development profile are optional advanced modes. Normal use needs neither.
