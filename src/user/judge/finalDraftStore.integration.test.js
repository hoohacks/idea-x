/**
 * The shared final-round draft against an in-memory database with the real
 * admin check: the encoding that survives Realtime Database dropping empty
 * lists and renumbering arrays, the save stamps, every refusal's wording, and
 * the read, clear and live subscription. finalDraftStore.test.js covers the
 * version race against scripted reads.
 */
vi.mock("../../firebase.js", () => ({ database: {} }));
vi.mock("firebase/database", async () => (await import("../../testing/fakeDatabase")).module);
vi.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: { uid: "admin-1" } }) }));

const db = await import("../../testing/fakeDatabase");
const {
  FINAL_DRAFT_PATH,
  encodeDraft,
  decodeDraft,
  readFinalDraft,
  saveFinalDraft,
  clearFinalDraft,
  subscribeFinalDraft,
} = await import("./finalDraftStore");

const judge = (id) => ({ judgeId: id, judgeName: id.toUpperCase() });
const plan = (overrides = {}) => ({
  version: 0,
  room: "Rice 011",
  size: 2,
  ranked: [{ teamId: "t1" }, { teamId: "t2" }, { teamId: "t3" }],
  pool: [judge("j1"), judge("j2")],
  assignments: {
    t1: { teamId: "t1", order: 0, judges: [judge("j1")] },
    t2: { teamId: "t2", order: 1, judges: [] },
  },
  edits: [{ kind: "move", orderBefore: ["t2", "t1"], before: { teamId: "t1", judges: [judge("j2")] } }],
  basis: { cardCounts: { t1: 2 }, eligibleJudges: { j1: true }, size: 2, room: "Rice 011" },
  ...overrides,
});

