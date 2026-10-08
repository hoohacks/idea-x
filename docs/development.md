# Development

## Setup

You need **Node 22** (the version is in `.nvmrc`) and **JDK 17 or newer** (the
Firebase emulators run on Java).

```
npm install
npm run emulators        # terminal 1: database, auth, storage
npm run seed             # terminal 2: a plausible event
npm run start:emulator   # terminal 3: the app, on local data
```

The app is at http://localhost:3000/idea-x/, the same base path as the live
site. Sign in as `admin@example.com` / `testtest`. Judges are `judge1@example.com` and
up, competitors `competitor1@example.com` and up, with the same password.

`npm start` (without `:emulator`) talks to the **live** project. Use it only when
you mean to. Both start commands open registration locally, whatever the deploy
setting.

## Commands

| Command | Does |
| --- | --- |
| `npm run start:emulator` | The app, on local data |
| `npm run emulators` | Database, auth and storage emulators |
| `npm run seed` | Fill the emulator with an event |
| `npm test` | Unit and page tests, re-run as you edit |
| `npm run test:ci` | Unit and page tests, once (no Java needed) |
| `npm run test:rules` | The database rules, executed by the emulator |
| `npm run test:e2e` | Browser journeys against seeded emulators |
| `npm run build` | Production bundle, in `build/` |
| `npm run preview` | Serve that bundle locally, to check it before a release |
| `npm run migrate:members`, `npm run migrate:scores` | One-time migrations; see [migrations](migrations.md) |

## Seed data

`npm run seed` takes `--teams`, `--judges`, `--rooms`, `--batches`, `--scores`
and `--schedule`. It only ever writes to the emulator. The seeded event starts a
day from now, with submissions already open.

Two things that will confuse you:

- **Seeding recreates every account.** A tab that was signed in holds a
  credential for a uid that no longer exists. Sign in again.
- **Seed at least 8 teams** to exercise the final round. Below about six, every
  judge sees every team in round one, so all are excluded from the final and
  activation produces no assignments. That is the data, not a bug.

## Stack

- React 18 built with Vite (`vite.config.mjs`), and React Router in hash mode.
  Files containing JSX must be `.jsx`; Vite will not parse JSX in a `.js` file.
- Build-time settings are `VITE_*` environment variables, read as
  `import.meta.env.VITE_*` and compiled into the bundle: `VITE_USE_EMULATOR`,
  `VITE_EMULATOR_HOST` and `VITE_REGISTRATION_OPEN`. Changing one means
  rebuilding.
- MUI 5, themed in `src/theme.jsx`; Phosphor icons (`react-icons/pi`) only
- Firebase Realtime Database, Authentication and Storage, used straight from the
  browser. The emulator namespace is `demo-ideathon-default-rtdb`, pinned in
  `src/firebase.js`, `scripts/seed-event.mjs` and `e2e/helpers.mjs`.

Event facts (date, venue, hours, schools) live in `src/eventInfo.js`, and times
are always shown in the event's zone (Eastern), not the reader's.

## Front-end notes

**Autofill.** Chrome writes saved profiles into the page before React attaches
its listeners, so a controlled form can look full and still refuse to submit.
`src/formKit.js` re-reads the fields on mount, on the `onAutofill` keyframe, on
first focus and before submitting. If you rename that keyframe, rename it in
`index.css` too.

**Live subscriptions and forms.** The team's pitch form is filled from the
database once per team, not on every update. It is a live subscription, and
re-filling it on every change overwrote whatever the person was typing whenever
a teammate joined.

**Windows.** `firebase emulators:exec` sometimes leaves its Java process holding
port 9000, and the next run fails with "port taken". Kill it and re-run.
