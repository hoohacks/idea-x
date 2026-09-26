import { hasRole } from "./roles.js";

/**
 * Organizer announcements: "Lunch is in the atrium", "Rice 340 has moved to
 * 342". There is no server to send an email or a push, so the one channel that
 * reaches everyone during the day is the app they already have open. These sit
 * at the top of every signed-in page until an organizer takes them down or the
 * reader dismisses them.
 *
 * Stored at announcements/{id} as { text, audience, postedAt, active }; the
 * rules hold the same shape.
 */

export const MAX_ANNOUNCEMENT_LENGTH = 280;

export const AUDIENCES = [
  { value: "everyone", label: "Everyone" },
  { value: "competitors", label: "Competitors" },
  { value: "judges", label: "Judges" },
];

export function audienceLabel(value) {
  return AUDIENCES.find((audience) => audience.value === value)?.label ?? "Everyone";
}

/** At most this many at once; an organizer posting a fourth has buried the first. */
const SHOWN = 3;

/**
 * What one person should see, newest first.
 *
 * Organizers see every live announcement, whoever it is for, so they can tell
 * what is up without switching accounts. Someone who is both a judge and a
 * competitor sees what either is sent.
 */
export function visibleAnnouncements(all, userTypes, dismissed = []) {
  const admin = hasRole(userTypes, "admin");
  const forMe = (audience) =>
    admin ||
    audience === "everyone" ||
    (audience === "competitors" && hasRole(userTypes, "competitor")) ||
    (audience === "judges" && hasRole(userTypes, "judge"));

  return Object.entries(all ?? {})
    .map(([id, announcement]) => ({ id, ...announcement }))
    .filter((announcement) => announcement.active === true && announcement.text && forMe(announcement.audience))
    .filter((announcement) => !dismissed.includes(announcement.id))
    .sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0))
    .slice(0, SHOWN);
}

// Dismissals are per browser. Storage can be missing or refuse (a private
// window, blocked site data), and then an announcement simply stays up.
const DISMISSED_KEY = "ideathon.dismissedAnnouncements";

export function readDismissed() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DISMISSED_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function rememberDismissed(ids) {
  try {
    // only the recent ones matter; old ids are never shown again anyway
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids.slice(-50)));
  } catch {
    // nothing to do: it will show again next visit
  }
}
