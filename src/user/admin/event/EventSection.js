import { useEffect, useState } from "react";
import { Button, Card, Stack, TextField, Typography } from "@mui/material";
import { setEventStart } from "./eventConfig";
import { EVENT_START, eventLocalToInstant, instantToEventLocal } from "../../../eventInfo";

/**
 * The event start.
 *
 * The countdown on the home page reads config/eventStart when it is set and
 * falls back to EVENT_START in eventInfo.js, so the date can move without a
 * deploy.
 *
 * A `datetime-local` input speaks wall clock and has no idea what zone it is
 * in, so both directions are converted explicitly. Slicing the first sixteen
 * characters off whatever was stored is what this used to do, and it showed a
 * UTC instant -- which is what the seed writes -- as if the digits were already
 * Eastern, moving the event by four hours each time somebody pressed Save.
 */
export default function EventSection({ config, onResult }) {
  const stored = config.eventStart ?? EVENT_START;
  const [value, setValue] = useState(() => instantToEventLocal(stored));
  const [busy, setBusy] = useState(false);

  useEffect(() => { setValue(instantToEventLocal(stored)); }, [stored]);

  return (
    <section>
      <Typography variant="h2" sx={{ fontSize: "1.1rem", mb: 1 }}>Event</Typography>

      <Card sx={{ p: 2 }}>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <TextField
            size="small"
            type="datetime-local"
            label="Starts"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            InputLabelProps={{ shrink: true }}
            helperText="Drives the countdown on the home page"
            sx={{ flex: 1 }}
          />
          <Button
            variant="outlined"
            disabled={busy || value === instantToEventLocal(stored)}
            onClick={async () => {
              setBusy(true);
              try {
                onResult(
                  await setEventStart(eventLocalToInstant(value).toISOString()),
                  "Event start saved"
                );
              } finally {
                setBusy(false);
              }
            }}
            sx={{ mt: 0.5 }}
          >
            Save
          </Button>
        </Stack>
      </Card>
    </section>
  );
}
