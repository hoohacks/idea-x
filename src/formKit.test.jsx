/**
 * The registration forms' shared machinery: the autofill reconciliation, the
 * focus-on-error helper, and the small validators and messages.
 */
import { act, fireEvent, render } from "@testing-library/react";
import {
  EMAIL_PATTERN,
  MIN_PASSWORD,
  cleanName,
  focusField,
  isEmail,
  isFilled,
  joinList,
  outstandingMessage,
  useSyncedForm,
} from "./formKit";

describe("useSyncedForm", () => {
  let api;
  function Form({ initial }) {
    api = useSyncedForm(initial);
    const { formRef, values, handleChange } = api;
    return (
      <form ref={formRef}>
        <input name="email" value={values.email} onChange={handleChange} />
        <input name="first" value={values.first} onChange={handleChange} />
        <input name="agree" type="checkbox" checked={values.agree} onChange={handleChange} />
        <input name="count" value={String(values.count)} readOnly />
        <fieldset name="group" />
        <output data-testid="state">{JSON.stringify(values)}</output>
      </form>
    );
  }

  // "group" names a <fieldset>, whose value is not a string and must be left alone
  const initial = { email: "", first: "", agree: false, count: 3, missing: "", group: "" };
  // what a browser does when it autofills: writes the DOM and dispatches nothing
  const fillBehindReactsBack = (container, name, value) => {
    const input = container.querySelector(`[name="${name}"]`);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    return input;
  };
  const state = (getByTestId) => JSON.parse(getByTestId("state").textContent);

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("typing updates values, and a checkbox stores checked rather than its value", () => {
    const { container, getByTestId } = render(<Form initial={initial} />);
    fireEvent.change(container.querySelector('[name="first"]'), { target: { value: "Ada" } });
    fireEvent.click(container.querySelector('[name="agree"]'));
    expect(state(getByTestId)).toEqual({ ...initial, first: "Ada", agree: true });
  });

  test("collect picks up an autofilled field, and only string fields", () => {
    const { container, getByTestId } = render(<Form initial={initial} />);
    fillBehindReactsBack(container, "email", "ada@uva.edu");
    fillBehindReactsBack(container, "count", "99");

    let collected;
    act(() => {
      collected = api.collect();
    });
    expect(collected).toEqual({ ...initial, email: "ada@uva.edu" });
    expect(state(getByTestId)).toEqual({ ...initial, email: "ada@uva.edu" });
  });

  test("collect with nothing new hands back the same object", () => {
    render(<Form initial={initial} />);
    let first;
    let second;
    act(() => {
      first = api.collect();
      second = api.collect();
    });
    expect(first).toEqual(initial);
    expect(second).toBe(first);
  });

  test("two collects in one tick both see the autofilled value", () => {
    const { container } = render(<Form initial={initial} />);
    fillBehindReactsBack(container, "first", "Grace");
    let second;
    act(() => {
      api.collect();
      fillBehindReactsBack(container, "email", "g@h.io");
      second = api.collect();
    });
    expect(second).toMatchObject({ first: "Grace", email: "g@h.io" });
  });

  test.each([
    ["the first sweep after paint", () => vi.advanceTimersByTime(16)],
    ["the 300ms sweep", () => vi.advanceTimersByTime(300)],
    ["the 1.2s sweep", () => vi.advanceTimersByTime(1200)],
  ])("a late fill is caught by %s", (_label, advance) => {
    const { container, getByTestId } = render(<Form initial={initial} />);
    fillBehindReactsBack(container, "email", "late@fill.com");
    act(advance);
    expect(state(getByTestId).email).toBe("late@fill.com");
  });

  test("the 300ms and 1.2s sweeps each run on their own", () => {
    const { container, getByTestId } = render(<Form initial={initial} />);
    act(() => vi.advanceTimersByTime(50));
    fillBehindReactsBack(container, "email", "second@sweep.com");
    act(() => vi.advanceTimersByTime(300));
    expect(state(getByTestId).email).toBe("second@sweep.com");
    fillBehindReactsBack(container, "first", "Third");
    act(() => vi.advanceTimersByTime(900));
    expect(state(getByTestId).first).toBe("Third");
  });

  test("the autofill animation, a change and a focus each bank the DOM's values", () => {
    const { container, getByTestId } = render(<Form initial={initial} />);
    const email = fillBehindReactsBack(container, "email", "anim@x.io");
    act(() => {
      email.dispatchEvent(Object.assign(new Event("animationstart", { bubbles: true }), { animationName: "onAutofill" }));
    });
    expect(state(getByTestId).email).toBe("anim@x.io");

    fillBehindReactsBack(container, "first", "Focus");
    act(() => {
      container.querySelector('[name="first"]').dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(state(getByTestId).first).toBe("Focus");

    fillBehindReactsBack(container, "email", "changed@x.io");
    act(() => {
      container.querySelector('[name="count"]').dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(state(getByTestId).email).toBe("changed@x.io");
  });

  test("a field that stops its events bubbling is still collected, because the form listens first", () => {
    const { container, getByTestId } = render(<Form initial={initial} />);
    act(() => vi.advanceTimersByTime(2000));
    const email = container.querySelector('[name="email"]');
    ["animationstart", "change", "focusin"].forEach((type) => email.addEventListener(type, (e) => e.stopPropagation()));

    const fire = (type, value, extra = {}) => {
      fillBehindReactsBack(container, "email", value);
      act(() => {
        email.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), extra));
      });
      return state(getByTestId).email;
    };
    expect(fire("animationstart", "one@x.io", { animationName: "onAutofill" })).toBe("one@x.io");
    expect(fire("change", "two@x.io")).toBe("two@x.io");
    expect(fire("focusin", "three@x.io")).toBe("three@x.io");
  });

  test("some other animation starting does not collect", () => {
    const { container, getByTestId } = render(<Form initial={initial} />);
    act(() => vi.advanceTimersByTime(2000));
    const email = fillBehindReactsBack(container, "email", "fade@x.io");
    act(() => {
      email.dispatchEvent(Object.assign(new Event("animationstart", { bubbles: true }), { animationName: "fadeIn" }));
    });
    expect(state(getByTestId).email).toBe("");
  });

  test("after unmount no sweep or listener runs", () => {
    const { container, unmount } = render(<Form initial={initial} />);
    const form = container.querySelector("form");
    const removed = vi.spyOn(form, "removeEventListener");
    unmount();
    expect(removed.mock.calls.map(([type, , capture]) => [type, capture])).toEqual([
      ["animationstart", true],
      ["change", true],
      ["focusin", true],
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("setValue sets one field and keeps collect in step", () => {
    const { getByTestId } = render(<Form initial={initial} />);
    act(() => api.setValue("first", "Set"));
    expect(state(getByTestId).first).toBe("Set");
    let collected;
    act(() => {
      collected = api.collect();
    });
    expect(collected.first).toBe("Set");
  });

  test("without a form attached collect returns the values unchanged", () => {
    let hook;
    function NoForm() {
      hook = useSyncedForm({ a: "x" });
      return null;
    }
    render(<NoForm />);
    expect(hook.collect()).toEqual({ a: "x" });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("focusField", () => {
  const setup = (html) => {
    const form = document.createElement("form");
    form.innerHTML = html;
    document.body.appendChild(form);
    return { current: form };
  };
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("focuses the named field without jumping, and scrolls it to the middle", () => {
    const ref = setup('<input name="email" />');
    const input = ref.current.querySelector("input");
    input.scrollIntoView = vi.fn();
    const focus = vi.spyOn(input, "focus");
    focusField(ref, "email");
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(input.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    expect(document.activeElement).toBe(input);
  });

  test("skips a hidden input and focuses the element carrying the id instead", () => {
    const ref = setup('<input type="hidden" name="school" /><div id="school" tabindex="0"></div>');
    focusField(ref, "school");
    expect(document.activeElement).toBe(ref.current.querySelector("#school"));
  });

  test("a name that is not a valid selector, a missing field or no form does nothing", () => {
    const ref = setup('<input name="email" />');
    expect(() => focusField(ref, "1bad name")).not.toThrow();
    expect(() => focusField(ref, "nothing")).not.toThrow();
    expect(() => focusField({ current: null }, "email")).not.toThrow();
    expect(() => focusField(undefined, "email")).not.toThrow();
    expect(document.activeElement).toBe(document.body);
  });

  test("works where scrollIntoView does not exist", () => {
    const ref = setup('<input name="email" />');
    const input = ref.current.querySelector("input");
    input.scrollIntoView = undefined;
    expect(() => focusField(ref, "email")).not.toThrow();
    expect(document.activeElement).toBe(input);
  });
});

describe("validators", () => {
  test.each([
    ["ada@uva.edu", true],
    ["  ada@uva.edu  ", true],
    ["a@b.tech", true],
    ["a@b.online", true],
    ["a@b.c", false],
    ["a@b", false],
    ["a b@c.de", false],
    ["@c.de", false],
    ["a@.de", false],
    ["", false],
    [null, false],
    [undefined, false],
  ])("isEmail(%p) is %p", (value, expected) => {
    expect(isEmail(value)).toBe(expected);
  });

  test("the pattern is anchored at both ends", () => {
    expect(EMAIL_PATTERN.test("x a@b.cd")).toBe(false);
    expect(EMAIL_PATTERN.test("a@b.cd x")).toBe(false);
  });

  test("passwords need at least six characters", () => {
    expect(MIN_PASSWORD).toBe(6);
  });

  test.each([
    ["x", true],
    ["  x ", true],
    ["   ", false],
    ["", false],
    [null, false],
    [undefined, false],
    [0, true],
  ])("isFilled(%p) is %p", (value, expected) => {
    expect(isFilled(value)).toBe(expected);
  });

  test("cleanName trims and collapses whitespace but keeps hyphens, apostrophes and accents", () => {
    expect(cleanName("  Mary-Jane   O'Brien ")).toBe("Mary-Jane O'Brien");
    expect(cleanName("José\t\nÁlvarez")).toBe("José Álvarez");
    expect(cleanName(null)).toBe("");
    expect(cleanName(undefined)).toBe("");
  });
});

describe("messages", () => {
  test("joinList reads like a sentence", () => {
    expect(joinList([])).toBe("");
    expect(joinList(["name"])).toBe("name");
    expect(joinList(["name", "email"])).toBe("name and email");
    expect(joinList(["name", "email", "school"])).toBe("name, email and school");
  });

  test("outstandingMessage names up to three, and counts beyond that", () => {
    expect(outstandingMessage([])).toBe("");
    expect(outstandingMessage(["your name"])).toBe("Still needed: your name.");
    expect(outstandingMessage(["a", "b", "c"])).toBe("Still needed: a, b and c.");
    expect(outstandingMessage(["a", "b", "c", "d"])).toBe("4 answers still needed, starting with a.");
  });
});
