import { push, ref } from "firebase/database";
import { database } from "../../../firebase.js";
import { applyAdminAction } from "../adminAction.js";
import { AUDIENCES, MAX_ANNOUNCEMENT_LENGTH } from "../../../announcements.js";

/**
 * Posting and taking down announcements. Both go through applyAdminAction, so
 * each is in the activity log with who did it, and can be undone from there.
 *
 * postedAt is the poster's clock rather than a server timestamp: the log's undo
 * compares what it wrote with what is stored, and a placeholder that the server
 * swaps for a number would never match.
 */
export async function postAnnouncement({ text, audience = "everyone" }) {
  const message = String(text ?? "").trim();
  if (!message) return { ok: false, error: "Write the announcement first." };
  if (message.length > MAX_ANNOUNCEMENT_LENGTH) {
    return { ok: false, error: `Keep it to ${MAX_ANNOUNCEMENT_LENGTH} characters so it fits on a phone.` };
  }
  if (!AUDIENCES.some((option) => option.value === audience)) {
    return { ok: false, error: "Pick who it is for." };
  }

  // a key made on this device; nothing is written until the action applies
  const id = push(ref(database, "announcements")).key;
  const short = message.length > 60 ? `${message.slice(0, 57)}...` : message;
  return applyAdminAction({
    action: "announcement.post",
    summary: `Announced to ${audience}: "${short}"`,
    changes: [
      {
        path: `announcements/${id}`,
        before: null,
        after: { text: message, audience, postedAt: Date.now(), active: true },
      },
    ],
  });
}

export async function takeDownAnnouncement(id, text = "") {
  const short = text.length > 60 ? `${text.slice(0, 57)}...` : text;
  return applyAdminAction({
    action: "announcement.takeDown",
    summary: `Took down: "${short}"`,
    changes: [{ path: `announcements/${id}/active`, before: true, after: false }],
  });
}
