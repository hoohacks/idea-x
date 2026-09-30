/**
 * Announcements, end to end inside the app: an organizer posts one, the right
 * people see it at the top of their page, a reader can dismiss it, and taking
 * it down removes it for everybody.
 *
 * The audience filter is the part that can quietly go wrong -- a judges-only
 * room change shown to every competitor is noise, and one for competitors that
 * never reaches them is worse -- so it is checked for each kind of account.
 */
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderPage } from "../../../testing/renderPage";
import { audienceLabel, readDismissed, rememberDismissed, visibleAnnouncements } from "../../../announcements";
import AnnouncementBanner from "../../AnnouncementBanner";
import AnnouncementsCard from "./AnnouncementsCard";

jest.mock("../../../firebase", () => ({ database: {}, storage: {}, auth: { currentUser: { uid: "admin-1" } } }));
jest.mock("firebase/database", () => require("../../../testing/fakeDatabase").module);
jest.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: { uid: "admin-1" } }) }));
const db = require("../../../testing/fakeDatabase");

const at = (hhmm) => new Date(`2026-10-25T${hhmm}:00-04:00`).getTime();
const announcements = {
  a1: { text: "Lunch is in the atrium.", audience: "everyone", postedAt: at("12:00"), active: true },
  a2: { text: "Judges: Rice 340 has moved to 342.", audience: "judges", postedAt: at("12:30"), active: true },
  a3: { text: "Competitors: decks due at 3.", audience: "competitors", postedAt: at("13:00"), active: true },
  a4: { text: "Old news.", audience: "everyone", postedAt: at("09:00"), active: false },
};

beforeEach(() => {
  window.localStorage.clear();
  db.reset({ admins: { "admin-1": true }, announcements });
});

describe("who sees what", () => {
  const texts = (userTypes, dismissed) => visibleAnnouncements(announcements, userTypes, dismissed).map((a) => a.id);

  test("a competitor sees everyone's and their own, newest first", () => {
    expect(texts(["competitor"])).toEqual(["a3", "a1"]);
  });

  test("a judge sees everyone's and the judges'", () => {
    expect(texts(["judge"])).toEqual(["a2", "a1"]);
  });

  test("an organizer sees every live one, whoever it is for", () => {
    expect(texts(["admin"])).toEqual(["a3", "a2", "a1"]);
  });

  test("taken-down and dismissed ones are gone", () => {
    expect(texts(["competitor"], ["a3"])).toEqual(["a1"]);
  });

  test("never more than three at once", () => {
    const many = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [`m${i}`, { text: `N${i}`, audience: "everyone", postedAt: i, active: true }])
    );
    expect(visibleAnnouncements(many, ["competitor"]).map((a) => a.id)).toEqual(["m4", "m3", "m2"]);
  });

  test("newest first however they were stored", () => {
    const shuffled = Object.fromEntries(
      [2, 0, 3, 1].map((i) => [`s${i}`, { text: `S${i}`, audience: "everyone", postedAt: i + 1, active: true }])
    );
    expect(visibleAnnouncements(shuffled, ["competitor"]).map((a) => a.id)).toEqual(["s3", "s2", "s1"]);
  });

  test("one with no posted time sorts as the oldest", () => {
    const undated = { ...announcements, a0: { text: "Undated.", audience: "everyone", active: true } };
    expect(visibleAnnouncements(undated, ["admin"]).map((a) => a.id)).toEqual(["a3", "a2", "a1"]);
    expect(visibleAnnouncements(undated, ["competitor"]).map((a) => a.id)).toEqual(["a3", "a1", "a0"]);
  });
});

describe("audience labels", () => {
  test("each audience has its label, and an unknown one reads as everyone", () => {
    expect(audienceLabel("judges")).toBe("Judges");
    expect(audienceLabel("competitors")).toBe("Competitors");
    expect(audienceLabel("nonsense")).toBe("Everyone");
    expect(audienceLabel(undefined)).toBe("Everyone");
  });
});

describe("remembering dismissals", () => {
  const KEY = "ideathon.dismissedAnnouncements";

  test("round-trips through storage", () => {
    rememberDismissed(["a1", "a2"]);
    expect(readDismissed()).toEqual(["a1", "a2"]);
  });

  test("keeps only the latest fifty", () => {
    const ids = Array.from({ length: 60 }, (_, i) => `id${i}`);
    rememberDismissed(ids);
    expect(readDismissed()).toEqual(ids.slice(10));
  });

  test("nothing stored, bad JSON, or a non-list all read as none dismissed", () => {
    expect(readDismissed()).toEqual([]);
    window.localStorage.setItem(KEY, "{bad json");
    expect(readDismissed()).toEqual([]);
    window.localStorage.setItem(KEY, JSON.stringify({ a1: true }));
    expect(readDismissed()).toEqual([]);
  });
});

