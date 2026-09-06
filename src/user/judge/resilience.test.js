/**
 * The parts that are supposed to work when the network does not.
 *
 * The failure these exist to prevent: a judge fills in a card on venue wifi,
 * taps submit, the write never lands, and the score is gone with no one aware
 * of it until the totals are short a judge.
 */
import {
  enqueue,
  listPending,
  pendingCount,
  hasPendingFor,
  removeEntry,
  flushPending,
  withTimeout,
  subscribeToPending,
  STORAGE_KEY,
} from "./pendingScores";
import { saveDraft, loadDraft, clearDraft } from "./scoreDraft";
import { readJson, writeJson, isAvailable } from "./localStore";
import * as localStore from "./localStore";

const card = { problem: 8, innovation: 7, impact: 9, viability: 4, pitch_quality: 4 };
const entry = (overrides = {}) => ({
  round: "first",
  teamId: "team-1",
  teamName: "Team One",
  judgeUid: "judge-1",
  score: card,
  ...overrides,
});

beforeEach(() => {
  window.localStorage.clear();
});

describe("the outbox survives what the dialog does not", () => {
  test("a queued card is still there after a reload", () => {
    enqueue(entry());
    // listPending re-reads storage rather than trusting an in-memory copy,
    // which is the whole point -- the tab may not be the same tab
    expect(listPending("judge-1")).toHaveLength(1);
    expect(listPending("judge-1")[0].score).toEqual(card);
  });

  test("submitting the same card twice queues one entry, not two", () => {
    enqueue(entry());
    enqueue(entry({ score: { ...card, problem: 3 } }));

    const queued = listPending("judge-1");
    expect(queued).toHaveLength(1);
    // the later attempt wins: it is what the judge last saw on screen
    expect(queued[0].score.problem).toBe(3);
  });

  test("different teams and rounds queue separately", () => {
    enqueue(entry());
    enqueue(entry({ teamId: "team-2" }));
    enqueue(entry({ round: "final" }));
    expect(pendingCount("judge-1")).toBe(3);
  });

  test("one judge cannot see another judge's queue on a shared device", () => {
    enqueue(entry());
    enqueue(entry({ judgeUid: "judge-2", teamId: "team-9" }));

    expect(pendingCount("judge-1")).toBe(1);
    expect(pendingCount("judge-2")).toBe(1);
    expect(pendingCount()).toBe(2);
  });

  test("hasPendingFor identifies the exact card", () => {
    enqueue(entry());
    expect(hasPendingFor({ round: "first", teamId: "team-1", judgeUid: "judge-1" })).toBe(true);
    expect(hasPendingFor({ round: "final", teamId: "team-1", judgeUid: "judge-1" })).toBe(false);
  });

  test("corrupt storage is treated as an empty queue, not a crash", () => {
    window.localStorage.setItem("ideathon:pendingScores:v1", "{not json");
    expect(listPending()).toEqual([]);
    expect(() => enqueue(entry())).not.toThrow();
  });

  test("subscribers are told when the queue changes", () => {
    const seen = jest.fn();
    const stop = subscribeToPending(seen);
    enqueue(entry());
    expect(seen).toHaveBeenCalled();
    stop();
  });
});

/**
 * Two tabs of the judging page -- a restored tab and a PWA relaunch, say --
 * each queuing a card at the same moment.
 *
 * `enqueue` used to be readAll() -> filter -> push -> writeAll() with no
 * check in between. Tab A reads the queue, tab B reads the same queue before
 * A writes, and whichever of them writes second silently replaces the
 * other's queued card with a list that never had it -- the tab that queued
 * first has no way to know its card just vanished from the outbox.
 *
 * The spy below simulates that interleaving without needing two real tabs:
 * it lets this test's own `enqueue` call read the queue once, and in that
 * exact gap -- before this call has written anything back -- runs a second,
 * real `enqueue` call standing in for the other tab.
 */
