import { push, ref } from "firebase/database";
import { database } from "../../../firebase.js";
import { applyAdminAction } from "../adminAction.js";
import { MAX_RESOURCE_DESCRIPTION, MAX_RESOURCE_TITLE, isResourceUrl } from "../../../resources.js";

/**
 * Adding, editing, ordering and removing resources, and the switch that shows
 * them outside event hours. Every write goes through applyAdminAction, so each
 * is in the activity log with who did it, and can be undone from there.
 *
 * createdAt is the poster's clock rather than a server timestamp, for the same
 * reason as an announcement's postedAt: the log's undo compares what it wrote
 * with what is stored.
 */

/** The same checks the rules make, with a message for each. */
function checkFields({ title, url, description, forJudges }) {
  const name = String(title ?? "").trim();
  const link = String(url ?? "").trim();
  const note = String(description ?? "").trim();
  if (!name) return { error: "Give the resource a title." };
  if (name.length > MAX_RESOURCE_TITLE) {
    return { error: `Keep the title to ${MAX_RESOURCE_TITLE} characters so it fits on a phone.` };
  }
  if (!isResourceUrl(link)) return { error: "The link has to start with https://." };
  if (note.length > MAX_RESOURCE_DESCRIPTION) {
    return { error: `Keep the description to ${MAX_RESOURCE_DESCRIPTION} characters so it fits on a phone.` };
  }
  const fields = { title: name, url: link, forJudges: forJudges === true };
  if (note) fields.description = note;
  return { fields };
}

const shorten = (text) => (text.length > 60 ? `${text.slice(0, 57)}...` : text);

export async function addResource({ title, url, description, forJudges }, existing = []) {
  const { fields, error } = checkFields({ title, url, description, forJudges });
  if (error) return { ok: false, error };

  const last = existing[existing.length - 1];
  const resource = { ...fields, order: (last?.order ?? -1) + 1, createdAt: Date.now() };

  // a key made on this device; nothing is written until the action applies
  const id = push(ref(database, "resources")).key;
  return applyAdminAction({
    action: "resource.add",
    summary: `Added resource: "${shorten(resource.title)}"`,
    changes: [{ path: `resources/${id}`, before: null, after: resource }],
  });
}

export async function updateResource(id, before, fields) {
  const { fields: checked, error } = checkFields(fields ?? {});
  if (error) return { ok: false, error };

  const after = { ...checked, order: before?.order ?? 0, createdAt: before?.createdAt ?? Date.now() };
  return applyAdminAction({
    action: "resource.update",
    summary: `Edited resource: "${shorten(after.title)}"`,
    changes: [{ path: `resources/${id}`, before: before ?? null, after }],
  });
}

export async function deleteResource(id, before) {
  return applyAdminAction({
    action: "resource.delete",
    summary: `Deleted resource: "${shorten(before?.title ?? "")}"`,
    changes: [{ path: `resources/${id}`, before: before ?? null, after: null }],
  });
}

/** Swap places with the neighbour above (-1) or below (+1), in one action. */
export async function moveResource(list, index, direction) {
  const item = list[index];
  const neighbour = list[index + direction];
  if (!item || !neighbour) return { ok: true };

  const itemOrder = item.order ?? 0;
  const neighbourOrder = neighbour.order ?? 0;
  // equal orders would swap into nothing, so pull the two apart
  const nextItem = itemOrder === neighbourOrder ? itemOrder + direction : neighbourOrder;

  return applyAdminAction({
    action: "resource.move",
    summary: `Moved resource ${direction < 0 ? "up" : "down"}: "${shorten(item.title ?? "")}"`,
    changes: [
      { path: `resources/${item.id}/order`, before: item.order ?? null, after: nextItem },
      { path: `resources/${neighbour.id}/order`, before: neighbour.order ?? null, after: itemOrder },
    ],
  });
}

export async function setResourcesShowNow(before, after) {
  return applyAdminAction({
    action: "config.resourcesShowNow",
    summary: after ? "Showed resources on the home page now" : "Went back to showing resources during the event",
    changes: [{ path: "config/resourcesShowNow", before: before ?? null, after: after === true }],
  });
}
