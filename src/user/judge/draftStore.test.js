jest.mock("../../firebase", () => ({ database: {}, auth: {} }));
const mockUpdate = jest.fn();
const mockGet = jest.fn();
jest.mock("firebase/database", () => ({
  ref: (_db, path) => ({ path: path ?? "" }),
  get: (...a) => mockGet(...a),
  update: (...a) => mockUpdate(...a),
  onValue: jest.fn(() => jest.fn()),
  // single-writer tests only; concurrency lives in draftConcurrency.test.js
  runTransaction: async (reference, callback) => {
    const snap = await mockGet(reference);
    const current = snap.exists() ? snap.val() : null;
    const next = callback(current);
    if (next === undefined) {
      return { committed: false, snapshot: { val: () => current, exists: () => current !== null } };
    }
    await mockUpdate({ path: "" }, { [reference.path]: next });
    return { committed: true, snapshot: { val: () => next, exists: () => true } };
  },
  serverTimestamp: () => 1700000000000,
}));
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: { uid: "admin-1" } }) }));
jest.mock("../../roles.js", () => ({ requireAdmin: jest.fn(async () => ({ uid: "admin-1" })) }));
jest.mock("../admin/adminAction.js", () => ({ resolveName: async () => "Sam" }));

const { readDraft, saveDraft, clearDraft } = require("./draftStore");
const { requireAdmin } = require("../../roles.js");
const { applyEdit } = require("./applyEdit");
const { computeStats } = require("./computeStats");

const plan = (over = {}) => ({
  assignments: {}, basis: { teamIds: [], judgeIds: [], rooms: [], batchCount: 3, batchTimes: {}, target: 3 },
  judgeNames: {}, teamNames: {}, onlyCheckedIn: false, edits: [], version: 0, ...over,
});

/**
 * What Realtime Database actually does on write: any array or object that
 * ends up with no children is DROPPED, not stored as `[]` / `{}`. Recurses
 * bottom-up, so a container that only becomes empty once its own children
 * are stripped -- e.g. `basis.batchTimes: {}` -- is stripped too.
 *
 * Every other test in this file mocks `update` with a bare `jest.fn()`, which
 * records whatever object it was called with verbatim -- it never actually
 * serialises anything, so it cannot reveal what RTDB does to an empty
 * container. That is how `judges: []` on a freshly-placed team survived
 * thirteen reviews: nothing in the test suite ever played back RTDB's own
 * write semantics. This function is that missing step.
 */
function stripEmptyRTDB(value) {
  if (Array.isArray(value)) {
    const stripped = value.map(stripEmptyRTDB).filter((v) => v !== undefined);
    return stripped.length ? stripped : undefined;
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      const strippedValue = stripEmptyRTDB(v);
      if (strippedValue !== undefined) out[key] = strippedValue;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value;
}

/**
 * create-react-app sets `resetMocks: true`, which strips the implementation
 * off every jest.fn before each test -- so `requireAdmin`'s mocked resolution
 * from the jest.mock factory above is gone by the time the first test runs
 * unless it is re-established here. See adminAction.test.js for the same note.
 */
beforeEach(() => {
  mockUpdate.mockReset(); mockUpdate.mockResolvedValue(undefined);
  mockGet.mockReset();
  mockGet.mockResolvedValue({ exists: () => false, val: () => null });
  requireAdmin.mockReset();
  requireAdmin.mockResolvedValue({ uid: "admin-1" });
});

test("the draft is written to /scheduleDraft and nowhere else", async () => {
  await saveDraft(plan());
  const [, payload] = mockUpdate.mock.calls[0];
  expect(Object.keys(payload)).toEqual(["scheduleDraft"]);
});

test("saving bumps the version", async () => {
  // A version above 0 needs a matching stored draft, or saveDraft now reads
  // it as "this draft was discarded" and refuses -- see the two tests below.
  mockGet.mockResolvedValue({
    exists: () => true,
    val: () => ({ version: 3, createdByName: "Sam" }),
  });
  const result = await saveDraft(plan({ version: 3 }));
  expect(result.ok).toBe(true);
  expect(mockUpdate.mock.calls[0][1].scheduleDraft.version).toBe(4);
});

test("a fresh plan at version 0 saves when nothing is stored", async () => {
  const result = await saveDraft(plan({ version: 0 }));
  expect(result.ok).toBe(true);
  expect(mockUpdate).toHaveBeenCalledTimes(1);
});

test("a stale plan with nothing stored is refused, not resurrected as a first save", async () => {
  const result = await saveDraft(plan({ version: 3 }));
  expect(result.ok).toBe(false);
  expect(mockUpdate).not.toHaveBeenCalled();
});

test("a stale version is refused and names who moved it", async () => {
  mockGet.mockResolvedValue({
    exists: () => true,
    val: () => ({ version: 7, createdByName: "Sam" }),
  });
  const result = await saveDraft(plan({ version: 3 }));
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/Sam/);
  expect(mockUpdate).not.toHaveBeenCalled();
});

test("reading an absent draft is null, not an error", async () => {
  expect(await readDraft()).toBeNull();
});

