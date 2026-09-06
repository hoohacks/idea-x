import { useEffect, useState } from "react";
import { Alert, Button, Card, Stack, TextField, Typography } from "@mui/material";
import { setBatchCount, setBatchTimes, setFinalRoundRoom } from "./eventConfig";
import { BATCH_COUNT, BATCH_TIMES } from "../../judge/schedulePlan.js";
import { FINAL_ROUND_ROOM } from "../../judge/finalRoundService";

/**
 * The shape of judging day.
 *
 * These were module constants and remain so as fallbacks, which is why an empty
 * config renders the built-in values rather than blanks. Everything here feeds
 * the NEXT generation -- a schedule already written keeps the times it was built
 * with, and moving one team is the per-team slot override instead.
 */
export default function ScheduleSection({ config, onResult }) {
  const storedCount = config.batchCount ?? BATCH_COUNT;
  const storedTimes = config.batchTimes ?? BATCH_TIMES;
  const storedRoom = config.finalRoundRoom ?? FINAL_ROUND_ROOM;

  const [count, setCount] = useState(String(storedCount));
  const [times, setTimes] = useState(storedTimes);
  const [room, setRoom] = useState(storedRoom);
  const [busy, setBusy] = useState(false);

  // the database is the source of truth; re-sync when a write lands or another
  // admin changes it in a different tab
  useEffect(() => { setCount(String(storedCount)); }, [storedCount]);
  useEffect(() => { setTimes(storedTimes); }, [storedTimes]);
  useEffect(() => { setRoom(storedRoom); }, [storedRoom]);

  const run = async (work, message) => {
    setBusy(true);
    try {
      onResult(await work(), message);
    } finally {
      setBusy(false);
    }
  };

  const batches = Array.from({ length: Number(count) || 0 }, (_, i) => i + 1);

  return (
    <section>
      <Typography variant="h2" sx={{ fontSize: "1.1rem", mb: 1 }}>Judging schedule</Typography>

      <Alert severity="info" sx={{ mb: 2 }}>
        These take effect the next time a schedule is generated. To move a team that
        is already scheduled, use the team's own slot override.
      </Alert>

      <Card sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <TextField
              size="small"
              type="number"
              label="Batches"
              value={count}
              onChange={(event) => setCount(event.target.value)}
              inputProps={{ min: 1, max: 12 }}
              sx={{ width: 120 }}
              helperText="Teams split into this many presentation rounds"
            />
            <Button
              variant="outlined"
              disabled={busy || Number(count) === storedCount}
              onClick={() => run(
                () => setBatchCount(Number(count)),
                `Batch count set to ${count}`
              )}
              sx={{ mt: 0.5 }}
            >
              Save
            </Button>
          </Stack>

          <Stack spacing={1}>
            <Typography variant="body2">Batch times</Typography>
            {/*
              Saying so, because the field does not.
              These times are read when a schedule is BUILT and copied onto every
              judge's card and every team's page at publish. Changing them later
              moves nothing that is already out there -- and "Batch times saved"
              reads exactly like it did.
            */}
            <Typography variant="caption" color="text.secondary">
              Used when you build a schedule. Cards already published keep their
              times; change one on the team's record.
            </Typography>
            {batches.map((batch) => (
              <TextField
                key={batch}
                size="small"
                label={`Batch ${batch}`}
                value={times[batch] ?? ""}
                onChange={(event) => setTimes({ ...times, [batch]: event.target.value })}
                placeholder="5:00 PM"
              />
            ))}
            <Button
              variant="outlined"
              disabled={busy}
              onClick={() =>
                run(() => setBatchTimes(times), "Batch times saved for the next build")
              }
              sx={{ alignSelf: "flex-start" }}
            >
              Save times
            </Button>
          </Stack>

          <Stack direction="row" spacing={1} alignItems="flex-start">
            <TextField
              size="small"
              label="Final round room"
              value={room}
              onChange={(event) => setRoom(event.target.value)}
              sx={{ flex: 1 }}
            />
            <Button
              variant="outlined"
              disabled={busy || room === storedRoom}
              onClick={() => run(() => setFinalRoundRoom(room), `Final round room set to ${room}`)}
              sx={{ mt: 0.5 }}
            >
              Save
            </Button>
          </Stack>
        </Stack>
      </Card>
    </section>
  );
}
