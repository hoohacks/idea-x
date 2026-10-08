/**
 * Where a score card is filed, and what happens when the write does not land.
 *
 * The path is the whole contract: scores/{round}/{teamId}/{judgeUid}. A card
 * filed under the wrong round, team or judge is a score that silently counts
 * for somebody else, so every write here is read back from that exact path.
 */
vi.mock("../../firebase.js", () => ({ database: {} }));
vi.mock("firebase/database", async () => (await import("../../testing/fakeDatabase")).module);
const mockCurrentUser = { value: { uid: "j1" } };
vi.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: mockCurrentUser.value }) }));

const db = await import("../../testing/fakeDatabase");
const {
  FIRST_ROUND,
  FINAL_ROUND,
  findTeamIdByName,
  submitScore,
  syncPendingScores,
  writeScoreOnBehalf,
  getMyScoredTeamIds,
  getMyFinalRoundScoredTeamIds,
  getTeamSubmission,
} = await import("./getTeamInfo");
const { listPending } = await import("./pendingScores");

const score = { idea: 8, pitch: 7, flagged: false };

beforeEach(() => {
  mockCurrentUser.value = { uid: "j1" };
  window.localStorage.clear();
  db.reset({
    teams: { t1: { name: "Lantern", submission: { idea: "A lamp", deck: "https://deck" } }, t2: { name: "Circles" } },
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("the two rounds are stored under 'first' and 'final'", () => {
  expect(FIRST_ROUND).toBe("first");
  expect(FINAL_ROUND).toBe("final");
});

describe("a judge submitting their own card", () => {
  test("files it under round, team and judge, stamped as the judge's own", async () => {
    await expect(submitScore({ round: FIRST_ROUND, teamId: "t1", teamName: "Lantern", score })).resolves.toEqual({
      status: "saved",
    });
    const stored = db.getData("scores/first/t1/j1");
    expect(stored).toEqual({
      ...score,
      judgeUid: "j1",
      teamId: "t1",
      teamName: "Lantern",
      enteredBy: "j1",
      source: "judge",
      submittedAt: expect.any(Number),
    });
    expect(listPending()).toEqual([]);
  });

  test("a refused write is queued on the device instead of lost", async () => {
    db.failWrites(1);
    const result = await submitScore({ round: FINAL_ROUND, teamId: "t2", teamName: "Circles", score });
    expect(result).toEqual({ status: "queued", reason: expect.stringContaining("PERMISSION_DENIED") });
    expect(db.getData("scores")).toBeNull();
    expect(listPending("j1")).toEqual([
      expect.objectContaining({ round: "final", teamId: "t2", teamName: "Circles", judgeUid: "j1", score }),
    ]);
  });

  test("a card with no team id is queued, not written anywhere", async () => {
    const result = await submitScore({ round: FIRST_ROUND, teamId: undefined, teamName: "Ghost", score });
    expect(result).toEqual({ status: "queued", reason: 'No team id for "Ghost"' });
    expect(db.writes).toEqual([]);
  });

  test("a non-Error rejection still gives a reason", async () => {
    vi.spyOn(db.module, "set").mockImplementation(() => Promise.reject("socket closed"));
    const result = await submitScore({ round: FIRST_ROUND, teamId: "t1", teamName: "Lantern", score });
    expect(result).toEqual({ status: "queued", reason: "socket closed" });
  });

  test("a rejection with no error at all still queues the card", async () => {
    vi.spyOn(db.module, "set").mockImplementation(() => Promise.reject(undefined));
    const result = await submitScore({ round: FIRST_ROUND, teamId: "t1", teamName: "Lantern", score });
    expect(result).toEqual({ status: "queued", reason: "undefined" });
  });

  test("when the device will not store it either, the judge is told to use paper", async () => {
    db.failWrites(1);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    await expect(submitScore({ round: FIRST_ROUND, teamId: "t1", teamName: "Lantern", score })).rejects.toThrow(
      "Could not reach the database, and this device will not let the score be saved locally either. " +
        "Write the scores down and give them to an organizer."
    );
  });

  test("refuses when nobody is signed in", async () => {
    mockCurrentUser.value = null;
    await expect(submitScore({ round: FIRST_ROUND, teamId: "t1", teamName: "Lantern", score })).rejects.toThrow(
      "Must be signed in"
    );
  });
});

describe("syncing the outbox", () => {
  test("sends this judge's queued cards to their proper paths", async () => {
    db.failWrites(1);
    await submitScore({ round: FIRST_ROUND, teamId: "t1", teamName: "Lantern", score });
    expect(db.getData("scores")).toBeNull();

    await expect(syncPendingScores("j1")).resolves.toEqual({ synced: 1, failed: 0 });
    expect(db.getData("scores/first/t1/j1")).toMatchObject({ ...score, judgeUid: "j1", source: "judge" });
    expect(listPending()).toEqual([]);
  });

  test("leaves another judge's queued cards on this device alone", async () => {
    db.failWrites(2);
    await submitScore({ round: FIRST_ROUND, teamId: "t1", teamName: "Lantern", score });
    mockCurrentUser.value = { uid: "j2" };
    await submitScore({ round: FIRST_ROUND, teamId: "t2", teamName: "Circles", score });

    await expect(syncPendingScores("j1")).resolves.toEqual({ synced: 1, failed: 0 });
    expect(db.getData("scores/first/t2")).toBeNull();
    expect(listPending().map((entry) => entry.judgeUid)).toEqual(["j2"]);
  });
});

describe("an organizer keying in a paper card", () => {
  test("files it under the judge chosen, marked as entered by the organizer", async () => {
    mockCurrentUser.value = { uid: "admin-1" };
    await writeScoreOnBehalf({ round: FIRST_ROUND, teamId: "t1", teamName: "Lantern", judgeUid: "j7", score });
    expect(db.getData("scores/first/t1/j7")).toEqual({
      ...score,
      judgeUid: "j7",
      teamId: "t1",
      teamName: "Lantern",
      enteredBy: "admin-1",
      source: "paper",
      submittedAt: expect.any(Number),
    });
  });

  test("refuses without a team or without a judge", async () => {
    await expect(
      writeScoreOnBehalf({ round: FIRST_ROUND, teamId: "", teamName: "Lantern", judgeUid: "j7", score })
    ).rejects.toThrow('No team id for "Lantern"');
    await expect(
      writeScoreOnBehalf({ round: FIRST_ROUND, teamId: "t1", teamName: "Lantern", judgeUid: "", score })
    ).rejects.toThrow("A judge must be chosen for the score");
    expect(db.writes).toEqual([]);
  });

  test("refuses when nobody is signed in", async () => {
    mockCurrentUser.value = null;
    await expect(
      writeScoreOnBehalf({ round: FIRST_ROUND, teamId: "t1", teamName: "Lantern", judgeUid: "j7", score })
    ).rejects.toThrow("Must be signed in");
  });
});

describe("which cards this judge has already filed", () => {
  beforeEach(() => {
    db.setData("scores", {
      first: { t1: { j1: score }, t2: { j2: score } },
      final: { t2: { j1: score } },
    });
  });

  test("first round counts only this judge's cards in the first round", async () => {
    expect([...(await getMyScoredTeamIds(["t1", "t2", "t3"]))]).toEqual(["t1"]);
  });

  test("final round counts only this judge's cards in the final round", async () => {
    expect([...(await getMyFinalRoundScoredTeamIds(["t1", "t2"]))]).toEqual(["t2"]);
  });

  test("blank and repeated ids are ignored, and no ids asks nothing", async () => {
    const get = vi.spyOn(db.module, "get");
    expect([...(await getMyScoredTeamIds(["t1", "", null, "t1"]))]).toEqual(["t1"]);
    expect(get).toHaveBeenCalledTimes(1);

    get.mockClear();
    expect([...(await getMyScoredTeamIds(undefined))]).toEqual([]);
    expect([...(await getMyScoredTeamIds([]))]).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  test("one failed check costs only that team, not the whole set", async () => {
    const realGet = db.module.get;
    vi
      .spyOn(db.module, "get")
      .mockImplementation((ref) => (ref.path.includes("/t2/") ? Promise.reject(new Error("offline")) : realGet(ref)));
    db.setData("scores/first/t2/j1", score);
    expect([...(await getMyScoredTeamIds(["t1", "t2"]))]).toEqual(["t1"]);
    expect(console.warn).toHaveBeenCalledWith("Could not check whether t2 is already scored:", expect.any(Error));
  });

  test("refuses when nobody is signed in", async () => {
    mockCurrentUser.value = null;
    await expect(getMyScoredTeamIds(["t1"])).rejects.toThrow("Must be signed in");
  });
});

describe("a team's submission", () => {
  test("is read from the team's submission node", async () => {
    await expect(getTeamSubmission("t1")).resolves.toEqual({ idea: "A lamp", deck: "https://deck" });
  });

  test("is null when the team has not submitted, or no team is given", async () => {
    await expect(getTeamSubmission("t2")).resolves.toBeNull();
    const get = vi.spyOn(db.module, "get");
    await expect(getTeamSubmission("")).resolves.toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});

describe("the legacy lookup by team name", () => {
  const answer = (value) =>
    vi.spyOn(db.module, "get").mockResolvedValue({ exists: () => value !== null, val: () => value });

  test("returns the matching team's id", async () => {
    const query = vi.spyOn(db.module, "query");
    const equalTo = vi.spyOn(db.module, "equalTo");
    const orderByChild = vi.spyOn(db.module, "orderByChild");
    answer({ t1: { name: "Lantern" } });
    await expect(findTeamIdByName("Lantern")).resolves.toBe("t1");
    expect(query.mock.calls[0][0]).toEqual(expect.objectContaining({ path: "teams" }));
    expect(orderByChild).toHaveBeenCalledWith("name");
    expect(equalTo).toHaveBeenCalledWith("Lantern");
    expect(console.warn).not.toHaveBeenCalled();
  });

  test("no match is null", async () => {
    answer(null);
    await expect(findTeamIdByName("Nobody")).resolves.toBeNull();
  });

  test("two teams sharing a name falls back to the first, with a warning", async () => {
    answer({ t1: { name: "Lantern" }, t9: { name: "Lantern" } });
    await expect(findTeamIdByName("Lantern")).resolves.toBe("t1");
    expect(console.warn).toHaveBeenCalledWith('Multiple teams are named "Lantern"; falling back to the first match.');
  });

  test("an account not allowed to search teams gets null, not an error", async () => {
    const denied = new Error("PERMISSION_DENIED");
    vi.spyOn(db.module, "get").mockRejectedValue(denied);
    await expect(findTeamIdByName("Lantern")).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalledWith("Team name lookup is not permitted for this account:", denied);
  });
});
