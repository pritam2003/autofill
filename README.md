# Job Autofill Copilot

A supervised, local-first Chrome extension for job applications. It stores your reusable profile answers in `chrome.storage.local`, reads application forms, fills high-confidence fields, and asks for review on sensitive or ambiguous fields.

## Load It In Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select `/Users/pritamdatta/Desktop/autofill`.
5. Open the extension popup and choose **Profile and memory**.
6. Fill your profile values, then turn the extension on from the popup.

## How It Works

- Saved profile and learned answers are filled automatically while the extension is on.
- Country defaults to Canada and province/state defaults to British Columbia/BC when those profile fields are blank.
- Province custom dropdowns search with `B` and then choose British Columbia, which works on portals where `BC` returns no results.
- Country custom dropdowns search with `C`/`Can` and then choose Canada.
- Manual choices in custom dropdowns can be learned for future applications.
- Manual choices in native dropdowns can also be learned, including job-source questions such as “Where did you hear about this job?”
- Co-op, school, and student email fields use **Co-op / school email**; work, company, and business email fields use **Work / company email**; neither falls back to your regular email.
- If a saved answer is wrong, correct it on the form and the extension can learn the correction.
- If you manually answer a new question, the extension can learn that answer for next time.
- Existing fillable values are overwritten by default so each run refreshes the form from your saved profile.
- It watches dynamic pages, so after you click Next, newly loaded forms are scanned again.
- It never clicks Submit or Next for you.
- To bring back the old confirmation cards, turn off **Fill all saved answers automatically** in the options page.
- If a custom dropdown gets weird, use **Pause this page** in the popup or the floating panel. Manual **Autofill this page** will retry once.

## Safety Boundaries

- Passwords, SSNs, credit cards, bank fields, and similar high-risk fields are blocked.
- File inputs cannot be filled programmatically by browser extensions, so resume uploads still need your click.
- All data stays local in Chrome extension storage unless you export it yourself.

## Demo

From `/Users/pritamdatta/Desktop/autofill`, run:

```bash
python3 -m http.server 8765
```

Then open one of these in Chrome:

- [http://127.0.0.1:8765/demo/job-application.html](http://127.0.0.1:8765/demo/job-application.html) for a simple form.
- [http://127.0.0.1:8765/demo/test-lab.html](http://127.0.0.1:8765/demo/test-lab.html) for edge cases, custom dropdowns, dynamic fields, learning, and blocked fields.

You can also open `/Users/pritamdatta/Desktop/autofill/demo/job-application.html` directly. If testing on a local file, enable **Allow access to file URLs** for this extension in `chrome://extensions`.

## Development

Run the matcher tests:

```bash
npm test
```
