import { useState } from "react";
import { Alert, MenuItem, TextField } from "@mui/material";
import EditDrawer from "./EditDrawer";
import { editJudge } from "./recordEdits";

/**
 * Fixing a judge record.
 *
 * Both round marks are here as well as on the row buttons, because this is
 * where you end up when you are correcting several fields at once. Both routes
 * write the same paths; only this one records a before-value.
 */
export default function JudgeEditDrawer({ judge, onClose, onResult }) {
  const [fields, setFields] = useState({
    firstName: judge.firstName ?? "",
    lastName: judge.lastName ?? "",
    email: judge.email ?? "",
    company: judge.company ?? "",
    withCompany: Boolean(judge.withCompany),
    wantsToMentor: Boolean(judge.wantsToMentor),
    checkedIn: Boolean(judge.checkedIn),
    foodCheckIn: Boolean(judge.foodCheckIn),
    isRound1Judge: judge.isRound1Judge === true,
    isFinalRoundJudge: judge.isFinalRoundJudge === true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const set = (key) => (event) => setFields({ ...fields, [key]: event.target.value });
  const setBool = (key) => (event) => setFields({ ...fields, [key]: event.target.value === "true" });

  // an absent mark is false, not undefined -- otherwise every judge registered
  // before the field existed reads as dirty the moment the drawer opens
  const ROUND_MARKS = ["isRound1Judge", "isFinalRoundJudge"];
  const original = (key) =>
    ROUND_MARKS.includes(key) ? judge[key] === true : Boolean(judge[key]);

  const dirty = Object.entries(fields).some(([key, value]) =>
    typeof value === "boolean" ? value !== original(key) : value !== (judge[key] ?? "")
  );

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await editJudge(judge.id, fields);
      if (!result.ok) { setError(result.error); return; }
      onResult(result, `Saved ${`${fields.firstName} ${fields.lastName}`.trim() || "judge"}`);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const yesNo = (label, name, helperText) => (
    <TextField
      select
      size="small"
      label={label}
      value={String(fields[name])}
      onChange={setBool(name)}
      helperText={helperText}
    >
      <MenuItem value="true">Yes</MenuItem>
      <MenuItem value="false">No</MenuItem>
    </TextField>
  );

  return (
    <EditDrawer
      open
      title={`${judge.firstName ?? ""} ${judge.lastName ?? ""}`.trim() || "Judge"}
      subtitle={judge.email}
      onClose={onClose}
      onSave={save}
      saving={saving}
      error={error}
      dirty={dirty}
    >
      <TextField label="First name" size="small" value={fields.firstName} onChange={set("firstName")} />
      <TextField label="Last name" size="small" value={fields.lastName} onChange={set("lastName")} />
      <TextField label="Email" size="small" value={fields.email} onChange={set("email")} />
      <TextField label="Company" size="small" value={fields.company} onChange={set("company")} />

      {yesNo("Show company", "withCompany")}
      {yesNo("Wants to mentor", "wantsToMentor")}
      {yesNo("Checked in", "checkedIn")}
      {yesNo("Got food", "foodCheckIn")}
      {yesNo(
        "First round judge",
        "isRound1Judge",
        "Only judges marked here are given team assignments"
      )}
      {yesNo(
        "Final round judge",
        "isFinalRoundJudge",
        "In the room for the final round, and never auto-assigned a first round team"
      )}

      {ROUND_MARKS.some((key) => fields[key] !== original(key)) && (
        <Alert severity="info">
          This takes effect the next time a schedule or final round plan is built. It does
          not add or remove assignments they already hold.
        </Alert>
      )}
    </EditDrawer>
  );
}
