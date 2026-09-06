import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { Link } from "react-router-dom";
import { onValue, ref } from "firebase/database";
import { database } from "../../firebase";
import Layout from "../Layout";
import { PageHeader, FilterBar, SearchField, RowList, Row } from "./adminUi";
import { buildProgress, TEAM_OK, TEAM_THIN, TEAM_UNJUDGED } from "./scores/judgingStatus";
import PaperScoreDialog from "./scores/PaperScoreDialog";
import { SCORE_MAX_TOTAL } from "../judge/scoreRubric";
import { FIRST_ROUND, FINAL_ROUND } from "../judge/getTeamInfo";
import {
  assignJudgeToTeam,
  unassignJudgeFromTeam,
  swapJudges,
} from "../judge/assignmentEdits";

const STATUS_CHIP = {
  [TEAM_UNJUDGED]: { label: "No scores", color: "error" },
  [TEAM_THIN]: { label: "Thinly judged", color: "warning" },
  [TEAM_OK]: { label: null, color: "default" },
};


/** Add, remove or swap a judge on one team, without regenerating anything. */
function ReassignDialog({ team, judges, onClose, onSaved }) {
  const [mode, setMode] = useState("add");
  const [target, setTarget] = useState("");
  const [replacing, setReplacing] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const assignedIds = new Set(team.assigned.map((a) => a.judgeId));
  const available = judges.filter((judge) => !assignedIds.has(judge.judgeId));

  async function run() {
    setBusy(true);
    setError(null);
    try {
      let result;
      if (mode === "add") {
        result = await assignJudgeToTeam({ judgeUid: target, teamId: team.teamId });
      } else if (mode === "remove") {
        result = await unassignJudgeFromTeam({ judgeUid: target, teamId: team.teamId });
      } else {
        result = await swapJudges({
          teamId: team.teamId,
          fromJudgeUid: replacing,
          toJudgeUid: target,
        });
      }

      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(`Updated the judges for ${team.name}.`);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const choices = mode === "remove" ? team.assigned : available;
  const ready = target && (mode !== "swap" || replacing);

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        <Typography variant="h3" component="div">
          Judges for {team.name}
        </Typography>
        <Typography variant="body2">
          {team.room ?? "No room"} · {team.time ?? "No time"}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.75}>
          <Alert severity="info" sx={{ py: 0.25 }}>
            Changes one team only. Scores already submitted are not affected.
          </Alert>

          <TextField
            select
            label="Change"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              setTarget("");
              setReplacing("");
            }}
            fullWidth
          >
            <MenuItem value="add">Add a judge</MenuItem>
            <MenuItem value="remove">Remove a judge</MenuItem>
            <MenuItem value="swap">Swap a judge out</MenuItem>
          </TextField>

          {mode === "swap" && (
            <TextField
              select
              label="Replace"
              value={replacing}
              onChange={(e) => setReplacing(e.target.value)}
              fullWidth
            >
              {team.assigned.map((judge) => (
                <MenuItem key={judge.judgeId} value={judge.judgeId}>
                  {judge.judgeName}
                </MenuItem>
              ))}
            </TextField>
          )}

          <TextField
            select
            label={mode === "remove" ? "Judge to remove" : "Judge"}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            fullWidth
          >
            {choices.map((judge) => (
              <MenuItem key={judge.judgeId} value={judge.judgeId}>
                {judge.judgeName ?? judge.name}
                {judge.checkedIn === false ? " (not checked in)" : ""}
              </MenuItem>
            ))}
          </TextField>

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={busy} variant="outlined">
          Cancel
        </Button>
        <Button onClick={run} disabled={busy || !ready} variant="contained">
          {busy ? "Saving…" : "Apply"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function JudgingProgress() {
  const [teams, setTeams] = useState({});
  const [judges, setJudges] = useState({});
  const [scores, setScores] = useState({});
  const [legacyScores, setLegacyScores] = useState({});
  const [finalRoundTeams, setFinalRoundTeams] = useState(null);
  const [round, setRound] = useState(FIRST_ROUND);
  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState("");
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [reassigning, setReassigning] = useState(null);
  const [scoring, setScoring] = useState(null);

  useEffect(() => {
    const stop = [
      onValue(ref(database, "teams"), (snap) => setTeams(snap.val() ?? {}), (e) =>
        setError(e.message)
      ),
      onValue(ref(database, "judges"), (snap) => setJudges(snap.val() ?? {}), (e) =>
        setError(e.message)
      ),
      // the finalists, and nothing about the first round says who they are
      onValue(
        ref(database, "finalRound/teams"),
        (snap) => setFinalRoundTeams(snap.exists() ? snap.val() : null),
        (e) => setError(e.message)
      ),
    ];
    return () => stop.forEach((fn) => fn());
  }, []);

  useEffect(() => {
    // scores moved out from under /teams, so this is its own subscription now
    const stop = onValue(
      ref(database, `scores/${round}`),
      (snap) => setScores(snap.val() ?? {}),
      (e) => setError(e.message)
    );
    return () => stop();
  }, [round]);

  useEffect(() => {
    // cards written before the migration still live under the team node. Drop
    // this once migrate-scores.mjs has run and been verified.
    const legacyKey = round === FINAL_ROUND ? "finalScores" : "scores";
    const next = {};
    for (const [teamId, team] of Object.entries(teams)) {
      if (team?.[legacyKey]) next[teamId] = team[legacyKey];
    }
    setLegacyScores(next);
  }, [teams, round]);

  const merged = useMemo(() => {
    const out = { ...legacyScores };
    for (const [teamId, cards] of Object.entries(scores)) {
      out[teamId] = { ...(out[teamId] ?? {}), ...cards };
    }
    return out;
  }, [scores, legacyScores]);

  const final = round === FINAL_ROUND;

  const { teamRows, judgeRows, totals } = useMemo(
    () => buildProgress({ teams, judges, scores: merged, final, finalRoundTeams }),
    [teams, judges, merged, final, finalRoundTeams]
  );

  const allJudges = useMemo(
    () =>
      Object.entries(judges)
        .map(([judgeId, judge]) => ({
          judgeId,
          judgeName:
            [judge?.firstName, judge?.lastName].filter(Boolean).join(" ").trim() ||
            "Unnamed Judge",
          checkedIn: judge?.checkedIn === true,
        }))
        .sort((a, b) => a.judgeName.localeCompare(b.judgeName)),
    [judges]
  );

  const needle = search.trim().toLowerCase();
  const visibleTeams = needle
    ? teamRows.filter(
        (row) =>
          row.name.toLowerCase().includes(needle) ||
          (row.room ?? "").toLowerCase().includes(needle)
      )
    : teamRows;
  const visibleJudges = needle
    ? judgeRows.filter(
        (row) =>
          row.name.toLowerCase().includes(needle) ||
          (row.email ?? "").toLowerCase().includes(needle)
      )
    : judgeRows;

  return (
    <Layout maxWidth="lg">
      <PageHeader
        title="Judging progress"
        progress={totals.percent}
        stats={[
          { label: "scores in", value: `${totals.received}/${totals.expected}` },
          { label: "no scores", value: totals.unjudged },
          { label: "thinly judged", value: totals.thin },
          { label: "judges checked in", value: `${totals.checkedIn}/${totals.judges}` },
        ]}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            select
            size="small"
            value={round}
            onChange={(e) => setRound(e.target.value)}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value={FIRST_ROUND}>First round</MenuItem>
            <MenuItem value={FINAL_ROUND}>Final round</MenuItem>
          </TextField>
          {/* the paper fallback, reachable from where an organizer is standing
              when the network gives out */}
          <Button variant="outlined" component={Link} to="/user/admin/print">
            Room sheets
          </Button>
        </Stack>
      </PageHeader>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {final && !finalRoundTeams && (
        <Alert severity="info" sx={{ mb: 2 }}>
          The final round has not been activated, so there are no finalists to show yet.
        </Alert>
      )}

      {totals.unjudged > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {totals.unjudged} team{totals.unjudged === 1 ? " has" : "s have"} no scores at all.
          {final ? " Check the panel is in the room." : " Use Judges on a row to send someone."}
        </Alert>
      )}

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label={`Teams (${teamRows.length})`} />
        <Tab label={`Judges (${judgeRows.length})`} />
      </Tabs>

      <FilterBar>
        <SearchField
          size="small"
          placeholder={tab === 0 ? "Search teams or rooms" : "Search judges"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </FilterBar>

      {tab === 0 ? (
        <RowList empty="No scheduled teams yet.">
          {visibleTeams.map((team) => {
            const chip = STATUS_CHIP[team.status];
            return (
              <Row key={team.teamId} accent={team.status !== TEAM_OK}>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  justifyContent="space-between"
                  alignItems={{ xs: "flex-start", sm: "center" }}
                  spacing={1}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Stack sx={{ gap: 1 }} direction="row" alignItems="baseline" flexWrap="wrap">
                      <Typography variant="h5">{team.name}</Typography>
                      {chip.label && (
                        <Chip label={chip.label} size="small" color={chip.color} />
                      )}
                    </Stack>
                    <Typography variant="body2">
                      {[team.room, team.time, team.batch ? `Batch ${team.batch}` : null]
                        .filter(Boolean)
                        .join(" · ") || "Not scheduled"}
                    </Typography>
                    <Typography variant="body2">
                      {team.received}/{team.expected} scores
                      {team.averageScore !== null &&
                        ` · avg ${team.averageScore.toFixed(1)}/${SCORE_MAX_TOTAL}`}
                      {team.outstanding.length > 0 &&
                        ` · waiting on ${team.outstanding.map((j) => j.judgeName).join(", ")}`}
                    </Typography>
                    {team.unassignedScorers.length > 0 && (
                      <Typography variant="body2">
                        Also scored by {team.unassignedScorers.map((j) => j.judgeName).join(", ")},
                        who are no longer assigned — these still count toward the average.
                      </Typography>
                    )}
                  </Box>

                  <Stack direction="row" spacing={1}>
                    {/* the dialog writes teamAssignments, which is the first
                        round's node -- pressing it here would edit the wrong
                        round. Final round panels are set when it is planned. */}
                    {!final && (
                      <Button size="small" variant="outlined" onClick={() => setReassigning(team)}>
                        Judges
                      </Button>
                    )}
                    <Button size="small" variant="outlined" onClick={() => setScoring(team)}>
                      Record score
                    </Button>
                  </Stack>
                </Stack>
              </Row>
            );
          })}
        </RowList>
      ) : (
        <RowList empty={final ? "No judges have final round assignments." : "No first round judges yet."}>
          {visibleJudges.map((judge) => {
            const left = judge.assignedCount - judge.submittedCount;
            return (
              <Row key={judge.judgeId} accent={left > 0 && !judge.checkedIn}>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  spacing={1}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Stack sx={{ gap: 1 }} direction="row" alignItems="baseline" flexWrap="wrap">
                      <Typography variant="h5">{judge.name}</Typography>
                      {!judge.checkedIn && (
                        <Chip label="Not checked in" size="small" color="warning" />
                      )}
                    </Stack>
                    <Typography variant="body2">
                      {judge.submittedCount}/{judge.assignedCount} submitted
                      {left > 0 &&
                        ` · outstanding: ${judge.outstanding
                          .map((a) => a.teamName)
                          .join(", ")}`}
                    </Typography>
                  </Box>
                  <Typography variant="body2">{judge.email}</Typography>
                </Stack>
              </Row>
            );
          })}
        </RowList>
      )}

      {reassigning && (
        <ReassignDialog
          team={reassigning}
          judges={allJudges}
          onClose={() => setReassigning(null)}
          onSaved={(message) => setToast({ severity: "success", message })}
        />
      )}

      {scoring && (
        <PaperScoreDialog
          team={scoring}
          round={round}
          judges={scoring.assigned.length ? scoring.assigned : allJudges}
          onClose={() => setScoring(null)}
          onSaved={(message) => setToast({ severity: "success", message })}
        />
      )}

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {toast ? (
          <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)}>
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Layout>
  );
}

export default JudgingProgress;
