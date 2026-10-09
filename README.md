# Idea X

Registration, check-in, team submission and judging for the HooHacks Ideathon.

Students register and form teams, judges sign up, and on the day organizers check
people in, open submissions, publish a judging schedule and run two rounds of
scoring to a winner. Everything happens in this one web app.

| For | Link |
| --- | --- |
| Competitors | https://hoohacks.github.io/idea-x/ |
| Judges and mentors | https://hoohacks.github.io/idea-x/#/judge-registration |

## How it is built

A React single-page app on GitHub Pages, backed by Firebase (Realtime Database,
Authentication and Storage). There is no server: the database rules are the only
real authorization, and every role check in the app is a convenience on top of
them.

## Quick start

```
npm install
npm run emulators        # terminal 1: local database, auth and storage
npm run seed             # terminal 2: fill it with a plausible event
npm run start:emulator   # terminal 3: the app, on local data
```

You need Node 22 (see `.nvmrc`), and JDK 17 or newer for the emulators. The app
runs at http://localhost:3000/idea-x/.

Sign in as `admin@example.com` / `testtest`. Judges are `judge1@example.com` and
up, competitors `competitor1@example.com` and up, with the same password.

`npm start` without `:emulator` talks to the **live** project.

## Documentation

Everything else lives in [`docs/`](docs/README.md):

- [Running the event](docs/running-the-event.md): the organizer's guide, before and on the day
- [Development](docs/development.md): local setup, commands, seed data
- [Deployment](docs/deployment.md): releases, Firebase setup, opening registration
- [Testing](docs/testing.md): what each test layer covers and what it cannot see
- [Architecture decisions](docs/decisions/README.md): why things are the way they are

## Deploying

Publishing a GitHub Release deploys to Pages. If the database or storage rules
changed, publish them in the Firebase console too; nothing does that for you. See
[deployment](docs/deployment.md).
