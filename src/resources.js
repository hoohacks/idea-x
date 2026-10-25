import { hasRole } from "./roles.js";
import { instantToEventLocal } from "./eventInfo.js";

/**
 * Links organizers post for the day: the judging rubric, a video on pitching.
 * Competitors see every one; judges only those marked forJudges.
 *
 * Stored at resources/{id} as { title, url, description?, forJudges, order,
 * createdAt }; the rules hold the same shape. config/resourcesShowNow puts them
 * on the home page outside event hours.
 */

export const MAX_RESOURCE_TITLE = 80;
export const MAX_RESOURCE_DESCRIPTION = 140;

/** A link people will tap from a phone on the day: https only, nothing else. */
export function isResourceUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** Every resource as a list, in the order organizers set. */
export function sortedResources(all) {
  return Object.entries(all ?? {})
    .map(([id, resource]) => ({ id, ...resource }))
    .filter((resource) => resource.title && resource.url)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

/**
 * What one person should see. Organizers see all of them, so the home page
 * shows them what everyone else is getting; someone who is both a competitor
 * and a judge gets the competitor list, which is every resource.
 */
export function visibleResources(all, userTypes) {
  const everything = hasRole(userTypes, "admin") || hasRole(userTypes, "competitor");
  const judge = hasRole(userTypes, "judge");
  return sortedResources(all).filter((resource) => everything || (judge && resource.forJudges === true));
}

/**
 * Whether the home page shows resources at all: from the start of the event to
 * the end of that day in the event's zone, so a final round running past 7:30
 * still has the rubric, or whenever organizers have switched them on early.
 * Pure and takes `now`, like eventPhase.
 */
export function resourcesOpen(start, now = new Date(), showNow = false) {
  if (showNow === true) return true;
  const startedAt = start instanceof Date ? start : new Date(String(start ?? ""));
  if (Number.isNaN(startedAt.getTime())) return false;
  if (now.getTime() < startedAt.getTime()) return false;
  return instantToEventLocal(now).slice(0, 10) === instantToEventLocal(startedAt).slice(0, 10);
}

/** Which kind of link, for the card's icon. */
export function resourceKind(url) {
  let host = "";
  let path = "";
  try {
    const parsed = new URL(url);
    host = parsed.hostname.replace(/^www\./, "");
    path = parsed.pathname.toLowerCase();
  } catch {
    return "link";
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") return "video";
  if (path.endsWith(".pdf")) return "pdf";
  if (host === "docs.google.com" || host === "drive.google.com") return "doc";
  return "link";
}
