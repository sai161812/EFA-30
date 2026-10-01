# Manual completion-time protocol

This protocol compares extension-assisted completion with manual entry and configured browser autofill. No timings are currently available; collect them only from observed participants.

## Design

1. Recruit participants who consent to timing and use only synthetic profile data and test application forms.
2. Use the same profile and semantically equivalent forms in all three conditions: manual entry, extension scan/review/fill (including edits and corrections), and the browser's configured autofill.
3. Counterbalance order with all six condition orders: M-P-B, M-B-P, P-M-B, P-B-M, B-M-P, B-P-M. Assign participants evenly across sequences. Here M=manual, P=extension, B=browser autofill.
4. Give a short practice form before timing. Do not reuse its labels in the held-out matcher corpus.
5. Start timing when the participant sees the blank form. Stop when they declare it complete and a blinded checklist confirms field correctness. Include review, corrections and recovery from errors. Record incorrect/incomplete fields separately; do not count a quick but wrong completion as success.
6. The primary endpoint is total elapsed completion time, including API wait, review, approval, corrections and recovery. Report active time and API wait as secondary measures. Configure browser autofill with the same available facts beforehand and disclose preparation time. Keep browser, autofill settings, network conditions, profile and form version fixed within each participant's three conditions.
7. Report participant count, form/family count, exclusions, medians and paired differences with uncertainty intervals. Compare the extension and browser autofill against manual entry. Do not impute missing times or treat scripted automation as human time saved.

## Data sheet columns

Participant pseudonym; assigned sequence; condition; form family; browser/version; browser autofill configuration; start/end timestamps; active time; API wait; correct fields / eligible fields; corrections; failed fields; exclusions and reason.

## Cold-start and repeat-use comparison

Report cold-start and saved-correction sessions separately. Record mapping edits and value edits per form, along with correct/eligible fields and failed fills. Give every condition equal repeat exposure to control familiarity. Every extension session includes review and approval time, even when a remembered mapping is reused. Do not interpret synthetic worker tests as observed user edit reduction.
