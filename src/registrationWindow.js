/**
 * Whether the doors are open.
 *
 * This is a build-time flag rather than something in `/config`, and the reason
 * is the one place it has to work: a person who is not signed in. The rules
 * grant `config` to `auth != null` and nothing looser, so a logged-out visitor
 * on the registration page cannot read a database flag at all. Gating on one
 * would mean the gate could never be lifted for exactly the people it is for.
 *
 * So it is compiled in. `npm run build` with nothing set produces a **closed**
 * site: forgetting the flag keeps strangers out rather than letting them in,
 * which is the right way round for a site that goes live weeks before its
 * event. Development and the browser suite set it explicitly, so local work and
 * the e2e journeys are never gated.
 *
 * Opening registration is therefore a deploy, not a database edit. That is
 * fine: it happens once a year and it is planned. `deploy.yml` reads the
 * repository variable `REGISTRATION_OPEN`, so it can be flipped in GitHub's
 * settings and re-run without touching code.
 *
 * What this is NOT is security. It hides the forms; it does not stop anyone
 * calling Firebase directly. The database rules are what protect the data, and
 * they are unchanged — somebody who forced an account into existence would hold
 * no role and see nothing.
 */
export const REGISTRATION_OPEN = import.meta.env.VITE_REGISTRATION_OPEN === "true";

/**
 * The way in while the doors are shut.
 *
 * Organizers still have to reach the control panel to set the event up, and
 * signing in is how. `#/login?staff` shows the form. Obscurity rather than a
 * secret: anyone who guesses it still faces the same rules as everybody else.
 */
export const STAFF_PARAM = "staff";

export function isStaffEntrance(search) {
  return new URLSearchParams(search ?? "").has(STAFF_PARAM);
}
