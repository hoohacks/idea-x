import { useEffect, useState } from "react";
import { Button, Card, TextField } from "@mui/material";
import { FIELD, Section, SettingList, SettingRow } from "../adminUi";
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
    <Section title="Event">
      <Card sx={{ p: 2.5 }}>
        <SettingList>
          <SettingRow
            label="Starts"
            hint="Drives the countdown on the home page. Local to the event, not to whoever is reading it."
          >
            <TextField
              type="datetime-local"
              inputProps={{ "aria-label": "Starts" }}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ width: FIELD.datetime }}
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
            >
              Save
            </Button>
          </SettingRow>
        </SettingList>
      </Card>
    </Section>
  );
}
