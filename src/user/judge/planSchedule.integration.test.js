/**
 * Building a first-round plan from a real (in-memory) event, with the real
 * config readers and admin check, and checking the whole result: every
 * warning and piece of advice word for word, the basis, and the names the
 * plan carries for hand editing.
 *
 * The scenarios are small enough to work out by hand. With one batch of two
 * teams and three judges at a panel target of three, the allocator seats
 * judge 0 on the first team and judges 1 and 2 on the second, so the first team
 * is seen by one judge only.
 */
jest.mock("../../firebase.js", () => ({ database: {} }));
jest.mock("firebase/database", () => require("../../testing/fakeDatabase").module);
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: { uid: "admin-1" } }) }));

const db = require("../../testing/fakeDatabase");
const { planSchedule } = require("./planSchedule");

const judge = (firstName, extra = {}) => ({ firstName, isRound1Judge: true, ...extra });

const event = ({ teams, judges, config = {} }) =>
  db.reset({
    admins: { "admin-1": true },
    config: { judgingRooms: ["Rice 340", "Rice 342", "Olsson 005"], batchCount: 1, ...config },
    teams,
    judges,
  });

beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe("a thin schedule", () => {
  beforeEach(() =>
    event({
      teams: {
        tb: { name: "Beacon", submitted: true },
        ta: { name: "Anchor", submitted: true },
        tx: { name: "Draft", submitted: false },
        tn: null,
      },
      judges: {
        jc: judge("Cy"),
        ja: judge("Ada", { lastName: "Byron" }),
        jb: judge("Bo"),
        jf: { firstName: "Fay", isFinalRoundJudge: true },
        jz: { firstName: "Unmarked" },
      },
    })
  );

  test("seats what it has, and says exactly which team is thin and what would fix it", async () => {
    const result = await planSchedule();
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(result.warnings).toEqual([
      "Some teams will be seen by only 1 judge. An average from one judge is that judge's opinion, and the final round is picked on averages.",
      "Seen by one judge only: Beacon. Add a judge to these from Judging progress.",
    ]);
    expect(result.advice).toEqual(["Mark 1 more first-round judge(s) to give every team at least 2."]);
  });

  test("assigns rooms in order, the batch time, and judges by full name", async () => {
    const { plan } = await planSchedule();
    expect(plan.assignments).toEqual({
      tb: {
        teamName: "Beacon",
        id: "tb",
        room: "Rice 340",
        time: "5:00 PM",
        batch: 1,
        judges: [{ judgeName: "Cy", judgeId: "jc" }],
      },
      ta: {
        teamName: "Anchor",
        id: "ta",
        room: "Rice 342",
        time: "5:00 PM",
        batch: 1,
        judges: [
          { judgeName: "Ada Byron", judgeId: "ja" },
          { judgeName: "Bo", judgeId: "jb" },
        ],
      },
    });
  });

  test("records a sorted basis, the pickable judges' names, and who is final-round only", async () => {
    const { plan } = await planSchedule();
    expect(plan.basis).toEqual({
      teamIds: ["ta", "tb"],
      judgeIds: ["ja", "jb", "jc"],
      rooms: ["Rice 340", "Rice 342", "Olsson 005"],
      batchCount: 1,
      batchTimes: { 1: "5:00 PM", 2: "5:15 PM", 3: "5:30 PM" },
      target: 3,
    });
    expect(plan.onlyCheckedIn).toBe(false);
    expect(plan.judgeNames).toEqual({ jc: "Cy", ja: "Ada Byron", jb: "Bo", jf: "Fay" });
    expect(plan.finalOnlyJudgeIds).toEqual(["jf"]);
    expect(plan.teamNames).toEqual({ tb: "Beacon", ta: "Anchor" });
  });
});

describe("two thin teams, and a judge with no name", () => {
  test("lists both teams, and seats the nameless judge as unnamed", async () => {
    // three teams, four judges: seats go A, B, C, then B again
    event({
      teams: { a: { name: "A", submitted: true }, b: { name: "B", submitted: true }, c: { name: "C", submitted: true } },
      judges: { j0: judge(""), j1: judge("One"), j2: judge("Two"), j3: judge("Three") },
    });
    const { warnings, plan } = await planSchedule();
    expect(warnings).toContain("Seen by one judge only: A, C. Add a judge to these from Judging progress.");
    expect(plan.assignments.a.judges).toEqual([{ judgeName: "Unnamed Judge", judgeId: "j0" }]);
    expect(plan.judgeNames.j0).toBe("Unnamed Judge");
  });
});

describe("a surplus of judges", () => {
  test("names the spares and says how many are held back", async () => {
    event({
      teams: { t1: { name: "Solo", submitted: true } },
      judges: { j1: judge("A"), j2: judge("B"), j3: judge("C"), j4: judge("D"), j5: judge("", { lastName: "" }) },
    });
    const result = await planSchedule();
    expect(result.warnings).toEqual([
      "5 judges is more than 1 teams need. Panels are capped at 3 and roughly 2 judge(s) are held back per batch as spares.",
      "2 judge(s) have no assignment at all and are spares: D, Unnamed Judge.",
    ]);
    expect(result.advice).toEqual([
      "Spare judges have no assignment card. Keep them on hand for a no-show, or add them to a team from Judging progress.",
    ]);
    expect(result.plan.assignments.t1.judges.map((j) => j.judgeId)).toEqual(["j1", "j2", "j3"]);
  });
});

