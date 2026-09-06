/**
 * Two organizers editing the same draft at the same time.
 *
 * The draft carries a `version`, and both stores read it, compare it, and then
 * write. Between the read and the write is a network round trip, and in that
 * window a second organizer can read the same version, pass the same check, and
 * write too. The second write silently replaced the first and BOTH callers were
 * told the save succeeded -- which is precisely the failure the version field
 * was added to prevent.
 *
 * The mock below is deliberately atomic where the real database is atomic and
 * gated where the real one is slow. Getting either wrong makes this file pass
 * while proving nothing, so both are spelled out.
 */
jest.mock("../../firebase", () => ({ database: {} }));

/** The one shared value both callers are racing over. */
const mockStore = { value: null };

/** Holds the first N reads open, so both callers read before either writes. */
const mockGate = { waiting: [], held: 0, hold: 0 };

jest.mock("firebase/database", () => {
  const snapshotOfNow = () => {
    // a read returns the value as it was, not a live view of it
    const value = mockStore.value;
    return { exists: () => value !== null, val: () => value };
  };

  return {
    ref: (_db, path) => ({ path: path ?? "" }),
    get: () => {
      if (mockGate.held < mockGate.hold) {
        mockGate.held += 1;
        return new Promise((resolve) => mockGate.waiting.push(() => resolve(snapshotOfNow())));
      }
      return Promise.resolve(snapshotOfNow());
    },
    update: async (_ref, updates) => {
      mockStore.value = Object.values(updates)[0];
    },
    onValue: () => () => {},
    // Atomic on purpose: nothing is awaited between reading the current value
    // and writing the new one, which is what the server guarantees. An `await`
    // in here would reproduce the very race being tested for.
    runTransaction: async (_reference, callback) => {
      const current = mockStore.value;
      const next = callback(current);
      if (next === undefined) {
        return { committed: false, snapshot: { val: () => current, exists: () => current !== null } };
      }
      mockStore.value = next;
      return { committed: true, snapshot: { val: () => next, exists: () => true } };
    },
    serverTimestamp: () => 0,
  };
});

jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: { uid: "admin-1" } }) }));
jest.mock("../../roles.js", () => ({
  ...jest.requireActual("../../roles.js"),
  requireAdmin: jest.fn(),
}));
jest.mock("../admin/adminAction.js", () => ({ resolveName: jest.fn(async () => "Ada") }));

const { saveDraft } = require("./draftStore");
const { saveFinalDraft } = require("./finalDraftStore");
const { requireAdmin } = require("../../roles.js");

const stored = (extra) => ({
  version: 3,
  createdAt: 1,
  createdBy: "u1",
  createdByName: "Ada",
  ...extra,
});

beforeEach(() => {
  mockGate.waiting = [];
  mockGate.held = 0;
  mockGate.hold = 2;
  requireAdmin.mockReset();
  requireAdmin.mockResolvedValue({ uid: "admin-1" });
});

/** Start both saves, let both reads land, then let them finish. */
async function raceTwo(save, planA, planB) {
  const runA = save(planA);
  const runB = save(planB);
  while (mockGate.waiting.length < 2) await Promise.resolve();
  mockGate.waiting.forEach((release) => release());
  return Promise.all([runA, runB]);
}

test("the first-round draft keeps one writer's edits, not a blend of both", async () => {
  mockStore.value = stored({ assignments: { t1: { id: "t1", judges: [] } } });

  const [a, b] = await raceTwo(
    saveDraft,
    { version: 3, assignments: { t1: { id: "t1", judges: [{ judgeId: "jA" }] } }, edits: [] },
    { version: 3, assignments: { t1: { id: "t1", judges: [{ judgeId: "jB" }] } }, edits: [] }
  );

  // exactly one save wins; the other is told to reload rather than told it saved
  expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  const loser = a.ok ? b : a;
  expect(loser.error).toMatch(/saved this draft first/i);

  // and the winner's edits are what is actually stored
  const winner = a.ok ? "jA" : "jB";
  expect(mockStore.value.assignments.t1.judges[0].judgeId).toBe(winner);
  expect(mockStore.value.version).toBe(4);
});

test("the final round draft does the same", async () => {
  mockStore.value = stored({ assignments: { t1: { teamId: "t1", order: 0, judges: [] } }, ranked: {}, pool: {} });

  const plan = (judgeId) => ({
    version: 3,
    assignments: { t1: { teamId: "t1", order: 0, judges: [{ judgeId, judgeName: judgeId }] } },
    ranked: [],
    pool: [],
    edits: [],
  });

  const [a, b] = await raceTwo(saveFinalDraft, plan("jA"), plan("jB"));

  expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  expect((a.ok ? b : a).error).toMatch(/saved this draft first/i);
  expect(mockStore.value.version).toBe(4);
});

test("with no one racing, a save still goes through", async () => {
  mockGate.hold = 0;
  mockStore.value = stored({ assignments: { t1: { id: "t1", judges: [] } } });

  const result = await saveDraft({
    version: 3,
    assignments: { t1: { id: "t1", judges: [{ judgeId: "jA" }] } },
    edits: [],
  });

  expect(result).toEqual({ ok: true, version: 4 });
  expect(mockStore.value.version).toBe(4);
});
