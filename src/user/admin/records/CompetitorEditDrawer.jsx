import { useState } from "react";
import { Alert, MenuItem, TextField } from "@mui/material";
import EditDrawer from "./EditDrawer";
import { editCompetitor, moveCompetitorToTeam } from "./recordEdits";

const DIETARY = ["none", "vegetarian", "vegan", "halal", "kosher", "gluten-free", "other"];

/**
 * Fixing a competitor record.
 *
 * Check-in is editable here on purpose: reversing one is a deliberate override
 * and worth recording, unlike the scanner, which is the normal high-volume path
 * and stays out of the log.
 *
 * The team move is a separate write because it fans out -- membership is a keyed
 * set on the team AND a teamId on the person, and both must move together.
 */
export default function CompetitorEditDrawer({ person, teams, onClose, onResult }) {
  const [fields, setFields] = useState({
    firstName: person.firstName ?? "",
    lastName: person.lastName ?? "",
    email: person.email ?? "",
    dietaryRestriction: person.dietaryRestriction ?? "none",
    checkedIn: Boolean(person.checkedIn),
    foodCheckIn: Boolean(person.foodCheckIn),
  });
  const [teamId, setTeamId] = useState(person.teamId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const set = (key) => (event) => setFields({ ...fields, [key]: event.target.value });
  const setBool = (key) => (event) => setFields({ ...fields, [key]: event.target.value === "true" });

  const fieldsDirty = Object.entries(fields).some(([key, value]) => {
    if (typeof value === "boolean") return value !== Boolean(person[key]);
    if (key === "dietaryRestriction") return value !== (person.dietaryRestriction ?? "none");
    return value !== (person[key] ?? "");
  });
  const teamDirty = teamId !== (person.teamId ?? "");

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const name = `${fields.firstName} ${fields.lastName}`.trim();

      if (fieldsDirty) {
        const result = await editCompetitor(person.id, fields);
        if (!result.ok) { setError(result.error); return; }
      }

      if (teamDirty) {
        const result = await moveCompetitorToTeam({
          uid: person.id, name, toTeamId: teamId || null,
        });
        if (!result.ok) { setError(result.error); return; }
        if (result.emptiedTeam) {
          onResult({ ok: true }, `Saved. ${result.emptiedTeam} now has no members.`);
          onClose();
          return;
        }
      }

      onResult({ ok: true }, `Saved ${name || "competitor"}`);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <EditDrawer
      open
      title={`${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() || "Competitor"}
      subtitle={person.email}
      onClose={onClose}
      onSave={save}
      saving={saving}
      error={error}
      dirty={fieldsDirty || teamDirty}
    >
      <TextField label="First name" size="small" value={fields.firstName} onChange={set("firstName")} />
      <TextField label="Last name" size="small" value={fields.lastName} onChange={set("lastName")} />
      <TextField label="Email" size="small" value={fields.email} onChange={set("email")} />

      <TextField select label="Dietary" size="small" value={fields.dietaryRestriction} onChange={set("dietaryRestriction")}>
        {DIETARY.map((option) => (
          <MenuItem key={option} value={option} sx={{ textTransform: "capitalize" }}>{option}</MenuItem>
        ))}
      </TextField>

      <TextField select label="Checked in" size="small" value={String(fields.checkedIn)} onChange={setBool("checkedIn")}>
        <MenuItem value="true">Yes</MenuItem>
        <MenuItem value="false">No</MenuItem>
      </TextField>

      <TextField select label="Got food" size="small" value={String(fields.foodCheckIn)} onChange={setBool("foodCheckIn")}>
        <MenuItem value="true">Yes</MenuItem>
        <MenuItem value="false">No</MenuItem>
      </TextField>

      <TextField
        select
        label="Team"
        size="small"
        value={teamId}
        onChange={(event) => setTeamId(event.target.value)}
        helperText="Moves their membership and their record together"
      >
        <MenuItem value="">No team</MenuItem>
        {Object.entries(teams).map(([id, team]) => (
          <MenuItem key={id} value={id}>{team?.name || id}</MenuItem>
        ))}
      </TextField>

      {teamDirty && (
        <Alert severity="info">
          Moving someone does not move their team's submission or any scores.
        </Alert>
      )}
    </EditDrawer>
  );
}
