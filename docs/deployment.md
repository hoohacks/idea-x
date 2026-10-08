# Deployment

The app is served from the `gh-pages` branch at `hoohacks.github.io/idea-x`.

## Releasing

**Publishing a GitHub Release deploys.** Merging to `main` does not. CI runs on
**pull requests only**, so a direct push to `main` runs nothing; merging through a
PR is what closes that gap. Both workflows can also be run by hand from the
Actions tab.

1. Open a PR, let CI go green, merge.
2. If `database.rules.json` changed, publish it (below).
3. If `storage.rules` changed, publish it. Nothing checks this one, and forgetting
   it silently breaks uploads.
4. Publish a release.

The deploy job runs the unit and rules tests again before building, so a red
suite never ships. Its summary says whether registration is open, and reminds you
which rules version the release expects.

### Discord notices

After each release, a second job posts the result to the team's Discord: live or
failed, the version, who released it, whether registration is open, and links to
the site and the run. It reads the webhook from the `DISCORD_WEBHOOK_URL`
repository secret and quietly does nothing if that is not set. Manual redeploys
from the Actions tab are not announced.

## Publishing the database rules

`database.rules.json` is the only real authorization, and **nothing deploys it for
you.** Paste it into the Firebase console (Realtime Database, Rules), or run
`firebase deploy --only database`.

The file starts with a `// rulesVersion:` number. After publishing, record the
same number at `config/rulesVersion` (Control panel, Event setup, Advanced). The
organizer dashboard compares the two and shows a red warning until they match,
because the app cannot read the deployed rules itself. See
[security rules](security-rules.md#versioning).

## First-time Firebase setup

Only needed once per project.

1. Enable **Email/Password** sign-in.
2. Publish `database.rules.json`.
3. Publish `storage.rules`. Without it, resume and pitch deck uploads fail.
4. **Create the first admin by hand.** Register an account (use
   `#/judge-registration?staff` if registration is closed), copy its uid from the
   Authentication tab, then add `admins/<uid>: true` in the database.

Step 4 cannot be done in the app: writing `/admins` requires already being an
admin. Every later organizer is granted admin from the control panel.

## Opening registration

Registration and sign-in are closed by default: a build with nothing set produces
a closed site. To open them, set the repository variable `REGISTRATION_OPEN` to
`true` (Settings, Secrets and variables, Actions, Variables), then run Deploy. No
code change is needed.

The deploy workflow hands it to the build as `VITE_REGISTRATION_OPEN`. This is a
build-time flag, not a database setting. See
[ADR 0005](decisions/0005-registration-window-is-a-build-flag.md) for why, and for
why it is not security.

## Deploying from a laptop

`npm run deploy` builds and pushes `build/` to `gh-pages` directly, without the
tests or the Discord notice. It is for when Actions is unavailable. Set
`VITE_REGISTRATION_OPEN=true` in the environment if registration should be open,
or the build you push will close it.

## The address

**Pages URLs do not redirect on rename.** The old `/ideathon-registration/` and
`/IdeaX/` addresses are dead. There is deliberately no custom domain; see
[ADR 0009](decisions/0009-no-custom-domain.md) before adding one.
