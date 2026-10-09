// Import the functions you need from the SDKs you need
//import { getAnalytics } from "firebase/analytics";
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { firebaseConfig } from "./firebaseConfig";

/**
 * Point the whole app at the local emulators when VITE_USE_EMULATOR is set.
 *
 * Without this there was no way to exercise the app end to end at all: every
 * `npm start` talked to the live project, so rehearsing a schedule generation,
 * a score submission or anything in the danger zone wrote to the real event.
 * The automated suites covered the rules and the arithmetic; the one thing they
 * could not cover was a person clicking through the actual day.
 *
 * `npm run start:emulator` sets the flag. Vite compiles it in at build time,
 * so a production bundle cannot accidentally carry it -- the deployed site has
 * no branch that can reach a localhost emulator.
 */
export const USING_EMULATOR = import.meta.env.VITE_USE_EMULATOR === "true";

const EMULATOR_HOST = import.meta.env.VITE_EMULATOR_HOST || "127.0.0.1";

/**
 * The emulator namespace, which is NOT derived from firebaseConfig.
 *
 * This is the subtle part. `connectDatabaseEmulator` keeps the namespace from
 * the configured databaseURL, so it would connect to a namespace called
 * `ideathon-2026-d6950-default-rtdb` on the emulator -- a real, empty database
 * that is not the one the seed script and the rules suite use. Reads then
 * succeed and return nothing, which looks exactly like a signed-in user with no
 * roles and is thoroughly confusing to debug.
 *
 * Passing the URL to getDatabase instead pins the namespace explicitly.
 *
 * It must be the project's DEFAULT instance -- `<projectId>-default-rtdb` --
 * and not the bare project id, because that is the only namespace
 * `firebase emulators:exec` applies database.rules.json to. A namespace the
 * emulator has no rules for is created on demand and left WIDE OPEN, so the
 * whole app ran locally with no authorization at all: every read succeeded,
 * every write succeeded, and a rules bug was invisible until production.
 *
 * That is not hypothetical. `joinTeam` read two paths the rules refuse and
 * failed for every real user, while working perfectly against the emulator.
 *
 * scripts/seed-event.mjs writes the same namespace. Keep the two in step.
 */
export const EMULATOR_NAMESPACE = "demo-ideathon-default-rtdb";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
//export const analytics = getAnalytics(app);
export const storage = getStorage(app);
export const database = USING_EMULATOR
  ? getDatabase(app, `http://${EMULATOR_HOST}:9000?ns=${EMULATOR_NAMESPACE}`)
  : getDatabase(app);
export const auth = getAuth(app);

if (USING_EMULATOR) {
  connectStorageEmulator(storage, EMULATOR_HOST, 9199);
  // disableWarnings only silences the banner the SDK prints; the emulator is
  // still refusing to do anything real with these credentials
  connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });

  // eslint-disable-next-line no-console
  console.info(
    `%cEMULATOR MODE%c database :9000 (ns=${EMULATOR_NAMESPACE}) · auth :9099 · storage :9199 — ` +
      `nothing here touches ${firebaseConfig.projectId}`,
    "background:#0B6E6D;color:#fff;padding:2px 6px;border-radius:3px;font-weight:600",
    "color:#0B6E6D"
  );
}
