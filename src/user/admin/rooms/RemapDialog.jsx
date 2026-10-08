import { useState } from "react";
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, Stack, TextField, Typography,
} from "@mui/material";

/**
 * Removing a room that a schedule is already using.
 *
 * config/judgingRooms feeds the NEXT generation; a schedule already written
 * holds the room name in the team's node and in every assigned judge's copy.
 * Taking the room off the list without moving those leaves a team walking to a
 * room nobody has listed, so this dialog makes the destination a required
 * choice rather than an afterthought.
 */
export default function RemapDialog({ room, inUse, rooms, busy, onClose, onConfirm }) {
  const [moveTo, setMoveTo] = useState("");
  const alternatives = rooms.filter((candidate) => candidate !== room);

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Remove {room}?</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Alert severity="warning">
            {inUse.length} team{inUse.length === 1 ? " is" : "s are"} scheduled in this room.
          </Alert>

          <Stack spacing={0.5}>
            {inUse.map((team) => (
              <Typography key={team.teamId} variant="body2">
                {team.teamName} · {team.time} · batch {team.batch}
              </Typography>
            ))}
          </Stack>

          <TextField
            select
            label="Move them to"
            value={moveTo}
            onChange={(event) => setMoveTo(event.target.value)}
            helperText="The team node and every judge's copy move together."
          >
            {alternatives.map((candidate) => (
              <MenuItem key={candidate} value={candidate}>{candidate}</MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={busy} variant="outlined">Cancel</Button>
        <Button
          onClick={() => onConfirm(moveTo)}
          disabled={busy || !moveTo}
          variant="contained"
          color="error"
        >
          {busy ? "Moving…" : "Remove and remap"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
