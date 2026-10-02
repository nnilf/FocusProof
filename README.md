# FocusProof

FocusProof is a study timer that only counts the time you're actually working. It tracks your sessions and shows how much was **Actual Learning Time (ALT)**: time spent working, not time spent on YouTube or away from your desk.

Everything runs and stays on your computer.

## Starting the app

You need **Windows 10/11** and **[Node.js](https://nodejs.org) 22 or newer**.

1. Open the `FocusProof` folder.
2. Double-click **`FocusProof.cmd`**.

The first start takes a few minutes while it installs. After that, it opens straight away.

To get a desktop icon, run this once in a terminal in the folder:

```
npm run shortcut
```

## Using it

1. **Assignments**: add what you're working on, with the files to watch (e.g. your essay `.docx`).
2. **Session**: pick the assignment and press **Start session**. Work as normal.
3. Press **End session** to see your report: ALT, a timeline of your session, and words written.
4. **History** and **Analytics** show your progress over time.

Click any block on a report's timeline to see why it was classified that way.

**Two monitors with the webcam on?** Go to **Settings → Webcam calibration** and look at each screen when asked. Looking at either screen then counts as focused.

## What is ALT?

Every few seconds, FocusProof labels what you're doing:

| Label | Meaning | Counts towards ALT |
| --- | --- | --- |
| Productive | Working in a study app, typing, editing your files | Fully |
| Neutral | Unclear, e.g. reading with little typing | Half |
| Distracted | Distracting sites or apps, or inactive on non-study apps | No |
| Away | Not at the computer | No |

ALT is an estimate based on your activity. It can't measure how much you learned.

## Privacy

- **Nothing leaves your computer.** There are no accounts, no uploads and no tracking.
- **Webcam:** off by default. When it's on, only "present" and a focus score are saved. No video or images.
- **Screen:** only a small thumbnail is checked for changes in memory. Screenshots are never saved.
- **Keyboard and mouse:** only *how much* you use them. Keys are never recorded.
- **Files:** only word and line counts are saved, never the contents.

Each source can be switched off on the **Privacy** page.

## Troubleshooting

- **Webcam option greyed out:** run `npm run fetch-models` in the folder, then restart.
- **App won't start after an update:** run `node scripts/launch.mjs --rebuild`.
- **A session was interrupted** (crash or power cut): on the next start you can resume it, save it, or discard it.

## For developers

```
npm run dev        # run with hot reload
npm test           # unit tests
npm run lint       # lint
npm run typecheck  # type checks
npm run dist       # build a Windows installer into release/
```

The code is split into three parts:

- `src/main`: all the logic, including monitoring, the scoring engine (`engine/`) and the database.
- `src/renderer`: the React UI.
- `src/shared`: types shared by both.

The scoring engine is pure and swappable: implement `LearningTimeEngine` and register it with `registerEngine()`.
