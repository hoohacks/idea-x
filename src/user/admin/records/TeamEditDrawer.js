import { useEffect, useState } from "react";
import { Alert, Button, Divider, MenuItem, TextField, Typography } from "@mui/material";
import EditDrawer from "./EditDrawer";
import { renameTeam } from "./recordEdits";
import { overrideTeamSlot, setTeamSubmitted, forceIntoFinalRound } from "../danger/dangerZone";
import { listRooms } from "../rooms/roomsService";
import { findOpenSlots, scheduleTeamIntoBatch } from "../../judge/assignmentEdits";
import { judgePickerOptions } from "../../judge/judgeRoles";
import { deleteTeam } from "../people/peopleService";
import { ref, get } from "firebase/database";
import { database } from "../../../firebase";

/**
 * Everything about one team an organizer may need to change on the day.
 *
 * Each control is its own write, because each has a different fan-out: a rename
 * touches every judge's copy of the name, a slot override touches every
 * assigned judge's room and time, and the submitted flag is a single path. One
 * combined save would make the audit entries useless -- you could not tell
 * which of them the undo was going to reverse.
 */
export default function TeamEditDrawer({ team, teamId, onClose, onResult }) {
  const [name, setName] = useState(team.name ?? "");
  const [room, setRoom] = useState(team.schedule?.room ?? "");
  const [time, setTime] = useState(team.schedule?.time ?? "");
  const [rooms, setRooms] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { listRooms().then(setRooms).catch(() => setRooms([])); }, []);

  const nameDirty = name.trim() !== (team.name ?? "");
  const slotDirty =
    Boolean(team.schedule) &&
    (room !== (team.schedule?.room ?? "") || time !== (team.schedule?.time ?? ""));

  const run = async (work, message) => {
    setSaving(true);
    setError(null);
    try {
      const result = await work();
      if (!result.ok) { setError(result.error); return false; }
      onResult(result, message);
      return true;
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (nameDirty && !(await run(() => renameTeam(teamId, name), `Renamed to ${name.trim()}`))) return;
    if (slotDirty && !(await run(
      () => overrideTeamSlot({ teamId, teamName: name, room, time }),
      `Moved to ${room} at ${time}`
    ))) return;
    onClose();
  };

  return (
    <EditDrawer
      open
      title={team.name || "Unnamed team"}
      subtitle={team.submission?.ideaName}
      onClose={onClose}
      onSave={save}
      saving={saving}
      error={error}
      dirty={nameDirty || slotDirty}
    >
      <TextField
        label="Team name"
        size="small"
        value={name}
        onChange={(event) => setName(event.target.value)}
        helperText="Also updates the schedule and every judge's copy"
      />

      <Divider />
      <Typography variant="body2" sx={{ fontWeight: 600 }}>First round slot</Typography>

      {team.schedule ? (
        <>
          <TextField select label="Room" size="small" value={room} onChange={(e) => setRoom(e.target.value)}>
            {/* the current room is included even if it is off the list, so an
                override never silently blanks a slot that is already set */}
            {[...new Set([...rooms, room].filter(Boolean))].map((option) => (
              <MenuItem key={option} value={option}>{option}</MenuItem>
            ))}
          </TextField>
          <TextField
            label="Time"
            size="small"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            placeholder="5:00 PM"
            helperText={`Batch ${team.schedule.batch ?? "?"} · moves every assigned judge too`}
          />
        </>
      ) : (
        <ScheduleIntoBatch teamId={teamId} run={run} saving={saving} />
      )}

      <Divider />
      <Typography variant="body2" sx={{ fontWeight: 600 }}>Submission</Typography>

      <TextField
        select
        label="Submitted"
        size="small"
        value={String(Boolean(team.submitted))}
        onChange={(event) => {
          const submitted = event.target.value === "true";
          run(
            () => setTeamSubmitted({ teamId, teamName: name, submitted }),
            submitted ? "Marked as submitted" : "Marked as not submitted"
          );
        }}
        helperText="Only submitted teams are given judges when a schedule is generated"
      >
        <MenuItem value="true">Yes</MenuItem>
        <MenuItem value="false">No</MenuItem>
      </TextField>

      <Divider />
      <Typography variant="body2" sx={{ fontWeight: 600 }}>Final round</Typography>

      <FinalRoundControls team={team} teamId={teamId} name={name} saving={saving} run={run} />

      <Divider />
      <DeleteTeam team={team} teamId={teamId} name={name} saving={saving} run={run} onClose={onClose} />
    </EditDrawer>
  );
}

/**
 * Putting one team into the final round by hand. Kept separate because it
 * writes three kinds of path -- the private standings entry, the team's own slot
 * and a copy for each final-round judge -- and none of them is a field edit.
 */
function FinalRoundControls({ team, teamId, name, saving, run }) {
  const [room, setRoom] = useState(team.finalSlot?.room ?? "");
  const [timeslot, setTimeslot] = useState(team.finalSlot?.timeslot ?? "");

  return (
    <>
      {team.finalSlot && (
        <Alert severity="info">
          Already in the final round: {team.finalSlot.room} at {team.finalSlot.timeslot}.
        </Alert>
      )}

      <TextField label="Final round room" size="small" value={room} onChange={(e) => setRoom(e.target.value)} />
      <TextField label="Final round timeslot" size="small" value={timeslot} onChange={(e) => setTimeslot(e.target.value)} />

      <Alert severity="warning">
        This adds the team to the standings and gives it a slot. It does not assign
        judges — do that from the judging progress page.
      </Alert>

      <Button
        variant="outlined"
        disabled={saving || !room.trim() || !timeslot.trim()}
        onClick={() => run(
          () => forceIntoFinalRound({ teamId, teamName: name, room, timeslot }),
          `${name || "Team"} added to the final round`
        )}
      >
        {team.finalSlot ? "Update final round slot" : "Add to the final round"}
      </Button>
    </>
  );
}

