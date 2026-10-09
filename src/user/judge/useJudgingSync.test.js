/**
 * Pending scores are queued per round, not just per team.
 *
 * `scores/first` and `scores/final` are separate database paths, queried
 * separately everywhere else -- but the outbox used to collapse a queued
 * card down to a bare team id, with no round attached. A judge who scored a
 * team offline in the first round then saw that same team's final-round card
 * report itself as "pending" too, even though the final card had never been
 * touched. The judge could not score a final pitch they owed until an
 * unrelated first-round entry finished draining.
 */
import { renderHook } from "@testing-library/react";

vi.mock("../../firebase", () => ({ database: {} }));
vi.mock("firebase/database", () => ({
  ref: (_db, path) => ({ path }),
  onValue: (_ref, cb) => {
    cb({ val: () => true });
    return () => {};
  },
}));

const mockList = vi.fn(() => []);
vi.mock("./pendingScores.js", () => ({
  listPending: (...args) => mockList(...args),
  subscribeToPending: () => () => {},
}));
vi.mock("./getTeamInfo.js", () => ({
  syncPendingScores: vi.fn(async () => ({ synced: 0, failed: 0 })),
  FIRST_ROUND: "first",
  FINAL_ROUND: "final",
}));

const { useJudgingSync } = await import("./useJudgingSync");

afterEach(() => {
  mockList.mockReset();
});

test("a queued first-round card does not mark the same team's final-round card pending", () => {
  mockList.mockReturnValue([{ teamId: "t1", round: "first", judgeUid: "j1" }]);
  const { result } = renderHook(() => useJudgingSync("j1"));

  expect(result.current.pendingTeamIdsByRound.first.has("t1")).toBe(true);
  expect(result.current.pendingTeamIdsByRound.final.has("t1")).toBe(false);
});

test("a queued final-round card does not mark the same team's first-round card pending", () => {
  mockList.mockReturnValue([{ teamId: "t1", round: "final", judgeUid: "j1" }]);
  const { result } = renderHook(() => useJudgingSync("j1"));

  expect(result.current.pendingTeamIdsByRound.final.has("t1")).toBe(true);
  expect(result.current.pendingTeamIdsByRound.first.has("t1")).toBe(false);
});
