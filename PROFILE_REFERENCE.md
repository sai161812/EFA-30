# EFA-30 profile field reference

Optional details for adding more facts. Start with [the simple guide](usage_guide.md).

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

