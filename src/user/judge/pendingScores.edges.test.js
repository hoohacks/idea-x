/**
 * The score outbox's edges: what counts as a queued card, one card per judge,
 * team and round, the revision that tells a re-submission from the original,
 * the retry when another tab writes in between, and the flush's bookkeeping.
 * resilience.test.js and draftConcurrency.test.js cover the races in depth.
 */
import {
  STORAGE_KEY,
  SUBMIT_TIMEOUT_MS,
  subscribeToPending,
  listPending,
  pendingCount,
  hasPendingFor,
  enqueue,
  removeEntry,
  flushPending,
  withTimeout,
} from "./pendingScores";

const card = (overrides = {}) => ({ round: "first", teamId: "t1", teamName: "Lantern", judgeUid: "j1", score: { problem: 5 }, ...overrides });
const stored = () => JSON.parse(window.localStorage.getItem(STORAGE_KEY));

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("the queue's storage key never changes, or a deploy would orphan cards already queued on devices", () => {
  expect(STORAGE_KEY).toBe("ideathon:pendingScores:v1");
});

test("an unacknowledged write is given eight seconds", () => {
  expect(SUBMIT_TIMEOUT_MS).toBe(8000);
});

describe("what is in the queue", () => {
  test("entries without a team or a round, or that are not records, are ignored", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([null, { teamId: "t1" }, { round: "first" }, card({ id: "ok" }), "junk"])
    );
    expect(listPending()).toEqual([card({ id: "ok" })]);
  });

  test("a queue that is not a list is empty", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ a: card() }));
    expect(listPending()).toEqual([]);
    expect(pendingCount()).toBe(0);
  });

  test("listed per judge, or for everyone", () => {
    enqueue(card());
    enqueue(card({ judgeUid: "j2" }));
    expect(listPending("j2").map((e) => e.judgeUid)).toEqual(["j2"]);
    expect(pendingCount()).toBe(2);
    expect(pendingCount("j1")).toBe(1);
  });

  test("a pending card matches on round, team and judge, all three", () => {
    enqueue(card());
    expect(hasPendingFor({ round: "first", teamId: "t1", judgeUid: "j1" })).toBe(true);
    expect(hasPendingFor({ round: "final", teamId: "t1", judgeUid: "j1" })).toBe(false);
    expect(hasPendingFor({ round: "first", teamId: "t2", judgeUid: "j1" })).toBe(false);
    expect(hasPendingFor({ round: "first", teamId: "t1", judgeUid: "j2" })).toBe(false);
  });

  test("with several queued, any one matching is enough", () => {
    enqueue(card({ teamId: "t2" }));
    enqueue(card());
    expect(hasPendingFor({ round: "first", teamId: "t1", judgeUid: "j1" })).toBe(true);
  });
});

describe("queueing a card", () => {
  test("stores it with an id, a revision, the time, and no attempts yet", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    expect(enqueue(card())).toBe(true);
    expect(stored()).toEqual([
      {
        ...card(),
        id: "first:t1:j1",
        revision: expect.stringMatching(/^1000-\d+$/),
        queuedAt: 1000,
        attempts: 0,
        lastError: null,
      },
    ]);
  });

  test("re-submitting replaces only that card, with a newer revision", () => {
    enqueue(card({ teamId: "t2" }));
    enqueue(card({ round: "final" }));
    enqueue(card({ judgeUid: "j2" }));
    enqueue(card());
    const first = stored().find((e) => e.id === "first:t1:j1").revision;
    enqueue(card({ score: { problem: 9 } }));
    const queue = stored();
    expect(queue).toHaveLength(4);
    const replaced = queue.find((e) => e.id === "first:t1:j1");
    expect(replaced.score).toEqual({ problem: 9 });
    expect(Number(replaced.revision.split("-")[1])).toBeGreaterThan(Number(first.split("-")[1]));
  });

  test("another tab writing in between is re-read, not overwritten", () => {
    enqueue(card({ teamId: "other" }));
    const realGet = Storage.prototype.getItem;
    let reads = 0;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function getItem(key) {
      reads += 1;
      // the second read is the re-check right before the write: land another tab's card first
      if (key === STORAGE_KEY && reads === 2) {
        const now = JSON.parse(realGet.call(this, key));
        now.push({ ...card({ teamId: "tab2" }), id: "first:tab2:j1" });
        window.localStorage.setItem.call(this, key, JSON.stringify(now));
      }
      return realGet.call(this, key);
    });
    enqueue(card());
    expect(stored().map((e) => e.teamId).sort()).toEqual(["other", "t1", "tab2"]);
  });

  test("under contention that never stops it still queues the card after a few tries", () => {
    const realGet = Storage.prototype.getItem;
    let reads = 0;
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function getItem(key) {
      if (key !== STORAGE_KEY) return realGet.call(this, key);
      reads += 1;
      return JSON.stringify([{ ...card({ teamId: `noise${reads}` }), id: `n${reads}` }]);
    });
    expect(enqueue(card())).toBe(true);
    get.mockRestore();
    expect(stored().map((e) => e.teamId)).toContain("t1");
    // a first read, then five rounds of re-checks, then the final read it commits against
    expect(reads).toBe(7);
  });

  test("a device that refuses storage reports it", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(enqueue(card())).toBe(false);
  });
});

