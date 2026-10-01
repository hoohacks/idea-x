/**
 * Score-card drafts on the judge's device: kept per judge, team and round, and
 * refused outright when any of the three is missing, because a draft filed
 * under "undefined" is one the next judge on a shared tablet would inherit.
 */
import { saveDraft, loadDraft, clearDraft } from "./scoreDraft";

const target = { round: "first", teamId: "t1", judgeUid: "j1" };
const KEY = "ideathon:scoreDraft:v1:first:t1:j1";

beforeEach(() => window.localStorage.clear());

test("a draft is saved under its judge, team and round, with the time", () => {
  jest.spyOn(Date, "now").mockReturnValue(1234);
  expect(saveDraft(target, { problem: 7, notes: "half done" })).toBe(true);
  expect(JSON.parse(window.localStorage.getItem(KEY))).toEqual({ values: { problem: 7, notes: "half done" }, savedAt: 1234 });
  expect(loadDraft(target)).toEqual({ problem: 7, notes: "half done" });
  jest.restoreAllMocks();
});

test("each judge, team and round has its own draft", () => {
  saveDraft(target, { problem: 1 });
  expect(loadDraft({ ...target, judgeUid: "j2" })).toBeNull();
  expect(loadDraft({ ...target, teamId: "t2" })).toBeNull();
  expect(loadDraft({ ...target, round: "final" })).toBeNull();
});

test("clearing removes only that draft", () => {
  saveDraft(target, { problem: 1 });
  saveDraft({ ...target, teamId: "t2" }, { problem: 2 });
  clearDraft(target);
  expect(loadDraft(target)).toBeNull();
  expect(loadDraft({ ...target, teamId: "t2" })).toEqual({ problem: 2 });
});

describe("a target missing any part is refused, never filed under a blank", () => {
  const partial = [
    ["no round", { teamId: "t1", judgeUid: "j1" }],
    ["no team", { round: "first", judgeUid: "j1" }],
    ["no judge", { round: "first", teamId: "t1" }],
    ["nothing", undefined],
  ];

  test.each(partial)("saving with %s does nothing", (_label, partialTarget) => {
    expect(saveDraft(partialTarget, { problem: 1 })).toBe(false);
    expect(window.localStorage.length).toBe(0);
  });

  test.each(partial)("loading with %s finds nothing", (_label, partialTarget) => {
    // something stored under the blank key it would otherwise have read
    window.localStorage.setItem(
      `ideathon:scoreDraft:v1:${partialTarget?.round}:${partialTarget?.teamId}:${partialTarget?.judgeUid}`,
      JSON.stringify({ values: { problem: 9 } })
    );
    expect(loadDraft(partialTarget)).toBeNull();
  });

  test.each(partial)("clearing with %s touches nothing", (_label, partialTarget) => {
    const blankKey = `ideathon:scoreDraft:v1:${partialTarget?.round}:${partialTarget?.teamId}:${partialTarget?.judgeUid}`;
    window.localStorage.setItem(blankKey, "kept");
    clearDraft(partialTarget);
    expect(window.localStorage.getItem(blankKey)).toBe("kept");
  });
});

test("a stored draft with no values, or values that are not an object, loads as nothing", () => {
  for (const stored of [{}, { values: null }, { values: "text" }, { values: 3 }]) {
    window.localStorage.setItem(KEY, JSON.stringify(stored));
    expect(loadDraft(target)).toBeNull();
  }
  window.localStorage.setItem(KEY, "not json");
  expect(loadDraft(target)).toBeNull();
});
