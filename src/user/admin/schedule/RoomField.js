import { useEffect, useRef, useState } from "react";
import { TextField } from "@mui/material";

/**
 * The room the final round runs in, as an input whose value belongs to the plan.
 *
 * It was an uncontrolled `<TextField defaultValue={plan.room}>`, which React
 * reads once when the field mounts and never again. Every later change to
 * `plan.room` -- an undo, a drift repair applying the configured room, another
 * organizer editing the same draft -- moved the plan and left the box showing
 * whatever was typed into it last. The plan said one room and the screen said
 * another, and the screen is the one an organizer believes.
 *
 * So the room is a prop and the typing is local state, synced whenever the plan
 * moves. The one thing that must not happen is the sync stamping over someone
 * mid-edit, so it fires only when `room` actually changes value -- not on every
 * re-render, of which this page has many (it re-renders on every draft tick).
 *
 * Committing is deliberately on blur rather than on each keystroke: each edit
 * is an entry on the undo stack and a write to the shared draft, and "Rice 011"
 * typed a character at a time is nine of both.
 */
export default function RoomField({ room, onCommit }) {
  const [typed, setTyped] = useState(room ?? "");
  const lastRoom = useRef(room);

  useEffect(() => {
    if (lastRoom.current === room) return;
    lastRoom.current = room;
    setTyped(room ?? "");
  }, [room]);

  return (
    <TextField
      size="small"
      label="Room"
      value={typed}
      sx={{ width: 160 }}
      onChange={(event) => setTyped(event.target.value)}
      onBlur={async () => {
        // whitespace either side is not a room change, and committing it would
        // push a pointless entry onto the undo stack
        if (typed.trim() === (room ?? "").trim()) return;

        // A refused edit -- an empty room, or the same room again -- leaves the
        // plan where it was, so the prop never moves and the sync above never
        // fires. Without this the box would go on showing text the plan
        // rejected, which is the same lie in the other direction.
        const ok = await onCommit(typed);
        if (ok === false) setTyped(room ?? "");
      }}
    />
  );
}
