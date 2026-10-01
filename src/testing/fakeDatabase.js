/**
 * An in-memory stand-in for `firebase/database`, for page tests.
 *
 * The render smoke tests stub every read as empty, which proves a page does not
 * crash and nothing more: a dashboard with no rows has no buttons to press. This
 * holds a real tree, answers `onValue` and `get` from it, and applies `update`,
 * `set` and `remove` to it -- so a page re-renders after a write exactly as it
 * would against the database, and a test can both click through a page and read
 * back what it wrote.
 *
 * Use it from a test file with a factory that requires it, since jest.mock
 * factories may not close over module scope:
 *
 *   jest.mock("firebase/database", () => require("../../testing/fakeDatabase").module);
 *   const db = require("../../testing/fakeDatabase");
 *   beforeEach(() => db.reset({ judges: { j1: { firstName: "Ada" } } }));
 *
 * Deliberately small: no queries, no transactions, no security rules. Rules are
 * tested against the real emulator in test/rules.
 */

let tree = {};
const listeners = new Set();
export const writes = [];

const parts = (path) => String(path ?? "").split("/").filter(Boolean);

function read(path) {
  let node = tree;
  for (const key of parts(path)) {
    if (node === null || typeof node !== "object" || !(key in node)) return null;
    node = node[key];
  }
  return node === undefined ? null : node;
}

function write(path, value) {
  const keys = parts(path);
  if (keys.length === 0) {
    tree = value ?? {};
    return;
  }
  let node = tree;
  const trail = [];
  keys.slice(0, -1).forEach((key) => {
    if (node[key] === null || typeof node[key] !== "object") node[key] = {};
    trail.push([node, key]);
    node = node[key];
  });
  const last = keys[keys.length - 1];
  if (value === null || value === undefined) {
    delete node[last];
    // the real database has no empty nodes: removing the last child removes
    // the parent, all the way up
    for (const [parent, key] of trail.reverse()) {
      if (Object.keys(parent[key]).length) break;
      delete parent[key];
    }
  } else node[last] = value;
}

const clone = (value) => (value === null || value === undefined ? null : JSON.parse(JSON.stringify(value)));

function snapshot(path) {
  const value = clone(read(path));
  return {
    key: parts(path).pop() ?? null,
    exists: () => value !== null,
    val: () => value,
  };
}

function notify() {
  for (const listener of [...listeners]) listener.callback(snapshot(listener.path));
}

/** Replace the whole tree, and forget earlier writes and listeners' history. */
export function reset(initial = {}) {
  tree = clone(initial) ?? {};
  writes.length = 0;
  notify();
}

/** Put a value at a path, as another client would, and tell the listeners. */
export function setData(path, value) {
  write(path, clone(value));
  notify();
}

export const getData = (path) => clone(read(path));

/** Make the next writes reject, as a rule denial would. */
let failNext = 0;
export function failWrites(count = 1) {
  failNext = count;
}

function recordWrite(op, path, value) {
  writes.push({ op, path: parts(path).join("/"), value: clone(value) });
  if (failNext > 0) {
    failNext -= 1;
    return Promise.reject(new Error("PERMISSION_DENIED: Client doesn't have permission"));
  }
  return null;
}

export const module = {
  ref: (_db, path = "") => ({ path: parts(path).join("/"), key: parts(path).pop() ?? null }),
  child: (parent, path) => ({ path: [...parts(parent.path), ...parts(path)].join("/") }),
  onValue: (ref, callback) => {
    const listener = { path: ref.path, callback };
    listeners.add(listener);
    callback(snapshot(ref.path));
    return () => listeners.delete(listener);
  },
  off: () => {},
  get: async (ref) => snapshot(ref.path),
  set: async (ref, value) => {
    const denied = recordWrite("set", ref.path, value);
    if (denied) return denied;
    write(ref.path, clone(value));
    notify();
  },
  update: async (ref, values) => {
    const denied = recordWrite("update", ref.path, values);
    if (denied) return denied;
    for (const [key, value] of Object.entries(values ?? {})) {
      write([ref.path, key].filter(Boolean).join("/"), clone(value));
    }
    notify();
  },
  remove: async (ref) => {
    const denied = recordWrite("remove", ref.path, null);
    if (denied) return denied;
    write(ref.path, null);
    notify();
  },
  push: (ref) => {
    const key = `pushed-${writes.length}-${Math.random().toString(36).slice(2, 6)}`;
    return { path: [ref.path, key].join("/"), key };
  },
  runTransaction: async (ref, updater) => {
    const next = updater(clone(read(ref.path)));
    if (next === undefined) return { committed: false, snapshot: snapshot(ref.path) };
    const denied = recordWrite("transaction", ref.path, next);
    if (denied) return denied;
    write(ref.path, clone(next));
    notify();
    return { committed: true, snapshot: snapshot(ref.path) };
  },
  query: (ref) => ref,
  orderByChild: () => ({}),
  orderByKey: () => ({}),
  equalTo: () => ({}),
  limitToLast: () => ({}),
  serverTimestamp: () => Date.now(),
};