describe("enqueue racing a second tab", () => {
  test("a card queued by another tab in the gap before this write is not overwritten", () => {
    enqueue(entry({ teamId: "team-1" })); // already queued, from earlier

    const realReadJson = localStore.readJson;
    let storageReads = 0;
    const spy = jest.spyOn(localStore, "readJson").mockImplementation((key, fallback) => {
      const result = realReadJson(key, fallback);
      if (key === STORAGE_KEY) {
        storageReads += 1;
        // The first read this call makes of the queue -- simulate the other
        // tab's enqueue landing right after, before this call writes back.
        if (storageReads === 1) {
          spy.mockRestore();
          enqueue(entry({ teamId: "team-2" }));
        }
      }
      return result;
    });

    enqueue(entry({ teamId: "team-3" }));

    expect(listPending("judge-1").map((e) => e.teamId).sort()).toEqual([
      "team-1",
      "team-2",
      "team-3",
    ]);
  });
});

describe("flushing", () => {
  test("a successful send clears the entry", async () => {
    enqueue(entry());
    const write = jest.fn(async () => {});

    const result = await flushPending(write, { judgeUid: "judge-1" });

    expect(result).toEqual({ synced: 1, failed: 0 });
    expect(write).toHaveBeenCalledTimes(1);
    expect(pendingCount("judge-1")).toBe(0);
  });

  test("a failed send keeps the card and counts the attempt", async () => {
    enqueue(entry());
    const write = jest.fn(async () => {
      throw new Error("offline");
    });

    const result = await flushPending(write, { judgeUid: "judge-1" });

    expect(result).toEqual({ synced: 0, failed: 1 });
    // losing the card on a failed retry would be worse than never retrying
    expect(pendingCount("judge-1")).toBe(1);
    expect(listPending("judge-1")[0].attempts).toBe(1);
    expect(listPending("judge-1")[0].lastError).toBe("offline");
  });

  test("retrying is safe to do repeatedly", async () => {
    enqueue(entry());
    const write = jest.fn(async () => {
      throw new Error("still offline");
    });

    await flushPending(write, { judgeUid: "judge-1" });
    await flushPending(write, { judgeUid: "judge-1" });
    await flushPending(write, { judgeUid: "judge-1" });

    expect(listPending("judge-1")[0].attempts).toBe(3);
    expect(pendingCount("judge-1")).toBe(1);
  });

  test("one failure does not block the rest of the queue", async () => {
    enqueue(entry({ teamId: "good-1" }));
    enqueue(entry({ teamId: "bad" }));
    enqueue(entry({ teamId: "good-2" }));

    const write = jest.fn(async (e) => {
      if (e.teamId === "bad") throw new Error("nope");
    });

    const result = await flushPending(write, { judgeUid: "judge-1" });

    expect(result).toEqual({ synced: 2, failed: 1 });
    expect(listPending("judge-1").map((e) => e.teamId)).toEqual(["bad"]);
  });

  test("an empty queue does no work", async () => {
    const write = jest.fn();
    expect(await flushPending(write)).toEqual({ synced: 0, failed: 0 });
    expect(write).not.toHaveBeenCalled();
  });

  test("only the named judge's cards are sent", async () => {
    enqueue(entry());
    enqueue(entry({ judgeUid: "judge-2", teamId: "team-2" }));
    const write = jest.fn(async () => {});

    await flushPending(write, { judgeUid: "judge-1" });

    expect(write).toHaveBeenCalledTimes(1);
    expect(pendingCount("judge-2")).toBe(1);
  });

  test("removeEntry drops exactly one card", () => {
    enqueue(entry());
    enqueue(entry({ teamId: "team-2" }));
    removeEntry("first:team-1:judge-1");
    expect(listPending("judge-1").map((e) => e.teamId)).toEqual(["team-2"]);
  });
});

describe("withTimeout", () => {
  test("passes a value through when it resolves in time", async () => {
    await expect(withTimeout(Promise.resolve("done"), 50)).resolves.toBe("done");
  });

  test("rejects when the write hangs", async () => {
    // this is the real failure: the SDK buffers the write in memory and
    // `await set(...)` simply never settles, so the button said "Submitting…"
    // forever with no way to tell whether the score had landed
    const hangs = new Promise(() => {});
    await expect(withTimeout(hangs, 10)).rejects.toThrow("timed-out");
  });

  test("passes the original rejection through", async () => {
    await expect(withTimeout(Promise.reject(new Error("denied")), 50)).rejects.toThrow("denied");
  });
});

