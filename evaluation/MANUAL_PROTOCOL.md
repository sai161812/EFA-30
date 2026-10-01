# Manual completion-time protocol

This protocol compares extension-assisted completion with manual entry and configured browser autofill. No timings are currently available; collect them only from observed participants.

## Design

1. Recruit participants who consent to timing and use only synthetic profile data and test application forms.
2. Use the same profile and semantically equivalent forms in all three conditions: manual entry, PLUMA scan/review/fill (including edits and corrections), and the browser's configured autofill.
3. Counterbalance order with a six-sequence Latin square: M-P-B, M-B-P, P-M-B, P-B-M, B-M-P, B-P-M. Assign participants evenly across sequences. Here M=manual, P=PLUMA, B=browser autofill.
4. Give a short practice form before timing. Do not reuse its labels in the held-out matcher corpus.
5. Start timing when the participant sees the blank form. Stop when they declare it complete and a blinded checklist confirms field correctness. Include review, corrections and recovery from errors. Record incorrect/incomplete fields separately; do not count a quick but wrong completion as success.
6. Record API wait separately from active completion time and report both. Keep browser, autofill settings, network conditions, profile and form version fixed within each participant's three conditions.
7. Report participant count, form/family count, exclusions, medians and paired differences with uncertainty intervals. Compare PLUMA and browser autofill against manual entry. Do not impute missing times or treat scripted automation as human time saved.

## Data sheet columns

Participant pseudonym; assigned sequence; condition; form family; browser/version; browser autofill configuration; start/end timestamps; active time; API wait; correct fields / eligible fields; corrections; failed fields; exclusions and reason.
