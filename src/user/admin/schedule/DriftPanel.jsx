import { useState } from "react";
import { Alert, Button } from "@mui/material";
import { ConfirmDialog } from "../adminUi.js";

/**
 * What moved since the plan was built, surfaced right where the organizer is
 * about to publish it.
 *
 * `checkDrift` (src/user/judge/checkDrift.js) hands back two piles: `blocking`
 * items that make the plan wrong and must be fixed before it can be
 * published, and `advisory` items that are worth knowing but do not stop the
 * publish. A removed room produces one blocking item PER assignment it
 * affected, not one per room -- a room can be used in several batches, and
 * each team sitting in it needs its own move. So this renders and repairs
 * every item individually and never groups or dedupes them, even when two
 * items share the same message shape.
 *
 * Each blocking item gets its own `Alert`, with its own repair button when
 * `repair` is present -- some blocking conditions (a batch count that
 * changed) have no per-item fix and can only be resolved by a full rebuild,
 * which the caller drives through `onRebuild` after its own confirmation.
 *
 * `dropTeam` is the one repair type that bypasses `applyEdit` (SchedulePreview
 * deletes the assignment directly, see its `handleRepair`), which means it
 * never lands in `plan.edits` and cannot be walked back with Undo -- unlike
 * every other repair here. That makes it the one button on this panel a
 * click cannot recover from, so it is the one gated behind its own
 * `ConfirmDialog` rather than firing on click like the rest.
 */

const REPAIR_LABELS = {
  moveTeam: "Place",
  dropTeam: "Drop",
  removeJudge: "Remove",
  rebuild: "Rebuild",
};

export default function DriftPanel({ drift, onRepair, onRebuild }) {
  const blocking = drift?.blocking ?? [];
  const advisory = drift?.advisory ?? [];
  const [confirmDrop, setConfirmDrop] = useState(null);

  if (!blocking.length && !advisory.length && !confirmDrop) return null;

  function handleClick(item) {
    if (item.repair.type === "rebuild") { onRebuild(); return; }
    if (item.repair.type === "dropTeam") { setConfirmDrop(item); return; }
    onRepair(item.repair);
  }

  return (
    <>
      {blocking.map((item, index) => (
        <Alert
          key={`${item.kind}-${index}`}
          severity="error"
          sx={{ mb: 1 }}
          action={
            item.repair ? (
              <Button color="inherit" size="small" onClick={() => handleClick(item)}>
                {REPAIR_LABELS[item.repair.type] ?? "Fix"}
              </Button>
            ) : undefined
          }
        >
          {item.message}
        </Alert>
      ))}
      {advisory.map((item, index) => (
        <Alert key={`${item.kind}-${index}`} severity="info" sx={{ mb: 1 }}>
          {item.message}
        </Alert>
      ))}

      <ConfirmDialog
        open={Boolean(confirmDrop)}
        title="Drop this team?"
        consequences={[
          confirmDrop?.message ?? "",
          "This cannot be undone with Undo. The team will have no slot until it is placed again.",
        ]}
        confirmLabel="Drop the team"
        onConfirm={() => {
          onRepair(confirmDrop.repair);
          setConfirmDrop(null);
        }}
        onCancel={() => setConfirmDrop(null)}
      />
    </>
  );
}
