/**
 * The gate on the public pages.
 *
 * The property that matters is which way it fails. A build with nothing set
 * must be CLOSED: the site goes live weeks before the event, and forgetting the
 * flag should keep strangers out rather than let them in.
 *
 * The flag is compiled in rather than read from `/config` because of the one
 * place it has to work — somebody who is not signed in. The rules grant
 * `config` to `auth != null`, so a logged-out visitor cannot read a database
 * flag at all, and a gate built on one could never be lifted for the people it
 * is for.
 */

/** Re-import the module with a given environment, since the flag is read once. */
async function windowWith(value) {
  vi.resetModules();
  const previous = import.meta.env.VITE_REGISTRATION_OPEN;
  vi.stubEnv("VITE_REGISTRATION_OPEN", value);

  const mod = await import("./registrationWindow");
  vi.stubEnv("VITE_REGISTRATION_OPEN", previous);
  return mod;
}

describe("which way it fails", () => {
  test("nothing set is closed", async () => {
    expect((await windowWith(undefined)).REGISTRATION_OPEN).toBe(false);
  });

  test("an empty value is closed", async () => {
    expect((await windowWith("")).REGISTRATION_OPEN).toBe(false);
  });

  test("anything other than the exact word is closed", async () => {
    for (const value of ["1", "yes", "TRUE", "True", "open", "false"]) {
      expect((await windowWith(value)).REGISTRATION_OPEN).toBe(false);
    }
  });

  test("only the exact word opens it", async () => {
    expect((await windowWith("true")).REGISTRATION_OPEN).toBe(true);
  });
});

describe("the way in while the doors are shut", async () => {
  const { isStaffEntrance } = await import("./registrationWindow");

  test("the parameter lets an organizer reach the sign-in form", () => {
    expect(isStaffEntrance("?staff")).toBe(true);
    expect(isStaffEntrance("?staff=1")).toBe(true);
    expect(isStaffEntrance("?next=/x&staff")).toBe(true);
  });

  test("an ordinary visitor does not have it", () => {
    expect(isStaffEntrance("")).toBe(false);
    expect(isStaffEntrance(undefined)).toBe(false);
    expect(isStaffEntrance("?other=1")).toBe(false);
  });

  test("a near miss is not it, so a guess has to be exact", () => {
    expect(isStaffEntrance("?staffing=1")).toBe(false);
    expect(isStaffEntrance("?Staff")).toBe(false);
  });
});
