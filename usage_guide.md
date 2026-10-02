# EFA-30: simple usage guide

EFA-30 is a standalone autofill extension. You do not need PLUMA, POD-16, an API key, or a ZIP file to use it.

## 1. Open it

Already installed? Open `chrome://extensions` (or `edge://extensions`) and click **Reload** on the extension to see its new name.

Click the browser's puzzle-piece icon, choose **EFA-30**, then click **Open settings**.

## 2. Add your details once

1. Click **Use local profiles**. Ignore the optional POD-16 connection section.
2. Under **Profiles**, choose **Personal**, enter **My profile**, and click **Create**.
3. Click **Add fact** and enter your name using the first column below.
4. Click **Add fact** again and enter your email using the second column.

| Box | Name fact | Email fact |
|---|---|---|
| Key | `fullName` | `email` |
| Label | Full name | Email |
| Value | Your actual full name | Your actual email address |
| Source label | Entered by me | Entered by me |
| Aliases | full name, applicant name | email, email address |
| Fact type | Text | Email |
| Date precision | Not a date | Not a date |

Click **Save profile changes**, then **Use selected profile**. You do not need to edit any project files.

## 3. Use it on a website

1. Open a registration or application form.
2. Click **EFA-30 > Scan this page**.
3. Matching details for empty fields are ready automatically. Review the displayed values; you can exclude or edit a suggestion if needed.
4. Click **Confirm and fill** once to fill the matching boxes. Existing values stay in place unless you explicitly approve replacement; unclear or missing details need your input.

Check the filled form yourself, then submit it yourself. EFA-30 never submits for you.

To change your details later, open Settings, edit the values and save. To add phone, address or other facts, see [PROFILE_REFERENCE.md](PROFILE_REFERENCE.md).

Your facts stay in this browser's extension storage. They are not encrypted or synced; uninstalling the extension removes them. Some websites use unsupported controls, so a field may need manual entry.

Not installed yet? Enable Developer mode on the browser extensions page, choose **Load unpacked**, and select `D:\Workspace\DEVEL\EFA-30`.
