import { useEffect, useState } from "react";
import { Button, Card, TextField } from "@mui/material";
import { FIELD, Section, SettingList, SettingRow } from "../adminUi";
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
    <Section
      title="Judging schedule"
      note="These take effect the next time a schedule is generated. To move a team that is already scheduled, use the team's own slot override."
    >
      <Card sx={{ p: 2.5 }}>
        <SettingList>
          <SettingRow
            label="Batches"
            hint="Teams are split into this many presentation rounds."
          >
            <TextField
              type="number"
              value={count}
              onChange={(event) => setCount(event.target.value)}
              // the row's label is the visible one; this is what names the
              // input itself, and it has to go through inputProps -- on a
              // TextField a bare aria-label lands on the wrapper div, where no
              // screen reader and no test will find it
              inputProps={{ min: 1, max: 12, "aria-label": "Batches" }}
              sx={{ width: FIELD.count }}
            />
            <Button
              variant="outlined"
              disabled={busy || Number(count) === storedCount}
              onClick={() => run(
                () => setBatchCount(Number(count)),
                `Batch count set to ${count}`
              )}
            >
              Save
            </Button>
          </SettingRow>

          {/*
            Saying so, because the field does not.
            These times are read when a schedule is BUILT and copied onto every
            judge's card and every team's page at publish. Changing them later
            moves nothing that is already out there -- and "Batch times saved"
            reads exactly like it did.
          */}
          <SettingRow
            label="Batch times"
            hint="Used when you build a schedule. Cards already published keep the times they were built with; change one on the team's record."
          >
            {batches.map((batch) => (
              <TextField
                key={batch}
                label={`Batch ${batch}`}
                value={times[batch] ?? ""}
                onChange={(event) => setTimes({ ...times, [batch]: event.target.value })}
                placeholder="5:00 PM"
                sx={{ width: FIELD.time }}
              />
            ))}
            <Button
              variant="outlined"
              disabled={busy}
              onClick={() =>
                run(() => setBatchTimes(times), "Batch times saved for the next build")
              }
            >
              Save times
            </Button>
          </SettingRow>

          <SettingRow
            label="Final round room"
            hint="Where the finalists present. The first round uses the list above."
          >
            <TextField
              inputProps={{ "aria-label": "Final round room" }}
              value={room}
              onChange={(event) => setRoom(event.target.value)}
              sx={{ width: FIELD.name }}
            />
            <Button
              variant="outlined"
              disabled={busy || room === storedRoom}
              onClick={() => run(() => setFinalRoundRoom(room), `Final round room set to ${room}`)}
            >
              Save
            </Button>
          </SettingRow>
        </SettingList>
      </Card>
    </Section>
  );
}
