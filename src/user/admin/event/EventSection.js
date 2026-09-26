import { useEffect, useState } from "react";
import { Button, Card, TextField } from "@mui/material";
import { FIELD, Section, SettingList, SettingRow, StateToggle } from "../adminUi";
import { setEventStart, setSubmissionsCloseAt, setSubmissionsOpen } from "./eventConfig";
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
  const [toggling, setToggling] = useState(false);
  const submissionsOpen = config.submissionsOpen === true;

  // the deadline is stored as epoch ms; the field speaks event wall clock
  const storedClose = typeof config.submissionsCloseAt === "number" ? instantToEventLocal(new Date(config.submissionsCloseAt)) : "";
  const [closeValue, setCloseValue] = useState(storedClose);
  const [savingClose, setSavingClose] = useState(false);
  useEffect(() => { setCloseValue(storedClose); }, [storedClose]);

  const saveClose = async (next) => {
    setSavingClose(true);
    try {
      onResult(
        await setSubmissionsCloseAt(next ? eventLocalToInstant(next).getTime() : null),
        next ? "Submission deadline saved" : "Submission deadline removed"
      );
    } finally {
      setSavingClose(false);
    }
  };

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
          <SettingRow
            label="Project submissions"
            hint="Teams can form and invite people either way. While closed, the team page says submissions open on the day, and the database refuses them."
          >
            <StateToggle
              on={submissionsOpen}
              onLabel="Open"
              offLabel="Closed"
              minWidth={104}
              onClick={async () => {
                if (toggling) return;
                setToggling(true);
                try {
                  onResult(
                    await setSubmissionsOpen(!submissionsOpen),
                    submissionsOpen ? "Submissions closed" : "Submissions open"
                  );
                } finally {
                  setToggling(false);
                }
              }}
            />
          </SettingRow>
          <SettingRow
            label="Submissions close"
            hint="Optional. At this time the form closes by itself, even while submissions are open, and teams see a countdown to it. Leave it empty to close by hand."
          >
            <TextField
              type="datetime-local"
              inputProps={{ "aria-label": "Submissions close" }}
              value={closeValue}
              onChange={(event) => setCloseValue(event.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ width: FIELD.datetime }}
            />
            <Button
              variant="outlined"
              disabled={savingClose || !closeValue || closeValue === storedClose}
              onClick={() => saveClose(closeValue)}
            >
              Save
            </Button>
            {storedClose && (
              <Button variant="text" disabled={savingClose} onClick={() => saveClose(null)}>
                Remove
              </Button>
            )}
          </SettingRow>
        </SettingList>
      </Card>
    </Section>
  );
}
