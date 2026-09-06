import { useState } from "react";
import { Alert, Button, Chip, Stack, TextField, Typography } from "@mui/material";
import { RowList, Row } from "../adminUi";
import { roomsInUse, finalRoomsInUse, addRoom, renameRoom, removeRoom } from "./roomsService";
import RemapDialog from "./RemapDialog";

/**
 * The judging room list. The scheduler assigns rooms by position within a
 * batch, so order matters at generation time; it does not matter afterwards,
 * because the name is copied into the schedule.
 */
export default function RoomsSection({ rooms, teamsData, onResult }) {
  const [newRoom, setNewRoom] = useState("");
  const [renaming, setRenaming] = useState(null);
  const [renameTo, setRenameTo] = useState("");
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);

  const inUse = roomsInUse(teamsData);
  const finalInUse = finalRoomsInUse(teamsData);

  // roomsInUse only sees the first round. A room the final round alone is
  // using -- it typically gets a dedicated room of its own -- otherwise looked
  // empty here, so the chip understated it and Remove skipped straight to
  // removeRoom with no destination, which now correctly refuses rather than
  // silently orphaning finalists. Folding finalInUse in gives that case a
  // destination to pick, same as the first round always had.
  const occupantsOf = (room) => [
    ...(inUse[room] ?? []),
    ...(finalInUse[room] ?? []).map((team) => ({ ...team, time: team.timeslot, batch: "final round" })),
  ];

  const run = async (work, successMessage) => {
    setBusy(true);
    try {
      const result = await work();
      onResult(result, successMessage);
      return result;
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (room) => {
    const occupants = occupantsOf(room);
    if (occupants.length) {
      setRemoving({ room, inUse: occupants });
      return;
    }
    await run(() => removeRoom(room), `Removed ${room}`);
  };

  return (
    <section>
      <Typography variant="h2" sx={{ fontSize: "1.1rem", mb: 1 }}>Judging rooms</Typography>

      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <TextField
          size="small"
          placeholder="Add a room, e.g. Rice 110"
          value={newRoom}
          onChange={(event) => setNewRoom(event.target.value)}
          sx={{ flex: 1 }}
        />
        <Button
          variant="contained"
          disabled={busy || !newRoom.trim()}
          onClick={async () => {
            const result = await run(() => addRoom(newRoom), `Added ${newRoom.trim()}`);
            if (result?.ok) setNewRoom("");
          }}
        >
          Add
        </Button>
      </Stack>

      {rooms.length === 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          No rooms are configured, so a schedule cannot be generated. There is no
          built-in list — add the rooms this event has booked.
        </Alert>
      )}

      <RowList empty="No rooms yet. Add the first one above.">
        {rooms.map((room) => {
          const occupants = occupantsOf(room);
          const isRenaming = renaming === room;

          return (
            <Row key={room}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
                {isRenaming ? (
                  <TextField
                    size="small"
                    value={renameTo}
                    onChange={(event) => setRenameTo(event.target.value)}
                    sx={{ flex: 1 }}
                    autoFocus
                  />
                ) : (
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1 }}>
                    <Typography sx={{ fontWeight: 600 }}>{room}</Typography>
                    {occupants.length > 0 && (
                      <Chip size="small" variant="outlined" label={`in use ×${occupants.length}`} />
                    )}
                  </Stack>
                )}

                <Stack direction="row" spacing={1}>
                  {isRenaming ? (
                    <>
                      <Button size="small" onClick={() => setRenaming(null)} disabled={busy}>
                        Cancel
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        disabled={busy || !renameTo.trim()}
                        onClick={async () => {
                          const result = await run(
                            () => renameRoom(room, renameTo),
                            `Renamed ${room} to ${renameTo.trim()}`
                          );
                          if (result?.ok) setRenaming(null);
                        }}
                      >
                        Save
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={busy}
                        onClick={() => { setRenaming(room); setRenameTo(room); }}
                      >
                        Rename
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        color="error"
                        disabled={busy}
                        onClick={() => handleRemove(room)}
                      >
                        Remove
                      </Button>
                    </>
                  )}
                </Stack>
              </Stack>
            </Row>
          );
        })}
      </RowList>

      {removing && (
        <RemapDialog
          room={removing.room}
          inUse={removing.inUse}
          rooms={rooms}
          busy={busy}
          onClose={() => setRemoving(null)}
          onConfirm={async (moveTo) => {
            const result = await run(
              () => removeRoom(removing.room, { moveTo }),
              `Removed ${removing.room}, moving ${removing.inUse.length} team(s) to ${moveTo}`
            );
            if (result?.ok) setRemoving(null);
          }}
        />
      )}
    </section>
  );
}
