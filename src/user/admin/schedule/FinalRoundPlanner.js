import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert, Box, Button, Card, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, IconButton, MenuItem, Snackbar, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import { ConfirmDialog } from "../adminUi.js";
import { planFinalRound, publishFinalRound, warningsFor } from "../../judge/finalRoundService.js";
import {
  subscribeFinalDraft, saveFinalDraft, clearFinalDraft,
} from "../../judge/finalDraftStore.js";
import { applyFinalEdit, undoFinalEdit } from "../../judge/applyFinalEdit.js";
import { slotsOf, slotLabel, finalStats, eligibleFor } from "../../judge/finalRoundPlan.js";

/**
 * Planning the final round, the way the first round is planned.
 *
 * Activating the final round used to be a modal with a checkbox per team.
 * Everything else was derived at the moment of the write — panels from the
 * round-one exclusions, running order from the ranking, the room from a
 * constant — so the things most likely to need correcting on the day were
 * exactly the things an organizer could not touch.
 *
 * This owns everything that can be done to a plan before `publishFinalRound`
 * turns it into assignments. Every change goes through `applyFinalEdit` and, on
 * success, `saveFinalDraft`, so a refusal is surfaced rather than swallowed and
 * two organizers with the page open see each other's edits.
 */
export default function FinalRoundPlanner() {
  const [plan, setPlan] = useState(undefined);
  const [building, setBuilding] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [openTeamId, setOpenTeamId] = useState(null);
  const [showCut, setShowCut] = useState(false);
  const [drift, setDrift] = useState(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // publishing clears the draft, so without this the page would drop straight
  // back to "Build a final round plan" -- reading as though nothing happened
  const [published, setPublished] = useState(null);

  useEffect(() => subscribeFinalDraft((next) => setPlan(next)), []);

  const stats = plan ? finalStats(plan) : null;
  const warnings = plan ? warningsFor(plan) : [];
  const slots = plan ? slotsOf(plan) : [];

  async function build() {
    setBuilding(true);
    setError(null);
    setDrift(null);
    const result = await planFinalRound({});
    if (!result.ok) {
      setBuilding(false);
      setError(result.error);
      return;
    }
    // Carry the version of whatever is stored.
    //
    // A fresh plan is version 0, and the draft store refuses a save whose
    // version does not match what is there -- that is what stops two organizers
    // clobbering each other. Building over an existing draft is not that: it is
    // the same person deliberately starting again, and it is what the "Re-rank"
    // repair does when a card lands mid-planning. Without this, that repair
    // failed with "another organizer changed this draft", which is both wrong
    // and unactionable.
    const draft = { ...result.plan, version: plan?.version ?? 0 };
    const saved = await saveFinalDraft(draft);
    setBuilding(false);
    if (!saved.ok) {
      setError(saved.error);
      return;
    }
    setToast("Built a final round plan. Nothing is written until you publish.");
  }

  /** Run one edit, then persist it. A refusal never reaches the draft. */
  async function edit(op) {
    const result = applyFinalEdit(plan, op);
    if (!result.ok) {
      setToast(result.error);
      return false;
    }
    const saved = await saveFinalDraft(result.plan);
    if (!saved.ok) {
      setToast(saved.error);
      return false;
    }
    return true;
  }

  async function undo() {
    const previous = undoFinalEdit(plan);
    if (!previous) return;
    const saved = await saveFinalDraft(previous);
    if (!saved.ok) setToast(saved.error);
  }

  async function publish() {
    setConfirmPublish(false);
    setPublishing(true);
    setError(null);
    setDrift(null);

    const result = await publishFinalRound(plan);
    setPublishing(false);

    if (result.drift?.some((issue) => issue.level === "blocking")) {
      setDrift(result.drift);
      return;
    }
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPublished({ teams: slots.length, room: plan.room, warnings: result.warnings ?? [] });
  }

  async function discard() {
    setConfirmDiscard(false);
    const result = await clearFinalDraft();
    if (!result.ok) setError(result.error);
  }

  // ---- render ----

  if (plan === undefined) {
    return <Typography variant="body2">Loading the final round plan…</Typography>;
  }

  if (published) {
    return (
      <Stack spacing={2}>
        <Alert severity="success">
          Final round published. Judges can see their assignments now.
        </Alert>

        <Card sx={{ p: 2.5 }}>
          <Stack spacing={1.5}>
            <Box>
              <Typography variant="overline" component="p">
                Published
              </Typography>
              <Typography variant="h3" sx={{ mt: 0.25 }}>
                {published.teams} team{published.teams === 1 ? "" : "s"} in {published.room}
              </Typography>
            </Box>

            {published.warnings.map((warning) => (
              <Alert key={warning} severity="warning">
                {warning}
              </Alert>
            ))}

            <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
              <Button variant="contained" component={RouterLink} to="/user/admin/judging">
                Watch final round progress
              </Button>
              <Button onClick={() => setPublished(null)}>Plan it again</Button>
            </Stack>
          </Stack>
        </Card>
      </Stack>
    );
  }

  if (plan === null) {
    return (
      <Stack spacing={2}>
        {error && <Alert severity="error">{error}</Alert>}
        <Card sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Typography variant="body2">
              Building reads the first-round scores, ranks every submitted team and cuts the top
              few into a plan you can edit. It writes nothing.
            </Typography>
            <Box>
              <Button variant="contained" onClick={build} disabled={building}>
                {building ? "Building…" : "Build a final round plan"}
              </Button>
            </Box>
          </Stack>
        </Card>
      </Stack>
    );
  }

  const openTeam = openTeamId ? plan.assignments[openTeamId] : null;

  return (
    <Stack spacing={2}>
      {error && <Alert severity="error">{error}</Alert>}

      {drift && (
        <Alert severity="warning">
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
            The event moved since this plan was built. Nothing was written.
          </Typography>
          <Stack spacing={0.5}>
            {drift.map((issue) => (
              <Stack key={issue.message} direction="row" spacing={1} alignItems="center">
                <Typography variant="body2">{issue.message}</Typography>
                {issue.repair === "removeJudge" && (
                  <Button size="small" onClick={() => edit({
                    type: "removeJudge", teamId: issue.teamId, judgeId: issue.judgeId,
                  })}>
                    Remove
                  </Button>
                )}
                {issue.repair === "dropTeam" && (
                  <Button size="small" onClick={() => edit({ type: "dropTeam", teamId: issue.teamId })}>
                    Drop
                  </Button>
                )}
                {issue.repair === "setRoom" && (
                  <Button size="small" onClick={() => edit({ type: "setRoom", room: issue.room })}>
                    Apply
                  </Button>
                )}
                {issue.repair === "rerank" && (
                  <Button size="small" onClick={build}>Re-rank</Button>
                )}
              </Stack>
            ))}
          </Stack>
        </Alert>
      )}

      {warnings.map((warning) => (
        <Alert key={warning} severity="info">{warning}</Alert>
      ))}

      <Card sx={{ p: 2 }}>
        <Stack sx={{ gap: 2 }} direction="row" flexWrap="wrap" alignItems="center">
          <Stat label="finalists" value={`${stats.finalists} of ${stats.ranked}`} />
          <Stat label="panel" value={stats.minPanel === stats.maxPanel
            ? String(stats.minPanel)
            : `${stats.minPanel}–${stats.maxPanel}`} />
          <Stat label="no panel" value={stats.unjudged.length} warn={stats.unjudged.length > 0} />
          <Stat label="idle judges" value={stats.idle} />
          <Stat label="hand edits" value={stats.edits} />
          <Box sx={{ flexGrow: 1 }} />
          <TextField
            size="small"
            label="Room"
            defaultValue={plan.room}
            sx={{ width: 160 }}
            onBlur={(event) => {
              if (event.target.value.trim() !== plan.room) {
                edit({ type: "setRoom", room: event.target.value });
              }
            }}
          />
        </Stack>
      </Card>

      <Stack sx={{ gap: 1 }} direction="row" flexWrap="wrap">
        <Button variant="contained" onClick={() => setConfirmPublish(true)} disabled={publishing || !slots.length}>
          {publishing ? "Publishing…" : "Publish the final round"}
        </Button>
        <Button onClick={undo} disabled={!plan.edits.length}>
          Undo{plan.edits.length ? ` (${plan.edits.length})` : ""}
        </Button>
        <Button onClick={() => setShowCut((open) => !open)}>
          {showCut ? "Hide the ranking" : "Change who is in"}
        </Button>
        <Button color="error" onClick={() => setConfirmDiscard(true)}>Discard draft</Button>
      </Stack>

      {showCut && (
        <Card sx={{ p: 2 }}>
          <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>The ranking</Typography>
          <Stack divider={<Divider />}>
            {plan.ranked.map((team, index) => {
              const inCut = Boolean(plan.assignments[team.teamId]);
              return (
                <Stack key={team.teamId} direction="row" spacing={1} alignItems="center" sx={{ py: 0.75 }}>
                  <Typography variant="body2" sx={{ width: 28, color: "text.secondary" }}>
                    {index + 1}
                  </Typography>
                  <Typography variant="body2" sx={{ flex: 1, fontWeight: inCut ? 600 : 400 }}>
                    {team.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {team.averageScore.toFixed(1)} · {team.judgeCount} judge
                    {team.judgeCount === 1 ? "" : "s"} · {team.fundableVotes} fundable
                  </Typography>
                  <Button
                    size="small"
                    onClick={() => edit(
                      inCut
                        ? { type: "dropTeam", teamId: team.teamId }
                        : { type: "addTeam", teamId: team.teamId }
                    )}
                  >
                    {inCut ? "Drop" : "Add"}
                  </Button>
                </Stack>
              );
            })}
          </Stack>
        </Card>
      )}

      <Card sx={{ p: 2 }}>
        <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
          Running order — {plan.room}
        </Typography>
        {!slots.length ? (
          <Typography variant="body2">
            Nobody is in the cut. Use <strong>Change who is in</strong> to add a team.
          </Typography>
        ) : (
          <Stack divider={<Divider />}>
            {slots.map((slot) => (
              <Stack
                key={slot.teamId}
                direction={{ xs: "column", md: "row" }}
                spacing={1}
                alignItems={{ md: "center" }}
                sx={{ py: 1 }}
              >
                <Chip size="small" label={slotLabel(slot.order)} sx={{ flexShrink: 0 }} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{slot.teamName}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {slot.judges.length
                      ? slot.judges.map((judge) => judge.judgeName).join(", ")
                      : "nobody on the panel — presents to an empty room"}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={0.5}>
                  <Tooltip title="Earlier">
                    <span>
                      <IconButton size="small" disabled={slot.order === 0}
                        onClick={() => edit({ type: "moveSlot", teamId: slot.teamId, order: slot.order - 1 })}>
                        ↑
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Later">
                    <span>
                      <IconButton size="small" disabled={slot.order === slots.length - 1}
                        onClick={() => edit({ type: "moveSlot", teamId: slot.teamId, order: slot.order + 1 })}>
                        ↓
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Button size="small" variant="outlined" onClick={() => setOpenTeamId(slot.teamId)}>
                    Judges
                  </Button>
                </Stack>
              </Stack>
            ))}
          </Stack>
        )}
      </Card>

      {openTeam && (
        <PanelDrawer
          plan={plan}
          slot={openTeam}
          onClose={() => setOpenTeamId(null)}
          onEdit={edit}
        />
      )}

      <ConfirmDialog
        open={confirmPublish}
        title={`Publish the final round?`}
        consequences={[
          `${slots.length} team${slots.length === 1 ? "" : "s"} in ${plan.room}.`,
          "This replaces every judge's final assignments and the standings.",
          "A restore point is taken first.",
          ...(stats.unjudged.length
            ? [`${stats.unjudged.join(", ")} has nobody on its panel.`]
            : []),
        ]}
        confirmLabel="Publish"
        onConfirm={publish}
        onCancel={() => setConfirmPublish(false)}
      />

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard this plan?"
        consequences={[
          `${plan.edits.length} hand edit${plan.edits.length === 1 ? "" : "s"} would be lost.`,
          "Nothing that is already published changes.",
        ]}
        confirmLabel="Discard"
        onConfirm={discard}
        onCancel={() => setConfirmDiscard(false)}
      />

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={6000}
        onClose={() => setToast(null)}
        message={toast}
      />
    </Stack>
  );
}

function Stat({ label, value, warn = false }) {
  return (
    <Box>
      <Typography variant="h3" sx={{ fontSize: "1.1rem" }} color={warn ? "error" : "text.primary"}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Box>
  );
}

/** Add, remove or swap a judge on one finalist's panel. */
function PanelDrawer({ plan, slot, onClose, onEdit }) {
  const [mode, setMode] = useState("add");
  const [target, setTarget] = useState("");
  const [replacing, setReplacing] = useState("");

  const seated = slot.judges;
  const seatedIds = new Set(seated.map((judge) => judge.judgeId));
  // everyone eligible for THIS team who is not already on it: the round-one
  // scorers are excluded here as well as refused by applyFinalEdit, so nobody
  // is offered a choice that will be rejected
  const available = eligibleFor(plan.pool, plan.excluded?.[slot.teamId]).filter(
    (judge) => !seatedIds.has(judge.judgeId)
  );
  const barred = (plan.pool ?? []).filter((judge) => plan.excluded?.[slot.teamId]?.[judge.judgeId]);

  const choices = mode === "remove" ? seated : available;
  const ready = target && (mode !== "swap" || replacing);

  async function run() {
    const op =
      mode === "add"
        ? { type: "addJudge", teamId: slot.teamId, judgeId: target }
        : mode === "remove"
        ? { type: "removeJudge", teamId: slot.teamId, judgeId: target }
        : { type: "swapJudge", teamId: slot.teamId, fromJudgeId: replacing, toJudgeId: target };

    if (await onEdit(op)) onClose();
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        <Typography variant="h3" component="div">Panel for {slot.teamName}</Typography>
        <Typography variant="body2">
          {slotLabel(slot.order)} · {plan.room}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.75}>
          <Alert severity="info" sx={{ py: 0.25 }}>
            Nothing is written until the plan is published.
          </Alert>

          {barred.length > 0 && (
            <Typography variant="caption" color="text.secondary">
              Not offered: {barred.map((judge) => judge.judgeName).join(", ")} — they scored
              {" "}{slot.teamName} in round one.
            </Typography>
          )}

          <TextField
            select
            label="Change"
            value={mode}
            onChange={(event) => { setMode(event.target.value); setTarget(""); setReplacing(""); }}
            fullWidth
          >
            <MenuItem value="add">Add a judge</MenuItem>
            <MenuItem value="remove">Remove a judge</MenuItem>
            <MenuItem value="swap">Swap a judge out</MenuItem>
          </TextField>

          {mode === "swap" && (
            <TextField select label="Replace" value={replacing} fullWidth
              onChange={(event) => setReplacing(event.target.value)}>
              {seated.map((judge) => (
                <MenuItem key={judge.judgeId} value={judge.judgeId}>{judge.judgeName}</MenuItem>
              ))}
            </TextField>
          )}

          <TextField
            select
            label={mode === "remove" ? "Judge to remove" : "Judge to add"}
            value={target}
            fullWidth
            onChange={(event) => setTarget(event.target.value)}
            helperText={choices.length ? undefined : "Nobody available."}
          >
            {choices.map((judge) => (
              <MenuItem key={judge.judgeId} value={judge.judgeId}>{judge.judgeName}</MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!ready} onClick={run}>Apply</Button>
      </DialogActions>
    </Dialog>
  );
}