describe("listening", () => {
  test("hears every change until it stops, and one bad listener does not silence the rest", () => {
    const heard = vi.fn();
    const broken = subscribeToPending(() => {
      throw new Error("broken");
    });
    const stop = subscribeToPending(heard);
    enqueue(card());
    removeEntry("first:t1:j1");
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    broken();
    enqueue(card());
    expect(heard).toHaveBeenCalledTimes(2);
  });
});

describe("flushing", () => {
  test("an empty queue sends nothing", async () => {
    const write = vi.fn();
    await expect(flushPending(write)).resolves.toEqual({ synced: 0, failed: 0 });
    expect(write).not.toHaveBeenCalled();
  });

  test("sends each card, removes what landed, and counts attempts and the reason on what did not", async () => {
    enqueue(card());
    enqueue(card({ teamId: "t2" }));
    enqueue(card({ teamId: "t3" }));
    const write = vi.fn(async (entry) => {
      if (entry.teamId === "t2") throw new Error("offline");
      if (entry.teamId === "t3") throw "socket closed";
    });
    await expect(flushPending(write)).resolves.toEqual({ synced: 1, failed: 2 });
    expect(stored().map(({ teamId, attempts, lastError }) => ({ teamId, attempts, lastError }))).toEqual([
      { teamId: "t2", attempts: 1, lastError: "offline" },
      { teamId: "t3", attempts: 1, lastError: "socket closed" },
    ]);
    await flushPending(async () => {
      throw undefined;
    });
    expect(stored().map((e) => [e.attempts, e.lastError])).toEqual([
      [2, "undefined"],
      [2, "undefined"],
    ]);
  });

  test("a card removed while its write failed is not brought back", async () => {
    enqueue(card());
    await flushPending(async () => {
      removeEntry("first:t1:j1");
      throw new Error("offline");
    });
    expect(stored()).toEqual([]);
  });

  test("only that judge's cards, when asked", async () => {
    enqueue(card());
    enqueue(card({ judgeUid: "j2" }));
    const write = vi.fn(async () => {});
    await flushPending(write, { judgeUid: "j2" });
    expect(write).toHaveBeenCalledTimes(1);
    expect(stored().map((e) => e.judgeUid)).toEqual(["j1"]);
  });
});

describe("the deadline", () => {
  test("a write that answers in time passes its result through and leaves no timer", async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.resolve("done"), 50)).resolves.toBe("done");
    expect(vi.getTimerCount()).toBe(0);
  });

  test("a write that does not answer is given up on at the deadline, not before", async () => {
    vi.useFakeTimers();
    let settled = false;
    const pending = withTimeout(new Promise(() => {}), 100).catch((error) => {
      settled = true;
      return error.message;
    });
    vi.advanceTimersByTime(99);
    await Promise.resolve();
    expect(settled).toBe(false);
    vi.advanceTimersByTime(1);
    await expect(pending).resolves.toBe("timed-out");
  });

  test("defaults to the submit timeout", async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise(() => {})).catch((error) => error.message);
    vi.advanceTimersByTime(SUBMIT_TIMEOUT_MS);
    await expect(pending).resolves.toBe("timed-out");
  });
});
