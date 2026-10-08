import { useEffect, useState } from "react";
import { Alert, Button, Divider, MenuItem, Stack, TextField, Typography } from "@mui/material";
import EditDrawer from "../records/EditDrawer";

/**
 * Everything about one team's slot: which batch and room it sits in, and who
 * is judging it.
 *
 * Unlike the other edit drawers in this app, nothing here is staged behind a
 * single Save -- each control is its own `onEdit` dispatch, because the
 * organizer's own next move usually depends on what the last one did (place
 * a team, then immediately add its judges). The one exception is the
 * batch/room pair, which borrows `EditDrawer`'s own Save button (relabelled
 * "Apply") gated on whether the pair actually differs from where the team
 * sits now -- pressing Apply with nothing changed would still write a
 * (no-op) `moveTeam` edit and clutter the undo history for nothing.
 *
 * `onEdit(op)` is `SchedulePreview`'s single edit pipeline: it runs `op`
 * through `applyEdit` and, on success, saves the result. It resolves to the
 * `applyEdit` shape (`{ ok, error?, conflict? }`) -- `ok: false` here means
 * the edit itself was refused, and this drawer is the only place that shows
 * it. A `saveDraft` refusal (the draft moved under the organizer) is a
 * different failure than SchedulePreview surfaces on the page Snackbar
 * instead, since by then the live subscription has already replaced the plan
 * this drawer is looking at.
 */
export default function TeamSlotDrawer({ open, plan, teamId, onEdit, onClose }) {
  const current = teamId ? plan.assignments?.[teamId] : undefined;
  const rooms = plan.basis?.rooms ?? [];
  const batchCount = plan.basis?.batchCount ?? 0;
  const batchTimes = plan.basis?.batchTimes ?? {};

  const [batch, setBatch] = useState(current?.batch ?? 1);
  const [room, setRoom] = useState(current?.room ?? "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [swapPicks, setSwapPicks] = useState({});
  const [addPick, setAddPick] = useState("");

  // Resets only when a different team opens, not on every plan tick -- the
  // draft is live-subscribed, and re-syncing on every update would clobber a
  // batch/room choice the organizer is still making with the echo of a save
  // that same choice is about to produce.
  useEffect(() => {
    if (!open) return;
    const assignment = teamId ? plan.assignments?.[teamId] : undefined;
    setBatch(assignment?.batch ?? 1);
    setRoom(assignment?.room ?? "");
    setError(null);
    setSwapPicks({});
    setAddPick("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, open]);

  const takenInBatch = new Set(
    Object.values(plan.assignments ?? {})
      .filter((a) => a.batch === batch && a.id !== teamId)
      .map((a) => a.room)
  );
  const roomOptions = rooms.filter(
    (r) => !takenInBatch.has(r) || r === current?.room
  );

  const dirty = Boolean(room) && (batch !== current?.batch || room !== current?.room);

  const runEdit = async (op) => {
    setBusy(true);
    const result = await onEdit(op);
    setBusy(false);
    setError(result.ok ? null : result.error);
    return result.ok;
  };

  const applyMove = () => runEdit({ type: "moveTeam", teamId, batch, room });

  const judges = current?.judges ?? [];
  const onTeamIds = new Set(judges.map((j) => j.judgeId));
  // `judgeNames` covers everyone marked for either round, which is wider than
  // `basis.judgeIds` -- the pool the plan was allocated from. That gap is the
  // point: a final-round judge is never auto-assigned, but an organizer filling
  // a no-show should be able to reach one, so they are offered and labelled.
  const finalOnly = new Set(plan.finalOnlyJudgeIds ?? []);
  const addableJudges = Object.keys(plan.judgeNames ?? {})
    .filter((id) => !onTeamIds.has(id))
    .map((id) => ({ id, name: plan.judgeNames?.[id] ?? id, finalOnly: finalOnly.has(id) }))
    .sort((a, b) => Number(a.finalOnly) - Number(b.finalOnly) || a.name.localeCompare(b.name));

  const removeJudge = (judgeUid) => runEdit({ type: "removeJudge", teamId, judgeUid });

  const swapJudge = async (fromUid, toUid) => {
    setSwapPicks((picks) => ({ ...picks, [fromUid]: toUid }));
    const ok = await runEdit({ type: "swapJudge", teamId, fromUid, toUid });
    setSwapPicks((picks) => ({ ...picks, [fromUid]: "" }));
    return ok;
  };

  const addJudge = async (judgeUid) => {
    setAddPick(judgeUid);
    const ok = await runEdit({ type: "addJudge", teamId, judgeUid });
    setAddPick("");
    return ok;
  };

  return (
    <EditDrawer
      open={open}
      title={current?.teamName ?? (teamId ? plan.teamNames?.[teamId] : null) ?? "Team"}
      subtitle={current ? `${current.room} · Batch ${current.batch} · ${current.time}` : "Not placed yet"}
      onClose={onClose}
      onSave={applyMove}
      saving={busy}
      error={error}
      dirty={dirty}
      saveLabel="Apply"
    >
      <TextField
        select
        label="Batch"
        size="small"
        value={batch}
        onChange={(event) => { setBatch(Number(event.target.value)); setRoom(""); }}
      >
        {Array.from({ length: batchCount }, (_, i) => i + 1).map((b) => (
          <MenuItem key={b} value={b}>
            Batch {b}{batchTimes[b] ? ` · ${batchTimes[b]}` : ""}
          </MenuItem>
        ))}
      </TextField>

      <TextField
        select
        label="Room"
        size="small"
        value={room}
        onChange={(event) => setRoom(event.target.value)}
        helperText="Only rooms free in that batch are listed"
      >
        {roomOptions.map((r) => (
          <MenuItem key={r} value={r}>{r}</MenuItem>
        ))}
      </TextField>

      <Divider />

      {current ? (
        <>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>Judges</Typography>

          {judges.length === 0 && (
            <Alert severity="warning">
              No judges assigned. This team cannot be published until one is added.
            </Alert>
          )}

          <Stack spacing={1.5}>
            {judges.map((judge) => (
              <Stack key={judge.judgeId} direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" sx={{ flex: 1 }}>{judge.judgeName}</Typography>
                <TextField
                  select
                  size="small"
                  label="Swap"
                  value={swapPicks[judge.judgeId] ?? ""}
                  onChange={(event) => swapJudge(judge.judgeId, event.target.value)}
                  disabled={busy || !addableJudges.length}
                  sx={{ minWidth: 140 }}
                >
                  {addableJudges.map((option) => (
                    <MenuItem key={option.id} value={option.id}>
                      {option.name}{option.finalOnly ? " (final round judge)" : ""}
                    </MenuItem>
                  ))}
                </TextField>
                <Button
                  size="small"
                  color="error"
                  disabled={busy}
                  onClick={() => removeJudge(judge.judgeId)}
                >
                  Remove
                </Button>
              </Stack>
            ))}
          </Stack>

          <TextField
            select
            label="Add judge"
            size="small"
            value={addPick}
            onChange={(event) => addJudge(event.target.value)}
            disabled={busy || !addableJudges.length}
            helperText={
              addableJudges.length
                ? "Final round judges are offered but never assigned automatically."
                : "Every eligible judge is already on this team"
            }
          >
            {addableJudges.map((option) => (
              <MenuItem key={option.id} value={option.id}>
                {option.name}{option.finalOnly ? " (final round judge)" : ""}
              </MenuItem>
            ))}
          </TextField>
        </>
      ) : (
        <Alert severity="info">Place this team in a room first, then add judges.</Alert>
      )}
    </EditDrawer>
  );
}
