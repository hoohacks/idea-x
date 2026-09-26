import { ref, get } from "firebase/database";
import { database } from "../../../firebase.js";
import { applyAdminAction } from "../adminAction.js";
import { BATCH_COUNT, BATCH_TIMES } from "../../judge/schedulePlan.js";
import { FINAL_ROUND_ROOM } from "../../judge/finalRoundService.js";
import { EVENT_START } from "../../../eventInfo.js";

/**
 * Batch count, batch times, event start and the final round room.
 *
 * All four were module constants and remain so as fallbacks. Unlike the room
 * list, these are structural rather than venue facts: an event always has some
 * number of batches, so an absent node should behave as it did before rather
 * than refusing to generate. Rooms are the opposite -- there is no sensible
 * default for which rooms a venue booked, so those have no fallback at all.
 *
 * Changing any of these affects the NEXT schedule generation. A schedule
 * already written keeps the times it was built with; that is what the room
 * remap and the per-team slot override are for.
 */

async function readOne(path, fallback) {
  try {
    const snap = await get(ref(database, path));
    return snap.exists() ? snap.val() : fallback;
  } catch {
    return fallback;
  }
}

export async function readEventConfig() {
  const [batchCount, batchTimes, eventStart, finalRoundRoom] = await Promise.all([
    readOne("config/batchCount", BATCH_COUNT),
    readOne("config/batchTimes", BATCH_TIMES),
    readOne("config/eventStart", EVENT_START),
    readOne("config/finalRoundRoom", FINAL_ROUND_ROOM),
  ]);
  return { batchCount, batchTimes, eventStart, finalRoundRoom };
}

export async function setBatchCount(count) {
  if (!Number.isInteger(count) || count < 1 || count > 12) {
    return { ok: false, error: "The batch count must be a whole number between 1 and 12." };
  }

  const before = await readOne("config/batchCount", BATCH_COUNT);
  return applyAdminAction({
    action: "config.batchCount",
    summary: `Batch count ${before} to ${count}`,
    changes: [{ path: "config/batchCount", before, after: count }],
  });
}

export async function setBatchTimes(times) {
  const count = await readOne("config/batchCount", BATCH_COUNT);
  const missing = [];
  for (let batch = 1; batch <= count; batch++) {
    if (!String(times?.[batch] ?? "").trim()) missing.push(batch);
  }
  if (missing.length) {
    return { ok: false, error: `Give every batch a time. Missing: ${missing.join(", ")}.` };
  }

  const before = await readOne("config/batchTimes", BATCH_TIMES);
  return applyAdminAction({
    action: "config.batchTimes",
    summary: `Batch times set for ${count} batch(es)`,
    changes: [{ path: "config/batchTimes", before, after: times }],
  });
}

export async function setEventStart(iso) {
  if (Number.isNaN(new Date(iso).getTime())) {
    return { ok: false, error: "That is not a date the browser can read." };
  }

  const before = await readOne("config/eventStart", EVENT_START);
  return applyAdminAction({
    action: "config.eventStart",
    summary: `Event start ${before} to ${iso}`,
    changes: [{ path: "config/eventStart", before, after: iso }],
  });
}

/**
 * Whether teams can hand in their project. Closed until an organizer opens it,
 * so an absent node means closed: a database nobody has touched should not
 * start taking pitches weeks before the event. The rules enforce the same flag.
 */
export async function setSubmissionsOpen(open) {
  const before = (await readOne("config/submissionsOpen", false)) === true;
  const after = open === true;
  if (before === after) return { ok: true };
  return applyAdminAction({
    action: "config.submissionsOpen",
    summary: after ? "Opened project submissions" : "Closed project submissions",
    changes: [{ path: "config/submissionsOpen", before, after }],
  });
}

/**
 * When the form closes by itself, as epoch milliseconds, or null for no
 * deadline (organizers close by hand). A number because the rules compare it
 * with the server's `now`; the page shows it in the event's zone.
 */
export async function setSubmissionsCloseAt(closeAt) {
  const after = closeAt === null || closeAt === undefined ? null : Number(closeAt);
  if (after !== null && !Number.isFinite(after)) {
    return { ok: false, error: "That is not a time the browser can read." };
  }
  const before = await readOne("config/submissionsCloseAt", null);
  if (before === after) return { ok: true };
  return applyAdminAction({
    action: "config.submissionsCloseAt",
    summary: after === null ? "Removed the submission deadline" : `Submission deadline set to ${new Date(after).toISOString()}`,
    changes: [{ path: "config/submissionsCloseAt", before, after }],
  });
}

export async function setFinalRoundRoom(room) {
  const next = String(room ?? "").trim();
  if (!next) return { ok: false, error: "Give the final round a room." };

  const before = await readOne("config/finalRoundRoom", FINAL_ROUND_ROOM);
  return applyAdminAction({
    action: "config.finalRoundRoom",
    summary: `Final round room ${before} to ${next}`,
    changes: [{ path: "config/finalRoundRoom", before, after: next }],
  });
}