test("edits round-trip through the keyed shape", async () => {
  const withEdit = plan({
    edits: [{ op: { type: "addJudge", teamId: "t1", judgeUid: "j1" }, summary: "Added Bo to A", before: null }],
  });
  await saveDraft(withEdit);
  const stored = mockUpdate.mock.calls[0][1].scheduleDraft;
  expect(Array.isArray(stored.edits)).toBe(false);
  mockGet.mockResolvedValue({ exists: () => true, val: () => stored });
  const back = await readDraft();
  expect(back.edits).toHaveLength(1);
  expect(back.edits[0].summary).toBe("Added Bo to A");
});

test("clearing writes a null", async () => {
  await clearDraft();
  expect(mockUpdate.mock.calls[0][1]).toEqual({ scheduleDraft: null });
});

test("a non-admin gets null from readDraft, not a thrown error", async () => {
  requireAdmin.mockRejectedValueOnce(new Error("Only an admin can read the schedule draft"));
  expect(await readDraft()).toBeNull();
});

test("a non-admin's save is refused and writes nothing", async () => {
  requireAdmin.mockRejectedValueOnce(new Error("Only an admin can save the schedule draft"));
  const result = await saveDraft(plan());
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/admin/);
  expect(mockUpdate).not.toHaveBeenCalled();
});

test("a non-admin's clear is refused and writes nothing", async () => {
  requireAdmin.mockRejectedValueOnce(new Error("Only an admin can clear the schedule draft"));
  const result = await clearDraft();
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/admin/);
  expect(mockUpdate).not.toHaveBeenCalled();
});

// ---- Finding 1: an empty `judges: []` (and an empty `basis.batchTimes`)
// must survive a real RTDB round trip, not just the bare-jest.fn() one every
// other test in this file exercises. `moveTeam` deliberately places a team
// with `judges: []` before anyone is assigned to it (applyEdit.js) -- RTDB
// drops that empty array on write, so the key is entirely ABSENT on the way
// back, not merely empty. Five consumers (computeStats, PlanGrid, applyEdit's
// own clone, checkDrift, publishPlan) dereference `.judges` unguarded, so a
// draft missing the key crashes the schedule preview outright.

test("a freshly-placed team's empty judges array, and an empty batchTimes map, survive a real RTDB round trip", async () => {
  const withEmptyPanel = plan({
    assignments: {
      t4: {
        id: "t4", teamName: "D", batch: 2, room: "R2", time: "5:15 PM",
        judges: [],
      },
    },
    basis: {
      teamIds: ["t4"], judgeIds: ["j9"], rooms: ["R2"], batchCount: 2, batchTimes: {}, target: 3,
    },
    // A real plan always carries a name for every team in `basis.teamIds` --
    // planSchedule never builds one otherwise. Left at the `plan()` helper's
    // default `{}` here, `teamNames` would ALSO be an empty object RTDB drops,
    // which is a real but separate gap this test is not about; filling it in
    // keeps the test targeted at the `judges`/`batchTimes` bug Finding 1 names.
    teamNames: { t4: "D" },
    judgeNames: { j9: "Grace" },
  });

  await saveDraft(withEmptyPanel);
  const written = mockUpdate.mock.calls[0][1].scheduleDraft;

  // Sanity check: prove this test actually exercises the gap it claims to.
  // RTDB really does drop an empty array and an empty object on write.
  const stripped = stripEmptyRTDB(written);
  expect(stripped.assignments.t4.judges).toBeUndefined();
  expect(stripped.basis.batchTimes).toBeUndefined();
  // The assignment itself survives -- it has other, non-empty fields -- only
  // the `judges` key inside it is gone.
  expect(stripped.assignments.t4.teamName).toBe("D");

  mockGet.mockResolvedValue({ exists: () => true, val: () => stripped });
  const back = await readDraft();

  expect(back.assignments.t4.judges).toEqual([]);
  expect(back.basis.batchTimes).toEqual({});

  // The five real consumers must not throw on the decoded plan.
  expect(() => computeStats(back)).not.toThrow();
  expect(() =>
    applyEdit(back, { type: "addJudge", teamId: "t4", judgeUid: "j9" })
  ).not.toThrow();
});

test("an edit log entry's `before` snapshot of an unjudged assignment also survives the round trip", async () => {
  const withEditBefore = plan({
    edits: [
      {
        op: { type: "moveTeam", teamId: "t4", batch: 2, room: "R2" },
        summary: "Placed D in R2, batch 2",
        before: { id: "t4", teamName: "D", batch: 1, room: "R1", time: "5:00 PM", judges: [] },
      },
    ],
  });

  await saveDraft(withEditBefore);
  const written = mockUpdate.mock.calls[0][1].scheduleDraft;
  const stripped = stripEmptyRTDB(written);

  // decodeEdits keys the edits array on the way out -- confirm the `before`
  // snapshot inside the one edit really did lose its `judges` key.
  const strippedEdit = Object.values(stripped.edits)[0];
  expect(strippedEdit.before.judges).toBeUndefined();

  mockGet.mockResolvedValue({ exists: () => true, val: () => stripped });
  const back = await readDraft();

  expect(back.edits[0].before.judges).toEqual([]);
});
