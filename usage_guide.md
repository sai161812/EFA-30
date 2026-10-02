# EFA-30: simple usage guide

EFA-30 is a standalone autofill extension. You do not need PLUMA, POD-16, an API key, or a ZIP file to use it.

## 1. Open it

Already installed? Open `chrome://extensions` (or `edge://extensions`) and click **Reload** on the extension to see its new name.

Click the browser's puzzle-piece icon, choose **EFA-30**, then click **Open settings**.

## 2. Add your details once

1. Click **Use local profiles**. Ignore the optional POD-16 connection section.
2. Under **Profiles**, choose **Personal**, enter **My profile**, and click **Create**.
3. Under **Your contact details**, enter your full name, email, and phone with country code.
4. Enter first and last names separately if you want those boxes filled; the extension never guesses name parts.
5. Optionally add a username, your default contact address (including country/postal code), company, job title, and website. Leave irrelevant fields blank; blank optional details are not saved.
6. Click **Save profile changes**, then **Use selected profile** if the profile is not already selected.

Common mappings are prepared for you. **Advanced mapping details** lets you adjust aliases or sources. **Add fact** remains available for custom facts. Existing profile details are preserved. Write contact messages for each form rather than saving a universal answer.

## 3. Use it on a website

1. Open an HTTPS registration or contact form. HTTP is supported only for local development.
2. Click **EFA-30 > Scan this page**.
3. Matching details for empty fields are ready automatically. Review the displayed values; you can exclude or edit a suggestion if needed.
4. Click **Confirm and fill** once to fill the matching boxes. Existing values stay in place unless you explicitly approve replacement; unclear or missing details need your input.

Check the filled form yourself, then submit it yourself. EFA-30 never submits for you.

To change your details later, open Settings, edit the values and save. To add phone, address or other facts, see [PROFILE_REFERENCE.md](PROFILE_REFERENCE.md).

Your facts stay in this browser's extension storage. They are not encrypted or synced; uninstalling the extension removes them. Some websites use unsupported controls, so a field may need manual entry.

Not installed yet? Enable Developer mode on the browser extensions page, choose **Load unpacked**, and select `D:\Workspace\DEVEL\EFA-30`.