beforeEach(() => {
  db.reset({ admins: { "admin-1": true }, judges: { "admin-1": { firstName: "Ada", lastName: "Byron" } } });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

test("the draft lives at finalRoundDraft", () => {
  expect(FINAL_DRAFT_PATH).toBe("finalRoundDraft");
});

describe("encoding", () => {
  test("lists become padded keyed sets so their order survives, and an empty panel is kept", () => {
    const encoded = encodeDraft(plan());
    expect(encoded.ranked).toEqual({ "0000": { teamId: "t1" }, "0001": { teamId: "t2" }, "0002": { teamId: "t3" } });
    expect(encoded.edits).toEqual({ "0000": plan().edits[0] });
    expect(encoded.assignments.t2).toEqual({ teamId: "t2", order: 1, judges: [] });
    expect(encoded.room).toBe("Rice 011");
    expect(encoded.pool).toEqual(plan().pool);
  });

  test("a panel with no judges field gets an empty one, and missing lists encode as empty", () => {
    const encoded = encodeDraft({ assignments: { t1: { teamId: "t1" } } });
    expect(encoded).toEqual({ ranked: {}, edits: {}, assignments: { t1: { teamId: "t1", judges: [] } } });
    expect(encodeDraft({})).toEqual({ ranked: {}, edits: {}, assignments: {} });
  });

  test("keys sort as numbers would, past ten", () => {
    const ranked = Array.from({ length: 12 }, (_, i) => ({ teamId: `t${i}` }));
    expect(decodeDraft(encodeDraft({ ranked })).ranked).toEqual(ranked);
  });
});

describe("decoding", () => {
  test("round-trips a plan exactly", () => {
    expect(decodeDraft(encodeDraft(plan()))).toEqual(plan());
  });

  test("puts keyed lists back in key order however they are stored", () => {
    const raw = { ranked: { "0002": "c", "0000": "a", "0001": "b" } };
    expect(decodeDraft(raw).ranked).toEqual(["a", "b", "c"]);
  });

  test("drops the holes Realtime Database leaves in an array", () => {
    expect(decodeDraft({ pool: [judge("j1"), null, judge("j3")] }).pool).toEqual([judge("j1"), judge("j3")]);
  });

  test("puts back the empty lists and maps the database dropped", () => {
    expect(decodeDraft({ assignments: { t1: { teamId: "t1" } }, edits: { "0000": { kind: "drop" } } })).toEqual({
      ranked: [],
      pool: [],
      assignments: { t1: { teamId: "t1", judges: [] } },
      edits: [{ kind: "drop", orderBefore: [], before: null }],
      basis: { cardCounts: {}, eligibleJudges: {} },
    });
  });

  test("an edit's saved panel is decoded too", () => {
    const raw = { edits: { "0000": { before: { teamId: "t1", judges: { "0001": judge("j2"), "0000": judge("j1") } } } } };
    expect(decodeDraft(raw).edits[0].before).toEqual({ teamId: "t1", judges: [judge("j1"), judge("j2")] });
  });

  test("keeps the rest of the basis alongside the defaults", () => {
    expect(decodeDraft({ basis: { size: 3, room: "R" } }).basis).toEqual({ size: 3, room: "R", cardCounts: {}, eligibleJudges: {} });
  });

  test("nothing at all decodes to an empty draft", () => {
    const empty = { ranked: [], pool: [], assignments: {}, edits: [], basis: { cardCounts: {}, eligibleJudges: {} } };
    expect(decodeDraft(undefined)).toEqual(empty);
    expect(decodeDraft({ assignments: { t1: null }, edits: [null, { orderBefore: null }] })).toEqual({
      ...empty,
      assignments: { t1: { judges: [] } },
      edits: [{ orderBefore: [], before: null }],
    });
  });
});

describe("saving", () => {
  test("a first save stamps who made it and stores version one", async () => {
    await expect(saveFinalDraft(plan())).resolves.toEqual({ ok: true, version: 1 });
    expect(db.getData(FINAL_DRAFT_PATH)).toMatchObject({
      version: 1,
      createdAt: expect.any(Number),
      createdBy: "admin-1",
      createdByName: "Ada Byron",
    });
    expect(decodeDraft(db.getData(FINAL_DRAFT_PATH))).toMatchObject({ ...plan(), version: 1 });
  });

  test("a later save keeps the original stamp and bumps the version", async () => {
    db.setData(FINAL_DRAFT_PATH, { version: 4, createdAt: 11, createdBy: "admin-2", createdByName: "Grace" });
    await expect(saveFinalDraft(plan({ version: 4 }))).resolves.toEqual({ ok: true, version: 5 });
    expect(db.getData(FINAL_DRAFT_PATH)).toMatchObject({ version: 5, createdAt: 11, createdBy: "admin-2", createdByName: "Grace" });
  });

  test("a plan with no version saves as version one", async () => {
    await expect(saveFinalDraft(plan({ version: undefined }))).resolves.toEqual({ ok: true, version: 1 });
  });

  test("the save is a transaction that is not applied locally first", async () => {
    const transaction = vi.spyOn(db.module, "runTransaction");
    await saveFinalDraft(plan());
    expect(transaction).toHaveBeenCalledWith(expect.objectContaining({ path: FINAL_DRAFT_PATH }), expect.any(Function), {
      applyLocally: false,
    });
  });

  test("a draft discarded while editing is not brought back", async () => {
    await expect(saveFinalDraft(plan({ version: 2 }))).resolves.toEqual({
      ok: false,
      error:
        "This draft was discarded while you were editing it. Build a new plan; your edits cannot be re-applied to a draft that no longer exists.",
    });
    expect(db.getData(FINAL_DRAFT_PATH)).toBeNull();
  });

  test("a draft someone else moved on is refused, naming them or not", async () => {
    db.setData(FINAL_DRAFT_PATH, { version: 3, createdByName: "Grace" });
    await expect(saveFinalDraft(plan({ version: 2 }))).resolves.toEqual({
      ok: false,
      error: "Grace changed this draft while you were looking. Reload the planner to pick up their version.",
    });
    db.setData(FINAL_DRAFT_PATH, { version: 3 });
    await expect(saveFinalDraft(plan({ version: 2 }))).resolves.toEqual({
      ok: false,
      error: "Another organizer changed this draft while you were looking. Reload the planner to pick up their version.",
    });
    expect(db.getData(`${FINAL_DRAFT_PATH}/version`)).toBe(3);
  });

  test("losing the race at the write names whoever won, or not", async () => {
    const real = db.module.runTransaction;
    const race = (winner) =>
      vi.spyOn(db.module, "runTransaction").mockImplementationOnce(async (ref, updater, options) => {
        db.setData(FINAL_DRAFT_PATH, winner);
        return real(ref, updater, options);
      });

    race({ version: 1, createdByName: "Grace" });
    await expect(saveFinalDraft(plan())).resolves.toEqual({
      ok: false,
      error: "Grace saved this draft first. Reload the planner to pick up their version.",
    });

    db.setData(FINAL_DRAFT_PATH, null);
    race({ version: 1 });
    await expect(saveFinalDraft(plan())).resolves.toEqual({
      ok: false,
      error: "Another organizer saved this draft first. Reload the planner to pick up their version.",
    });
  });

  test("only an admin can save, and other failures are reported in words", async () => {
    db.setData("admins", null);
    await expect(saveFinalDraft(plan())).resolves.toEqual({ ok: false, error: "Only an admin can save the final round draft" });

    db.setData("admins", { "admin-1": true });
    const realGet = db.module.get;
    vi.spyOn(db.module, "get").mockImplementation((ref) => (ref.path === FINAL_DRAFT_PATH ? Promise.reject(new Error("")) : realGet(ref)));
    await expect(saveFinalDraft(plan())).resolves.toEqual({ ok: false, error: "The draft could not be saved." });
    expect(console.error).toHaveBeenCalledWith("Could not save the final round draft:", expect.any(Error));
  });
});

describe("reading, clearing and watching", () => {
  test("reads the decoded draft, or null when there is none", async () => {
    await expect(readFinalDraft()).resolves.toBeNull();
    db.setData(FINAL_DRAFT_PATH, encodeDraft(plan({ version: 2 })));
    await expect(readFinalDraft()).resolves.toEqual(plan({ version: 2 }));
  });

  test("a refused read is null, and logged", async () => {
    db.setData("admins", null);
    await expect(readFinalDraft()).resolves.toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      "Could not read the final round draft:",
      expect.objectContaining({ message: "Only an admin can read the final round draft" })
    );
  });

  test("clearing removes it", async () => {
    db.setData(FINAL_DRAFT_PATH, { version: 1 });
    await expect(clearFinalDraft()).resolves.toEqual({ ok: true });
    expect(db.getData(FINAL_DRAFT_PATH)).toBeNull();
  });

  test("only an admin can clear it", async () => {
    db.setData(FINAL_DRAFT_PATH, { version: 1 });
    db.setData("admins", null);
    await expect(clearFinalDraft()).resolves.toEqual({ ok: false, error: "Only an admin can clear the final round draft" });
    expect(console.error).toHaveBeenCalledWith("Could not clear the final round draft:", expect.any(Error));
    expect(db.getData(FINAL_DRAFT_PATH)).toEqual({ version: 1 });
  });

  test("watching delivers each decoded version until stopped", () => {
    const seen = [];
    const stop = subscribeFinalDraft((draft) => seen.push(draft && draft.version));
    db.setData(FINAL_DRAFT_PATH, encodeDraft(plan({ version: 1 })));
    db.setData(FINAL_DRAFT_PATH, encodeDraft(plan({ version: 2 })));
    stop();
    db.setData(FINAL_DRAFT_PATH, encodeDraft(plan({ version: 3 })));
    expect(seen).toEqual([null, 1, 2]);
  });

  test("a failed watch delivers null, and logs it", () => {
    const denied = new Error("PERMISSION_DENIED");
    vi.spyOn(db.module, "onValue").mockImplementation((_ref, _ok, fail) => {
      fail(denied);
      return () => {};
    });
    const callback = vi.fn();
    subscribeFinalDraft(callback);
    expect(callback).toHaveBeenCalledWith(null);
    expect(console.error).toHaveBeenCalledWith("Failed to subscribe to the final round draft:", denied);
  });
});