/**
 * Slotting a team that has no schedule entry into an existing batch.
 *
 * A team that submits after the schedule was generated used to have nowhere to
 * go. The slot override edits an existing entry and does nothing when there is
 * none, so the only remaining move was a full regenerate -- which rewrites
 * every assignment in the event and strands every score already collected. For
 * one late team that is a catastrophic trade, and the same escape hatch already
 * existed for a no-show judge.
 *
 * Only rooms that are actually free in the chosen batch are offered, because a
 * clash here puts two teams in one room at one time.
 */
function ScheduleIntoBatch({ teamId, run, saving }) {
  const [slots, setSlots] = useState([]);
  const [judges, setJudges] = useState([]);
  const [batch, setBatch] = useState("");
  const [room, setRoom] = useState("");
  const [picked, setPicked] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    Promise.all([
      findOpenSlots(),
      get(ref(database, "judges")).then((snap) => snap.val() ?? {}),
    ])
      .then(([openSlots, judgesData]) => {
        if (!live) return;
        setSlots(openSlots);
        // both roles, because this places a team by hand: the generator would
        // not seat a final-round judge, but an organizer filling a gap may
        setJudges(judgePickerOptions(judgesData));
      })
      .catch(() => { if (live) setSlots([]); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const chosen = slots.find((slot) => String(slot.batch) === String(batch));

  if (loading) return <Alert severity="info">Loading the batches…</Alert>;

  if (!slots.length) {
    return (
      <Alert severity="info">
        No schedule has been generated yet, so there are no batches to slot this team into.
        Generate the schedule and this team will be included.
      </Alert>
    );
  }

  return (
    <>
      <Alert severity="warning">
        This team submitted after the schedule was generated, so it has no slot. Give it one here
        rather than regenerating — a regenerate moves every assignment in the event and strands the
        scores already collected.
      </Alert>

      <TextField
        select
        label="Batch"
        size="small"
        value={batch}
        onChange={(event) => { setBatch(event.target.value); setRoom(""); }}
      >
        {slots.map((slot) => (
          <MenuItem key={slot.batch} value={String(slot.batch)} disabled={!slot.freeRooms.length}>
            Batch {slot.batch} · {slot.time} ·{" "}
            {slot.freeRooms.length ? `${slot.freeRooms.length} room(s) free` : "no free rooms"}
          </MenuItem>
        ))}
      </TextField>

      <TextField
        select
        label="Room"
        size="small"
        value={room}
        onChange={(event) => setRoom(event.target.value)}
        disabled={!chosen}
        helperText={chosen ? "Only rooms free in that batch are listed" : "Pick a batch first"}
      >
        {(chosen?.freeRooms ?? []).map((option) => (
          <MenuItem key={option} value={option}>{option}</MenuItem>
        ))}
      </TextField>

      <TextField
        select
        label="Judges"
        size="small"
        SelectProps={{ multiple: true }}
        value={picked}
        onChange={(event) => setPicked(event.target.value)}
        disabled={!chosen}
        helperText="Checked-in judges first. A clash in this batch is refused."
      >
        {judges.map((judge) => (
          <MenuItem key={judge.uid} value={judge.uid}>
            {judge.name}
            {judge.finalOnly ? " (final round judge)" : ""}
            {judge.checkedIn ? "" : " (not checked in)"}
          </MenuItem>
        ))}
      </TextField>

      <Button
        variant="contained"
        disabled={saving || !chosen || !room || !picked.length}
        onClick={() =>
          run(
            () => scheduleTeamIntoBatch({
              teamId,
              batch: Number(batch),
              room,
              time: chosen?.time,
              judgeUids: picked,
            }),
            `Scheduled into ${room} in batch ${batch}`
          )
        }
      >
        Add to batch {batch || "…"}
      </Button>
    </>
  );
}

/**
 * Deleting a team.
 *
 * Not just the team node: every member's `teamId` and every judge's copy of the
 * assignment have to go with it, or a competitor is left pointing at a team
 * that does not exist and a judge keeps a card for a room nobody will present
 * in. deleteTeam writes all of it in one update.
 */
function DeleteTeam({ team, teamId, name, saving, run, onClose }) {
  const [confirming, setConfirming] = useState(false);
  const memberCount = Object.keys(team.members ?? {}).length;

  if (!confirming) {
    return (
      <>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>Delete</Typography>
        <Button color="error" variant="outlined" disabled={saving} onClick={() => setConfirming(true)}>
          Delete this team
        </Button>
      </>
    );
  }

  return (
    <>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>Delete</Typography>
      <Alert severity="error">
        Deleting {name || "this team"} also clears {memberCount} member
        {memberCount === 1 ? "'s" : "s'"} team, its schedule entry, and every judge's copy of the
        assignment. Their scores are kept, and will show against a team that no longer exists.
      </Alert>
      <Button
        color="error"
        variant="contained"
        disabled={saving}
        onClick={async () => {
          const ok = await run(() => deleteTeam({ teamId, teamName: name }), `Deleted ${name || teamId}`);
          if (ok) onClose();
        }}
      >
        Yes, delete {name || "this team"}
      </Button>
      <Button variant="text" disabled={saving} onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </>
  );
}
