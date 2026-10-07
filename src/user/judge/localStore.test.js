/**
 * The device storage under the score outbox and the card drafts. Every
 * operation has to survive storage that is missing, refuses writes (a full or
 * private-mode browser), or holds something corrupt -- a throw here would take
 * the judge's score with it.
 */
import { readJson, writeJson, removeKey, isAvailable } from "./localStore";

const PROBE = "__ideathon_probe__";

beforeEach(() => window.localStorage.clear());
afterEach(() => jest.restoreAllMocks());

const refuse = (method) =>
  jest.spyOn(Storage.prototype, method).mockImplementation(() => {
    throw new Error("QuotaExceededError");
  });

describe("with working storage", () => {
  test("round-trips JSON, and leaves no probe behind", () => {
    expect(writeJson("k", { a: [1, 2] })).toBe(true);
    expect(readJson("k")).toEqual({ a: [1, 2] });
    expect(window.localStorage.getItem(PROBE)).toBeNull();
    expect(isAvailable()).toBe(true);
  });

  test("a missing key gives the fallback, or null by default", () => {
    expect(readJson("missing")).toBeNull();
    expect(readJson("missing", [])).toEqual([]);
  });

  test("a stored null is a value, not a missing key", () => {
    window.localStorage.setItem("k", "null");
    expect(readJson("k", "fallback")).toBeNull();
  });

  test("a corrupt entry gives the fallback instead of throwing", () => {
    window.localStorage.setItem("k", "{not json");
    expect(readJson("k", "fallback")).toBe("fallback");
  });

  test("removing deletes the key", () => {
    writeJson("k", 1);
    removeKey("k");
    expect(window.localStorage.getItem("k")).toBeNull();
  });
});

describe("with storage that refuses", () => {
  test("a probe that cannot be written means storage is unavailable: reads fall back, writes fail", () => {
    window.localStorage.setItem("k", JSON.stringify("stored"));
    refuse("setItem");
    expect(isAvailable()).toBe(false);
    expect(readJson("k", "fallback")).toBe("fallback");
    expect(writeJson("k", 1)).toBe(false);
  });

  test("a write that throws after the probe passed reports failure", () => {
    const real = Storage.prototype.setItem;
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(function setItem(key, value) {
      if (key !== PROBE) throw new Error("QuotaExceededError");
      return real.call(this, key, value);
    });
    expect(writeJson("k", 1)).toBe(false);
  });

  test("a read that throws after the probe passed gives the fallback", () => {
    refuse("getItem");
    expect(readJson("k", "fallback")).toBe("fallback");
  });

  test("a removal that throws is swallowed", () => {
    const real = Storage.prototype.removeItem;
    const remove = jest.spyOn(Storage.prototype, "removeItem").mockImplementation(function removeItem(key) {
      if (key !== PROBE) throw new Error("SecurityError");
      return real.call(this, key);
    });
    expect(() => removeKey("k")).not.toThrow();
    expect(remove).toHaveBeenCalledWith("k");
  });

  test("with no storage at all, removal does not even try", () => {
    refuse("setItem");
    const remove = jest.spyOn(Storage.prototype, "removeItem");
    expect(() => removeKey("k")).not.toThrow();
    expect(remove).not.toHaveBeenCalled();
  });

  test("storage whose very access throws is unavailable", () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    try {
      expect(isAvailable()).toBe(false);
      expect(readJson("k", 7)).toBe(7);
      expect(writeJson("k", 1)).toBe(false);
    } finally {
      Object.defineProperty(window, "localStorage", descriptor);
    }
  });
});
