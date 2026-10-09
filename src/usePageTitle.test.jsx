/**
 * usePageTitle owns the browser tab title for as long as a page is on screen,
 * and has to hand it back untouched the moment that page goes away. Without the
 * restore, a tab keeps announcing a page the reader has already navigated off
 * -- which is the bug the hook exists to prevent -- so both halves are tested:
 * the title it sets while mounted, and the one it puts back on unmount.
 *
 * The suffix is asserted against EVENT.name rather than a literal "Ideathon",
 * so the test tracks the single source of the event name instead of pinning a
 * second copy of it here.
 */
import { render } from "@testing-library/react";
import { EVENT } from "./eventInfo";
import usePageTitle from "./usePageTitle";

// a throwaway host: the hook only runs inside a component, and mounting then
// unmounting this is exactly the lifecycle the hook hooks into
function Page({ title }) {
  usePageTitle(title);
  return null;
}

describe("usePageTitle", () => {
  test("sets '<title> · <event name>' while the component is mounted", () => {
    render(<Page title="Register" />);
    expect(document.title).toBe(`Register · ${EVENT.name}`);
  });

  test("restores the previous title when the component unmounts", () => {
    document.title = "Something that was already here";
    const before = document.title;

    const { unmount } = render(<Page title="Register" />);
    expect(document.title).toBe(`Register · ${EVENT.name}`);

    unmount();
    expect(document.title).toBe(before);
  });
});