describe("an even schedule", () => {
  test("has nothing to warn about", async () => {
    event({
      teams: { t1: { name: "A", submitted: true }, t2: { name: "B", submitted: true } },
      judges: { j1: judge("A"), j2: judge("B"), j3: judge("C"), j4: judge("D"), j5: judge("E"), j6: judge("F") },
    });
    const result = await planSchedule();
    expect(result.warnings).toEqual([]);
    expect(result.advice).toEqual([]);
    expect(Object.values(result.plan.assignments).map((a) => a.judges.length)).toEqual([3, 3]);
  });
});

describe("several batches", () => {
  test("numbers the batches from one, times each from config, and leaves out an empty one", async () => {
    event({
      teams: { t1: { name: "A", submitted: true }, t2: { name: "B", submitted: true } },
      judges: { j1: judge("A"), j2: judge("B"), j3: judge("C") },
      config: { batchCount: 3, batchTimes: { 1: "6:00 PM" } },
    });
    const { plan } = await planSchedule();
    expect(Object.values(plan.assignments).map(({ batch, time, room }) => ({ batch, time, room }))).toEqual([
      { batch: 1, time: "6:00 PM", room: "Rice 340" },
      { batch: 2, time: "TBD", room: "Rice 340" },
    ]);
  });
});

describe("an unnamed team", () => {
  test("is scheduled as unnamed, with a warning", async () => {
    event({
      teams: { t1: { submitted: true }, t2: { name: "B", submitted: true } },
      judges: { j1: judge("A"), j2: judge("B"), j3: judge("C"), j4: judge("D") },
    });
    const { warnings, plan } = await planSchedule();
    expect(warnings).toContain("Some submitted teams have no name and will show up blank on the schedule.");
    expect(plan.assignments.t1.teamName).toBe("Unnamed Team");
    expect(plan.teamNames.t1).toBe("Unnamed Team");
  });
});

describe("the check-in filter", () => {
  const judges = { j1: judge("A", { checkedIn: true }), j2: judge("B", { checkedIn: true }), j3: judge("C"), j4: judge("D", { checkedIn: "yes" }) };
  const teams = { t1: { name: "A", submitted: true } };

  test("leaves out absent judges, counts them, and marks the plan", async () => {
    event({ teams, judges });
    const result = await planSchedule({ onlyCheckedIn: true });
    expect(result.warnings[0]).toBe("2 first round judge(s) have not checked in and were left out.");
    expect(result.plan.basis.judgeIds).toEqual(["j1", "j2"]);
    expect(result.plan.onlyCheckedIn).toBe(true);
  });

  test("with everyone checked in, says nothing about absences", async () => {
    event({ teams, judges: { j1: judge("A", { checkedIn: true }), j2: judge("B", { checkedIn: true }) } });
    const result = await planSchedule({ onlyCheckedIn: true });
    expect(result.warnings.join(" ")).not.toMatch(/checked in/);
  });

  test("off by default, so absent judges are seated", async () => {
    event({ teams, judges });
    const result = await planSchedule();
    expect(result.plan.basis.judgeIds).toEqual(["j1", "j2", "j3", "j4"]);
    expect(result.warnings.join(" ")).not.toMatch(/checked in/);
  });

  test("nobody checked in is refused with the way out", async () => {
    event({ teams, judges: { j3: judge("C") } });
    await expect(planSchedule({ onlyCheckedIn: true })).resolves.toEqual({
      ok: false,
      error:
        "None of the first round judges have checked in yet. Check them in on the Judge Search page, or build the plan without the check-in filter.",
      warnings: ["1 first round judge(s) have not checked in and were left out."],
      advice: [],
      plan: null,
    });
  });

  test("with nobody marked at all, the filter does not change the message", async () => {
    event({ teams, judges: { jz: { firstName: "Unmarked", checkedIn: true } } });
    await expect(planSchedule({ onlyCheckedIn: true })).resolves.toMatchObject({
      ok: false,
      error: "No judges are marked as first round judges. Mark them on the Judge Search page, then build the plan again.",
    });
  });
});

describe("refusals", () => {
  test("no judges or no teams registered", async () => {
    event({ teams: { t1: { name: "A", submitted: true } }, judges: null });
    await expect(planSchedule()).resolves.toEqual({
      ok: false,
      error: "There are no judges registered yet.",
      warnings: [],
      advice: [],
      plan: null,
    });
    event({ teams: null, judges: { j1: judge("A") } });
    await expect(planSchedule()).resolves.toMatchObject({ ok: false, error: "There are no teams registered yet." });
  });

  test("a supply problem comes back with its advice", async () => {
    event({ teams: { t1: { name: "A", submitted: true } }, judges: { j1: judge("A") }, config: { judgingRooms: null } });
    await expect(planSchedule()).resolves.toEqual({
      ok: false,
      error: "No judging rooms are configured. Add them on the control panel, then build the plan again.",
      warnings: [],
      advice: [],
      plan: null,
    });
  });

  test("only an admin can plan", async () => {
    event({ teams: {}, judges: {} });
    db.setData("admins", null);
    await expect(planSchedule()).resolves.toMatchObject({ ok: false, error: "Only an admin can plan the judging schedule" });
    expect(console.error).toHaveBeenCalledWith("Error planning judge schedule:", expect.any(Error));
  });

  test("an unexpected failure is reported, not thrown", async () => {
    event({ teams: {}, judges: {} });
    const realGet = db.module.get;
    jest.spyOn(db.module, "get").mockImplementation((ref) => (ref.path === "teams" ? Promise.reject(new Error("")) : realGet(ref)));
    await expect(planSchedule()).resolves.toMatchObject({ ok: false, error: "Something went wrong planning the schedule." });
  });
});