describe("drafts", () => {
  const target = { round: "first", teamId: "team-1", judgeUid: "judge-1" };

  test("what was typed comes back", () => {
    saveDraft(target, { problem: "8", notes: "strong pitch" });
    expect(loadDraft(target)).toEqual({ problem: "8", notes: "strong pitch" });
  });

  test("a draft is scoped to judge, team and round", () => {
    saveDraft(target, { problem: "8" });

    expect(loadDraft({ ...target, judgeUid: "judge-2" })).toBeNull();
    expect(loadDraft({ ...target, teamId: "team-2" })).toBeNull();
    expect(loadDraft({ ...target, round: "final" })).toBeNull();
  });

  test("clearing removes it", () => {
    saveDraft(target, { problem: "8" });
    clearDraft(target);
    expect(loadDraft(target)).toBeNull();
  });

  test("an incomplete target is ignored rather than writing a junk key", () => {
    expect(saveDraft({ round: "first" }, { problem: "8" })).toBe(false);
    expect(loadDraft({ round: "first" })).toBeNull();
  });

  test("a corrupt draft reads as absent", () => {
    window.localStorage.setItem("ideathon:scoreDraft:v1:first:team-1:judge-1", "{oops");
    expect(loadDraft(target)).toBeNull();
  });
});

describe("localStore never throws", () => {
  test("reports availability", () => {
    expect(isAvailable()).toBe(true);
  });

  test("a browser refusing storage degrades to no-draft, not an exception", () => {
    const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    // the moment this runs is mid-submit, which is the worst possible place
    // for an unhandled throw
    expect(writeJson("k", { a: 1 })).toBe(false);
    expect(isAvailable()).toBe(false);
    expect(readJson("k", "fallback")).toBe("fallback");

    setItem.mockRestore();
  });
});

/**
 * Two things that only go wrong when the flush and the judge overlap.
 *
 * The judging screen drains the outbox on mount and again on the rising edge of
 * `.info/connected`, which lands milliseconds later — so two flushes running at
 * once is the ordinary case, not a rare one. Both bugs below were reachable
 * with nothing more exotic than a judge correcting a card on a bad network.
 */
describe("a flush racing the judge", () => {
  test("a card re-submitted mid-flush is not thrown away", async () => {
    enqueue(entry({ score: { ...card, problem: 1 } }));

    let land;
    const write = jest.fn(() => new Promise((resolve) => { land = resolve; }));

    const flush = flushPending(write, { judgeUid: "judge-1" });
    await Promise.resolve();

    // the judge notices a mistake and submits again while the first write hangs
    enqueue(entry({ score: { ...card, problem: 10 } }));
    expect(listPending("judge-1")[0].score.problem).toBe(10);

    land();
    await flush;

    // the entry id is stable per judge/team/round, so a flush that removed "the
    // entry with this id" on success deleted the correction and left the stale
    // card as the one that landed
    const left = listPending("judge-1");
    expect(left).toHaveLength(1);
    expect(left[0].score.problem).toBe(10);
  });

  test("overlapping flushes send each card once, not twice", async () => {
    enqueue(entry());

    const settle = [];
    const write = jest.fn(() => new Promise((resolve) => { settle.push(resolve); }));

    const first = flushPending(write, { judgeUid: "judge-1" });
    const second = flushPending(write, { judgeUid: "judge-1" });
    await Promise.resolve();

    settle.forEach((resolve) => resolve());
    await Promise.all([first, second]);

    expect(write).toHaveBeenCalledTimes(1);
    expect(listPending("judge-1")).toHaveLength(0);
  });

  test("a card queued during a flush is still sent by the run behind it", async () => {
    enqueue(entry());

    const settle = [];
    const write = jest.fn(() => new Promise((resolve) => { settle.push(resolve); }));

    const first = flushPending(write, { judgeUid: "judge-1" });
    await Promise.resolve();

    // arrives too late for the running flush, which already took its snapshot
    enqueue(entry({ teamId: "team-2" }));
    const second = flushPending(write, { judgeUid: "judge-1" });

    for (let tick = 0; tick < 6; tick += 1) {
      settle.forEach((resolve) => resolve());
      await Promise.resolve();
    }
    await Promise.all([first, second]);

    expect(listPending("judge-1")).toHaveLength(0);
  });
});