describe("the banner", () => {
  test("shows a competitor what is for them, and not the judges' note", () => {
    renderPage(<AnnouncementBanner />, { auth: { userTypes: ["competitor"] } });
    const region = within(screen.getByRole("region", { name: "Announcements" }));
    expect(region.getByText("Lunch is in the atrium.")).toBeInTheDocument();
    expect(region.getByText("Competitors: decks due at 3.")).toBeInTheDocument();
    expect(region.queryByText(/Rice 340/)).not.toBeInTheDocument();
    expect(region.queryByText("Old news.")).not.toBeInTheDocument();
  });

  test("a dismissed one stays dismissed in this browser", () => {
    const { unmount } = renderPage(<AnnouncementBanner />, { auth: { userTypes: ["competitor"] } });
    const lunch = screen.getByText("Lunch is in the atrium.").closest('[role="alert"]');
    fireEvent.click(within(lunch).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Lunch is in the atrium.")).not.toBeInTheDocument();
    unmount();

    renderPage(<AnnouncementBanner />, { auth: { userTypes: ["competitor"] } });
    expect(screen.queryByText("Lunch is in the atrium.")).not.toBeInTheDocument();
    expect(screen.getByText("Competitors: decks due at 3.")).toBeInTheDocument();
  });

  test("a new one appears without a reload", () => {
    renderPage(<AnnouncementBanner />, { auth: { userTypes: ["judge"] } });
    act(() => {
      db.setData("announcements/a5", { text: "Final round in Rice 011.", audience: "judges", postedAt: at("16:00"), active: true });
    });
    expect(screen.getByText("Final round in Rice 011.")).toBeInTheDocument();
  });

  test("nothing live means no banner at all", () => {
    db.reset({ announcements: { a4: announcements.a4 } });
    renderPage(<AnnouncementBanner />, { auth: { userTypes: ["competitor"] } });
    expect(screen.queryByRole("region", { name: "Announcements" })).not.toBeInTheDocument();
  });
});

describe("posting and taking down", () => {
  test("posting writes the message, who it is for, and a time, and logs it", async () => {
    db.reset({ admins: { "admin-1": true } });
    renderPage(<AnnouncementsCard />);
    fireEvent.change(screen.getByLabelText("Announcement"), { target: { value: "  Dinner at 6 in the lobby.  " } });
    fireEvent.click(within(screen.getByRole("group", { name: "Send to" })).getByRole("button", { name: "Competitors" }));
    fireEvent.click(screen.getByRole("button", { name: "Post announcement" }));

    expect(await screen.findByText("Posted to competitors.")).toBeInTheDocument();
    const [stored] = Object.values(db.getData("announcements"));
    expect(stored).toMatchObject({ text: "Dinner at 6 in the lobby.", audience: "competitors", active: true });
    expect(typeof stored.postedAt).toBe("number");
    expect(Object.values(db.getData("adminLog"))[0].action).toBe("announcement.post");
    // the box is cleared for the next one, and the live list shows it
    expect(screen.getByLabelText("Announcement")).toHaveValue("");
    expect(screen.getByText("Showing now")).toBeInTheDocument();
  });

  test("an empty or overlong message cannot be posted", () => {
    renderPage(<AnnouncementsCard />);
    const button = screen.getByRole("button", { name: "Post announcement" });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Announcement"), { target: { value: "x".repeat(281) } });
    expect(button).toBeDisabled();
    expect(screen.getByText("281 / 280")).toBeInTheDocument();
  });

  test("taking one down marks it inactive, which hides it everywhere", async () => {
    renderPage(<AnnouncementsCard />);
    const lunch = screen.getByText("Lunch is in the atrium.").parentElement.parentElement;
    fireEvent.click(within(lunch).getByRole("button", { name: "Take down" }));

    await waitFor(() => expect(db.getData("announcements/a1/active")).toBe(false));
    expect(screen.queryByText("Lunch is in the atrium.")).not.toBeInTheDocument();
    // the rest of the record is kept, so the log can undo it
    expect(db.getData("announcements/a1/text")).toBe("Lunch is in the atrium.");
  });
});
