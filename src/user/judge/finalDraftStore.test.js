/**
 * The final round draft, and the concurrency rule around it.
 *
 * Two organizers can have the planner open at once, so a save carries the
 * version it last read and is refused if that has moved. The rule has a sharp
 * edge worth pinning: a *freshly built* plan is version 0, so building over an
 * existing draft looks exactly like a stale save unless the caller carries the
 * stored version across. `FinalRoundPlanner` does that deliberately -- without
 * it, the "Re-rank" repair offered when a card lands mid-planning failed with
 * "another organizer changed this draft", which is both wrong and unactionable.
 *
 * The shape rules are the other half. Realtime Database has no arrays and drops
 * an empty one entirely, so `ranked` and `edits` are keyed on the way out and
 * sorted back on the way in, and `pool`, each panel and each edit's
 * `orderBefore` have to survive coming back absent.
 */
jest.mock("../../firebase", () => ({ database: {} }));
jest.mock("../../roles.js", () => ({ requireAdmin: jest.fn(async () => ({ uid: "admin-1" })) }));
jest.mock("../admin/adminAction.js", () => ({ resolveName: jest.fn(async () => "Ada Lovelace") }));

const mockGet = jest.fn();
const mockUpdate = jest.fn();

jest.mock("firebase/database", () => ({
  ref: (_db, path) => ({ path: path ?? "" }),
  get: (...args) => mockGet(...args),
  update: (...args) => mockUpdate(...args),
  onValue: jest.fn(),
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

const {
  saveFinalDraft, readFinalDraft, encodeDraft, decodeDraft, FINAL_DRAFT_PATH,
} = require("./finalDraftStore");
const { resolveName } = require("../admin/adminAction.js");

const snap = (value) => ({ exists: () => value !== null && value !== undefined, val: () => value });
const stored = (value) => mockGet.mockImplementation(async () => snap(value));
const written = () => mockUpdate.mock.calls.at(-1)[1][FINAL_DRAFT_PATH];

const plan = (over = {}) => ({
  version: 0,
  room: "Rice 011",
  size: 4,
  ranked: [
    { teamId: "t1", name: "Alpha", averageScore: 36, fundableVotes: 2, judgeCount: 3 },
    { teamId: "t2", name: "Beta", averageScore: 34, fundableVotes: 1, judgeCount: 2 },
  ],
  assignments: {
    t1: { teamId: "t1", teamName: "Alpha", order: 0, judges: [{ judgeId: "j1", judgeName: "Ada" }] },
    t2: { teamId: "t2", teamName: "Beta", order: 1, judges: [] },
  },
  excluded: { t1: { j2: true }, t2: {} },
  pool: [{ judgeId: "j1", judgeName: "Ada" }],
  edits: [],
  basis: { cardCounts: { t1: 3, t2: 2 }, eligibleJudges: { j1: true }, size: 4, room: "Rice 011" },
  ...over,
});

beforeEach(() => {
  mockGet.mockReset();
  mockUpdate.mockReset();
  mockUpdate.mockResolvedValue(undefined);
  // create-react-app sets resetMocks, which wipes a factory's implementation
  // before every test -- so it has to be re-established here, not once above
  resolveName.mockReset();
  resolveName.mockResolvedValue("Ada Lovelace");
});

describe("saving", () => {
  test("a first save writes, and reports the version now stored", async () => {
    stored(null);
    const result = await saveFinalDraft(plan());

    expect(result.ok).toBe(true);
    expect(result.version).toBe(1);
    expect(written().version).toBe(1);
  });

  test("a save on top of what it read is allowed", async () => {
    stored({ version: 3 });
    const result = await saveFinalDraft(plan({ version: 3 }));

    expect(result.ok).toBe(true);
    expect(written().version).toBe(4);
  });

  test("a save against a version that has moved is refused, naming who moved it", async () => {
    stored({ version: 5, createdByName: "Grace Hopper" });
    const result = await saveFinalDraft(plan({ version: 3 }));

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Grace Hopper/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("a save carrying a version onto nothing is refused, not resurrected", async () => {
    // the draft was discarded out from under the editor; letting this through
    // would bring back something somebody deliberately cleared
    stored(null);
    const result = await saveFinalDraft(plan({ version: 4 }));

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/discarded/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  /**
   * The edge the Re-rank repair lives on. A freshly built plan is version 0; if
   * the caller does not carry the stored version across, rebuilding over a
   * draft is indistinguishable from a stale save.
   */
  test("a freshly built plan cannot be saved over a draft as-is", async () => {
    stored({ version: 2 });
    expect((await saveFinalDraft(plan({ version: 0 }))).ok).toBe(false);
  });

  test("but it can once the caller carries the stored version", async () => {
    stored({ version: 2 });
    const rebuilt = { ...plan(), version: 2 };

    expect((await saveFinalDraft(rebuilt)).ok).toBe(true);
    expect(written().version).toBe(3);
  });

  test("the first save stamps who started it; later ones keep that", async () => {
    stored(null);
    await saveFinalDraft(plan());
    expect(written().createdByName).toBe("Ada Lovelace");

    stored({ version: 1, createdBy: "someone", createdByName: "Grace Hopper", createdAt: 5 });
    await saveFinalDraft(plan({ version: 1 }));
    expect(written().createdByName).toBe("Grace Hopper");
  });
});

describe("the shapes that cross the wire", () => {
  test("ranked and edits go out keyed, because there are no arrays down there", async () => {
    stored(null);
    await saveFinalDraft(plan({ edits: [{ op: { type: "dropTeam" }, summary: "x", orderBefore: [] }] }));

    expect(Object.keys(written().ranked)).toEqual(["0000", "0001"]);
    expect(Object.keys(written().edits)).toEqual(["0000"]);
  });

  test("and come back in the same order they went out", () => {
    const round = decodeDraft(encodeDraft(plan()));
    expect(round.ranked.map((team) => team.teamId)).toEqual(["t1", "t2"]);
  });

  test("an empty panel survives being dropped on the way back", () => {
    // RTDB discards an empty array, so `judges: []` returns as absent
    const raw = encodeDraft(plan());
    delete raw.assignments.t2.judges;

    expect(decodeDraft(raw).assignments.t2.judges).toEqual([]);
  });

  test("an absent pool comes back as a list, not undefined", () => {
    const raw = encodeDraft(plan({ pool: [] }));
    delete raw.pool;

    expect(decodeDraft(raw).pool).toEqual([]);
  });

  test("an edit's captured order survives the same way", () => {
    const raw = encodeDraft(plan({ edits: [{ op: { type: "moveSlot" }, summary: "x" }] }));
    expect(decodeDraft(raw).edits[0].orderBefore).toEqual([]);
  });

  test("a null before on an edit stays null rather than becoming a panel", () => {
    const raw = encodeDraft(plan({ edits: [{ op: { type: "addTeam" }, summary: "x", before: null }] }));
    expect(decodeDraft(raw).edits[0].before).toBeNull();
  });

  test("the basis always has its two maps, so no reader has to guard them", () => {
    const decoded = decodeDraft({ basis: {} });
    expect(decoded.basis.cardCounts).toEqual({});
    expect(decoded.basis.eligibleJudges).toEqual({});
  });
});

describe("reading", () => {
  test("nothing stored is null rather than a throw", async () => {
    stored(null);
    expect(await readFinalDraft()).toBeNull();
  });

  test("a read failure is reported as no draft, not as a crash", async () => {
    mockGet.mockImplementation(async () => {
      throw new Error("PERMISSION_DENIED");
    });
    expect(await readFinalDraft()).toBeNull();
  });
});
