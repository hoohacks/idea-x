const { diffSnapshot } = await import("./snapshotDiff");

const entries = (obj) =>
  Object.entries(obj).map(([path, value]) => ({ path, value: JSON.stringify(value) }));

test("counts what changes per path", () => {
  const result = diffSnapshot(
    entries({ teams: { t1: { name: "A" }, t2: { name: "B" } } }),
    { teams: { t1: { name: "A" }, t3: { name: "C" } } }
  );
  expect(result.byPath).toEqual([{ path: "teams", added: 1, changed: 0, removed: 1 }]);
});

test("a score present now and absent in the snapshot is named as a loss", () => {
  const result = diffSnapshot(
    entries({ "scores/round1": { t1: { j0: { total: 30 } } } }),
    { "scores/round1": { t1: { j0: { total: 30 }, j1: { total: 28 } } } }
  );
  expect(result.lostScores).toEqual([{ teamId: "t1", judgeUid: "j1" }]);
});

test("a score in the snapshot but not live is not a loss", () => {
  const result = diffSnapshot(
    entries({ "scores/round1": { t1: { j0: {}, j1: {} } } }),
    { "scores/round1": { t1: { j0: {} } } }
  );
  expect(result.lostScores).toEqual([]);
});

test("a null in the snapshot means the path did not exist", () => {
  const result = diffSnapshot(entries({ teams: null }), { teams: { t1: { name: "A" } } });
  expect(result.byPath[0].removed).toBe(1);
});

/**
 * The bare "scores" path -- what `JUDGING_PATHS` (src/user/admin/snapshots.js)
 * actually snapshots -- is `scores/{round}/{teamId}/{judgeUid}`, one level
 * deeper than the tests above, which all use an already round-scoped path
 * ("scores/round1"). This is exactly the path a "clear the schedule and
 * every score" restore point carries, so it is the highest-stakes shape for
 * `lostScores` to get right.
 */
describe("the bare \"scores\" path (round -> team -> judge, not team -> judge)", () => {
  test("names the real team and judge, not the round, as the loss", () => {
    const result = diffSnapshot(
      entries({
        scores: {
          round1: { t1: { j0: { total: 30 } } },
          final: { t2: { j1: { total: 40 } } },
        },
      }),
      {
        scores: {
          round1: { t1: { j0: { total: 30 }, j2: { total: 25 } } },
          final: { t2: { j1: { total: 40 } } },
        },
      }
    );
    // t1/j2 is the loss. If the round level were mistaken for the team
    // level, this would come back as { teamId: "round1", judgeUid: "t1" }
    // or similar instead. The bare "scores" path names the round too --
    // unlike a round-scoped path, it can hold the same team+judge in more
    // than one round, so which round is lost is part of what is lost.
    expect(result.lostScores).toEqual([{ teamId: "t1", judgeUid: "j2", round: "round1" }]);
  });

  test("a loss in a later round (not round1) is still found", () => {
    const result = diffSnapshot(
      entries({ scores: { final: { t3: { j0: { total: 10 } } } } }),
      { scores: { final: { t3: { j0: { total: 10 }, j5: { total: 5 } } } } }
    );
    expect(result.lostScores).toEqual([{ teamId: "t3", judgeUid: "j5", round: "final" }]);
  });

  test("the bare path and a round-scoped path in the same restore point are each walked correctly", () => {
    const result = diffSnapshot(
      entries({
        scores: { round1: { t1: { j0: { total: 1 } } } },
        "scores/round1": { t5: { j0: { total: 2 } } },
      }),
      {
        scores: { round1: { t1: { j0: { total: 1 }, j9: { total: 9 } } } },
        "scores/round1": { t5: { j0: { total: 2 }, j1: { total: 3 } } },
      }
    );
    expect(result.lostScores).toEqual([
      { teamId: "t1", judgeUid: "j9", round: "round1" }, // from the bare "scores" path
      { teamId: "t5", judgeUid: "j1" }, // from "scores/round1" -- already round-scoped, no round field
    ]);
  });

  test("byPath counts the bare \"scores\" path at card level, not round level", () => {
    const result = diffSnapshot(
      entries({
        scores: {
          round1: {
            t1: { j0: { total: 30 } }, // present in both, value differs -> changed
            t2: { j0: { total: 10 } }, // snapshot only -> added back by a restore
          },
        },
      }),
      {
        scores: {
          round1: {
            t1: { j0: { total: 99 } },
            t3: { j0: { total: 5 } }, // live only -> destroyed by a restore
          },
        },
      }
    );
    // Round-level counting would report one round ("round1") that merely
    // "changed", which is true on almost any score update and says nothing
    // about how much is at stake. Card-level counting says what a restore
    // actually does: one card comes back, one changes, one is destroyed.
    expect(result.byPath).toEqual([{ path: "scores", added: 1, changed: 1, removed: 1 }]);
    expect(result.lostScores).toEqual([{ teamId: "t3", judgeUid: "j0", round: "round1" }]);
    // The number this path reports as "removed" is not just some count --
    // it is exactly the number of cards lostScores goes on to name.
    expect(result.byPath[0].removed).toBe(result.lostScores.length);
  });
});

/**
 * A team+judge pair can legitimately appear in more than one round -- a
 * first-round judge who is not excluded from that team in the final is the
 * ordinary case, not an edge case. Flattening the bare "scores" path must
 * not let same team+judge cards from different rounds collide with each
 * other once the round level is merged away.
 */
describe("the same team+judge across rounds, in the bare \"scores\" path", () => {
  test("a card destroyed in one round is not hidden by an unchanged card for the same team+judge in another round", () => {
    const result = diffSnapshot(
      entries({ scores: { round1: { t1: { j0: { total: 30 } } } } }),
      {
        scores: {
          round1: { t1: { j0: { total: 30 } } }, // unchanged
          final: { t1: { j0: { total: 45 } } }, // not in the snapshot at all -- a real loss
        },
      }
    );
    expect(result.lostScores).toEqual([{ teamId: "t1", judgeUid: "j0", round: "final" }]);
    // the destroyed card must be counted, not masked by the unchanged
    // round1 card sharing the same team+judge
    expect(result.byPath).toEqual([{ path: "scores", added: 0, changed: 0, removed: 1 }]);
  });

  test("the same team+judge scored in both rounds, unchanged in both, is not a false loss", () => {
    const result = diffSnapshot(
      entries({
        scores: {
          round1: { t1: { j0: { total: 30 } } },
          final: { t1: { j0: { total: 99 } } },
        },
      }),
      {
        scores: {
          round1: { t1: { j0: { total: 30 } } },
          final: { t1: { j0: { total: 99 } } },
        },
      }
    );
    expect(result.lostScores).toEqual([]);
    expect(result.byPath).toEqual([{ path: "scores", added: 0, changed: 0, removed: 0 }]);
  });

  test("the same team+judge in both rounds, changed in only one, is counted as changed once", () => {
    const result = diffSnapshot(
      entries({
        scores: {
          round1: { t1: { j0: { total: 30 } } },
          final: { t1: { j0: { total: 99 } } },
        },
      }),
      {
        scores: {
          round1: { t1: { j0: { total: 50 } } }, // round1's card changed
          final: { t1: { j0: { total: 99 } } }, // final's card unchanged
        },
      }
    );
    expect(result.lostScores).toEqual([]);
    expect(result.byPath).toEqual([{ path: "scores", added: 0, changed: 1, removed: 0 }]);
  });
});
