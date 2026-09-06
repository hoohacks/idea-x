/**
 * The restore point store itself: capturing a snapshot, and pruning old ones
 * so the store cannot grow without bound.
 *
 * The pruning race is the one worth a dedicated fixture. The old code read
 * `snapshotIndex`, computed the single oldest entry to evict, and wrote both
 * the new entry and that eviction together in a plain `update()` -- no
 * transaction. Two captures landing together both read the SAME pre-capture
 * index, so both computed the SAME "oldest" entry to evict: the store gained
 * two entries and lost one, net +1 over the limit every time this raced.
 *
 * The mock below is deliberately atomic where the real database is atomic and
 * gated where the real one is slow, same as draftConcurrency.test.js: a plain
 * `get` on the racy path is held open until both racing calls are waiting on
 * it, modeling two captures whose reads land before either write does; a
 * transaction has nothing gating it, because the server guarantees no gap
 * between its read and its write.
 *
 * jest.mock's factory may only reference variables named `mock*` -- hence the
 * naming below, not a style choice.
 */
jest.mock("../../firebase", () => ({ database: {} }));

/** `{ snapshotIndex: {...}, snapshots: {...} }`, the whole fake database. */
const mockDb = { snapshotIndex: {}, snapshots: {} };

/**
 * Holds `get(snapshotIndex)` open until both racing calls are waiting on it.
 * `hold: 0` (the default outside the race tests below) means "never gate" --
 * a single, non-racing capture must resolve immediately or it hangs forever.
 */
const mockGate = { waiting: [], hold: 0 };

let mockPushCounter = 0;

function mockApplyUpdate(updates) {
  for (const [path, value] of Object.entries(updates)) {
    const [root, ...rest] = path.split("/");
    if (rest.length === 0) {
      mockDb[root] = value;
      continue;
    }
    if (!mockDb[root]) mockDb[root] = {};
    const key = rest.join("/");
    if (value === null) delete mockDb[root][key];
    else mockDb[root][key] = value;
  }
}

jest.mock("firebase/database", () => ({
  ref: (_db, path) => ({ path: path ?? "" }),
  get: (reference) => {
    if (reference.path === "snapshotIndex") {
      // a snapshot of the index as it stands right now, frozen at read time --
      // a real `get` does not see writes that land after it resolves
      const value = { ...mockDb.snapshotIndex };
      const snap = { exists: () => Object.keys(value).length > 0, val: () => value };
      if (mockGate.waiting.length < mockGate.hold) {
        return new Promise((resolve) => {
          mockGate.waiting.push(() => resolve(snap));
        });
      }
      return Promise.resolve(snap);
    }
    return Promise.resolve({ exists: () => false, val: () => null });
  },
  update: async (_ref, updates) => {
    mockApplyUpdate(updates);
  },
  push: (reference) => ({ key: `${reference.path}-${++mockPushCounter}` }),
  serverTimestamp: () => 999,
  // Atomic on purpose, same reasoning as draftConcurrency.test.js: nothing is
  // awaited between reading the current value and writing the new one, which
  // is what the real server guarantees. An `await` in here would reproduce
  // the very race this mock exists to model correctly.
  runTransaction: async (reference, updater) => {
    const current = { ...(mockDb[reference.path] ?? {}) };
    const next = updater(current);
    if (next === undefined) {
      return { committed: false, snapshot: { val: () => current, exists: () => true } };
    }
    mockDb[reference.path] = next;
    return { committed: true, snapshot: { val: () => next, exists: () => true } };
  },
}));

jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: { uid: "admin-1" } }) }));
jest.mock("../../roles.js", () => ({
  requireAdmin: jest.fn(async () => ({ uid: "admin-1" })),
}));

const { captureSnapshot, KEEP_SNAPSHOTS } = require("./snapshots");
const { requireAdmin } = require("../../roles.js");

/**
 * create-react-app sets `resetMocks: true`, which strips the implementation
 * off every jest.fn before each test -- so the implementation passed to
 * jest.fn() at declaration is gone by the time the first test runs and has
 * to be re-established here.
 */
beforeEach(() => {
  mockDb.snapshotIndex = {};
  mockDb.snapshots = {};
  mockGate.waiting = [];
  mockGate.hold = 0;
  mockPushCounter = 0;
  requireAdmin.mockReset();
  requireAdmin.mockResolvedValue({ uid: "admin-1" });
});

/** Start both, release the gate once both are waiting on it, then await both. */
async function raceTwo(callA, callB) {
  const runA = callA();
  const runB = callB();
  // Bounded, not infinite: the fixed implementation never calls the gated
  // `get` at all (it uses runTransaction instead), so nothing ever queues up
  // to release. This just gives the old, buggy path a chance to reach the
  // gate before moving on.
  for (let i = 0; i < 200 && mockGate.waiting.length < mockGate.hold; i++) {
    await Promise.resolve();
  }
  mockGate.waiting.splice(0).forEach((release) => release());
  return Promise.all([runA, runB]);
}

test("capturing one at a time never keeps more than KEEP_SNAPSHOTS", async () => {
  for (let i = 0; i < KEEP_SNAPSHOTS + 5; i++) {
    // eslint-disable-next-line no-await-in-loop
    await captureSnapshot({ label: `snap ${i}`, paths: ["teams"] });
  }

  expect(Object.keys(mockDb.snapshotIndex).length).toBe(KEEP_SNAPSHOTS);
});

test("a restore point holds its own payload, indexed by the same id", async () => {
  const result = await captureSnapshot({ label: "manual", paths: ["teams"] });

  expect(result.ok).toBe(true);
  expect(mockDb.snapshotIndex[result.id]).toBeTruthy();
  expect(mockDb.snapshots[result.id].entries).toEqual([{ path: "teams", value: "null" }]);
});

describe("two captures landing together", () => {
  test("never leaves the store holding more than KEEP_SNAPSHOTS entries", async () => {
    // Seed one short of the limit, so a single ordinary capture would not
    // need to prune anything -- exactly the situation that let two
    // concurrent captures both skip pruning and both add, going one over.
    for (let i = 0; i < KEEP_SNAPSHOTS - 1; i++) {
      mockDb.snapshotIndex[`old-${i}`] = { at: i + 1, label: `old ${i}` };
    }
    mockGate.hold = 2;

    const [a, b] = await raceTwo(
      () => captureSnapshot({ label: "A", paths: ["teams"] }),
      () => captureSnapshot({ label: "B", paths: ["teams"] })
    );

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(Object.keys(mockDb.snapshotIndex).length).toBeLessThanOrEqual(KEEP_SNAPSHOTS);
  });

  test("does not orphan a payload whose index entry was pruned by the other capture", async () => {
    for (let i = 0; i < KEEP_SNAPSHOTS - 1; i++) {
      mockDb.snapshotIndex[`old-${i}`] = { at: i + 1, label: `old ${i}` };
      mockDb.snapshots[`old-${i}`] = { entries: [] };
    }
    mockGate.hold = 2;

    await raceTwo(
      () => captureSnapshot({ label: "A", paths: ["teams"] }),
      () => captureSnapshot({ label: "B", paths: ["teams"] })
    );

    // every payload still on disk has a corresponding index entry -- nothing
    // was left behind for the pruned index to stop pointing at
    const indexedIds = new Set(Object.keys(mockDb.snapshotIndex));
    for (const id of Object.keys(mockDb.snapshots)) {
      expect(indexedIds.has(id)).toBe(true);
    }
  });
});
