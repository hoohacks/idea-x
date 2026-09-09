import { useState } from "react";
import {
  Alert, Box, Button, Card, Divider, MenuItem, Stack, TextField, Typography,
} from "@mui/material";
import { FIELD, Section } from "./adminUi";
import { createTeam, setConfigValue } from "./people/peopleService";

/**
 * The last two things that needed the Firebase console.
 *
 * Creating an empty team, for a walk-in group who never registered one, and
 * writing a config key that has no dedicated control yet. The named settings
 * all have proper controls above; this is the escape hatch so a new one does
 * not mean a deploy or a trip to the console.
 */
const TYPES = [
  { value: "string", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Yes / no" },
  { value: "json", label: "JSON" },
];

/**
 * The type each known key must have.
 *
 * This exists because the type selector defaulted to Text, and saving
 * `targetJudgesPerTeam` as the string "2" is a mistake with no visible symptom:
 * the reader coerces it, so it works, until a comparison somewhere does not.
 * A key the app actually reads should not depend on remembering to change a
 * dropdown.
 */
export const KNOWN_KEYS = {
  batchCount: "number",
  targetJudgesPerTeam: "number",
  judgingRooms: "json",
  batchTimes: "json",
  finalRoundRoom: "string",
  finalRoundSize: "number",
  eventStart: "string",
  // What an admin confirms they pasted into the Firebase console. The app knows
  // which version it needs; it cannot read what is actually deployed, so this is
  // the only way it can warn that a restore point will fail silently.
  rulesVersion: "number",
};

function parseValue(type, raw) {
  if (type === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error("That is not a number.");
    return n;
  }
  if (type === "boolean") return raw === "true";
  if (type === "json") {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error("That is not valid JSON.");
    }
  }
  return raw;
}

export default function AdvancedSection({ config = {}, onResult }) {
  const [teamName, setTeamName] = useState("");
  const [key, setKey] = useState("");
  const [type, setType] = useState("string");
  const [typeTouched, setTypeTouched] = useState(false);
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = async (work, message) => {
    setBusy(true);
    setError(null);
    try {
      onResult(await work(), message);
    } finally {
      setBusy(false);
    }
  };

  // the key decides the type unless the operator has deliberately overridden it
  const expected = KNOWN_KEYS[key.trim()];
  const effectiveType = typeTouched ? type : expected ?? type;
  const mismatch = expected && typeTouched && type !== expected;

  const saveConfig = async () => {
    let value;
    try {
      value = parseValue(effectiveType, raw);
    } catch (parseError) {
      setError(parseError.message);
      return;
    }
    await run(() => setConfigValue(key, value), `config/${key} saved as ${effectiveType}`);
    setKey("");
    setRaw("");
    setTypeTouched(false);
  };

  return (
    <Section title="Advanced" collapsible>
      <Card sx={{ p: 2.5 }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>Create an empty team</Typography>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
              For a group who turned up without registering one. Add their members from the
              Competitors dashboard afterwards.
            </Typography>
            <Stack direction="row" spacing={1}>
              <TextField
                label="Team name" value={teamName}
                onChange={(event) => setTeamName(event.target.value)}
                sx={{ width: { xs: "100%", sm: FIELD.name } }}
              />
              <Button
                variant="outlined" disabled={busy || !teamName.trim()}
                onClick={() => run(() => createTeam(teamName), `Created ${teamName.trim()}`).then(() => setTeamName(""))}
              >
                Create
              </Button>
            </Stack>
          </Box>

          <Divider />

          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>Write a config key</Typography>
            <Alert severity="warning" sx={{ mb: 1 }}>
              No validation beyond the type. A wrong key here is a setting nothing reads; a
              wrong value is one everything reads. The named settings above are safer.
            </Alert>

            <Stack spacing={1}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <TextField
                  label="Key" placeholder="targetJudgesPerTeam" value={key}
                  onChange={(event) => setKey(event.target.value)}
                  sx={{ width: { xs: "100%", sm: FIELD.key } }}
                  helperText="Written to config/<key>"
                />
                <TextField
                  select label="Type" value={effectiveType}
                  onChange={(event) => { setType(event.target.value); setTypeTouched(true); }}
                  sx={{ minWidth: 130 }}
                  helperText={expected ? `${key.trim()} must be ${expected}` : "Free-form key"}
                >
                  {TYPES.map((option) => (
                    <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                  ))}
                </TextField>
              </Stack>

              {mismatch && (
                <Alert severity="warning">
                  {key.trim()} is read as a {expected}. Saving it as {type} will not fail —
                  it will just be wrong in a way nothing reports.
                </Alert>
              )}

              {effectiveType === "boolean" ? (
                <TextField select label="Value" value={raw || "true"}
                  onChange={(event) => setRaw(event.target.value)}
                  sx={{ width: { xs: "100%", sm: FIELD.key } }}>
                  <MenuItem value="true">Yes</MenuItem>
                  <MenuItem value="false">No</MenuItem>
                </TextField>
              ) : (
                <TextField
                  label="Value" value={raw}
                  onChange={(event) => setRaw(event.target.value)}
                  multiline={effectiveType === "json"} minRows={effectiveType === "json" ? 3 : 1}
                  // JSON needs the room; a string or a number does not
                  sx={{ width: { xs: "100%", sm: effectiveType === "json" ? 640 : FIELD.key } }}
                />
              )}

              {error && <Alert severity="error">{error}</Alert>}

              <Box>
                <Button variant="outlined" disabled={busy || !key.trim()} onClick={saveConfig}>
                  Save config key
                </Button>
              </Box>
            </Stack>
          </Box>

          <Divider />

          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>Current config</Typography>
            <Box
              component="pre"
              sx={{
                m: 0, p: 1.5, fontSize: ".78rem", overflowX: "auto",
                bgcolor: "action.hover", borderRadius: 1,
              }}
            >
              {JSON.stringify(config, null, 2)}
            </Box>
          </Box>
        </Stack>
      </Card>
    </Section>
  );
}
