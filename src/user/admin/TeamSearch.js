import { onValue, ref, get } from "firebase/database";
import { database } from "../../firebase";
import {
  calculateAverageScore,
  countFundableVotes,
  scoreCard,
  scoredJudgeCount,
  SCORE_FIELDS,
  SCORE_MAX_TOTAL,
} from "../judge/scoreRubric";

import React, { useEffect, useMemo, useState } from "react";

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  MenuItem,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { IoChevronDown } from "react-icons/io5";
import Layout from "../Layout";
import { memberIds } from "../team/teamMembers";
import { personName } from "../../roles";
import { PageHeader, FilterBar, SearchField, RowList, Row } from "./adminUi";
import { deleteScore } from "./danger/dangerZone";
import { FIRST_ROUND, FINAL_ROUND } from "../judge/getTeamInfo";
import PaperScoreDialog from "./scores/PaperScoreDialog";
import TeamEditDrawer from "./records/TeamEditDrawer";

function ScoreSummary({ label, round, teamId, teamName, scores, judgeNames = {}, onDelete }) {
  const judgeIds = Object.keys(scores ?? {});
  if (!judgeIds.length) return null;

  const average = calculateAverageScore(scores);
  const fundable = countFundableVotes(scores);

  return (
    <Accordion disableGutters elevation={0} sx={{ "&:before": { display: "none" }, bgcolor: "transparent" }}>
      <AccordionSummary expandIcon={<IoChevronDown />} sx={{ px: 0, minHeight: 40 }}>
        <Stack sx={{ gap: 1 }} direction="row" alignItems="baseline" flexWrap="wrap">
          <Typography variant="body2" sx={{ fontWeight: 600, color: "text.primary" }}>
            {label}
          </Typography>
          <Typography variant="body2">
            {average === null ? "not scored" : `${average.toFixed(1)} / ${SCORE_MAX_TOTAL}`}
            {" · "}
            {scoredJudgeCount(scores)} judge{scoredJudgeCount(scores) === 1 ? "" : "s"}
            {" · "}
            {fundable} fundable
          </Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 0, pt: 0 }}>
        <Stack spacing={1.25}>
          {judgeIds.map((judgeId) => {
            const scoreObj = scores[judgeId];
            const card = scoreCard(scoreObj);
            return (
              <Box key={judgeId} sx={{ pl: 1.5, borderLeft: 2, borderColor: "divider" }}>
                <Typography variant="body2" sx={{ fontWeight: 600, color: "text.primary" }}>
                  {card === null ? "—" : `${card.toFixed(1)} / ${SCORE_MAX_TOTAL}`}
                  <Box component="span" sx={{ fontWeight: 400, color: "text.secondary" }}>
                    {"  "}
                    {judgeNames[judgeId] ?? `judge ${judgeId.slice(0, 8)}`}
                    {scoreObj?.source === "paper" ? " (entered from paper)" : ""}
                  </Box>
                </Typography>
                <Typography variant="body2">
                  {Object.entries(SCORE_FIELDS)
                    .map(
                      ([criterion, max]) =>
                        `${criterion.replace(/_/g, " ")} ${scoreObj?.[criterion] ?? "—"}/${max}`
                    )
                    .join(" · ")}
                  {scoreObj?.fundable ? " · fundable" : ""}
                </Typography>
                {scoreObj?.notes && (
                  <Typography variant="body2" sx={{ fontStyle: "italic", mt: 0.25 }}>
                    “{scoreObj.notes}”
                  </Typography>
                )}
                <Button
                  size="small"
                  color="error"
                  onClick={() => onDelete({
                    round, teamId, teamName,
                    judgeUid: judgeId, judgeName: judgeNames[judgeId],
                  })}
                  sx={{ mt: 0.25 }}
                >
                  Delete this card
                </Button>
              </Box>
            );
          })}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

function TeamSearch() {
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [teams, setTeams] = useState({});
  const [submittedCount, setSubmittedCount] = useState(0);
  const [judgeNames, setJudgeNames] = useState({});
  // scores no longer live under /teams, so they need their own subscriptions
  const [firstScores, setFirstScores] = useState({});
  const [finalScores, setFinalScores] = useState({});
  const [deleting, setDeleting] = useState(null);
  const [reentering, setReentering] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [editing, setEditing] = useState(null);

  /**
   * A deleted card cannot be written back: enteredBy is pinned to auth.uid, so
   * only its original author could restore it. Re-typing it through the paper
   * dialog is the recovery path, and it stamps correct new provenance.
   */
  const confirmDelete = async () => {
    setBusy(true);
    try {
      const result = await deleteScore(deleting);
      if (!result.ok) {
        setToast({ severity: "error", message: result.error });
        return;
      }
      setToast({ severity: "success", message: "Card deleted. Re-enter it if it was a mistake." });
      setReentering({ ...deleting, card: result.card });
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  };

  const teamCount = Object.keys(teams).length;
  const percentSubmitted = teamCount ? (submittedCount / teamCount) * 100 : 0;

  useEffect(() => {
    const stop = [
      onValue(ref(database, "scores/first"), (snap) => setFirstScores(snap.val() ?? {})),
      onValue(ref(database, "scores/final"), (snap) => setFinalScores(snap.val() ?? {})),
      onValue(ref(database, "judges"), (snap) => {
        const names = {};
        for (const [uid, judge] of Object.entries(snap.val() ?? {})) {
          names[uid] =
            [judge?.firstName, judge?.lastName].filter(Boolean).join(" ").trim() ||
            `judge ${uid.slice(0, 8)}`;
        }
        setJudgeNames(names);
      }),
    ];
    return () => stop.forEach((fn) => fn());
  }, []);

  useEffect(() => {
    // one cache of uid -> name across snapshots. This used to re-read every
    // member of every team inside the subscription callback, so a single write
    // anywhere under /teams fanned out into O(teams x members) reads.
    const nameCache = new Map();

    const unsubscribe = onValue(ref(database, "/teams/"), async (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        setTeams({});
        setSubmittedCount(0);
        return;
      }

      let submitted = 0;
      const resolved = {};

      for (const key in data) {
        const team = { ...data[key] };
        if (team.submitted) submitted += 1;

        const members = memberIds(team.members);
        team.memberNames = await Promise.all(
          members.map(async (uid) => {
            if (nameCache.has(uid)) return nameCache.get(uid);
            const userSnapshot = await get(ref(database, `competitors/${uid}`));
            const userInfo = userSnapshot.exists() ? userSnapshot.val() : null;
            const name = userInfo ? personName(userInfo, "Unnamed competitor") : "Unknown user";
            nameCache.set(uid, name);
            return name;
          })
        );

        resolved[key] = team;
      }

      setSubmittedCount(submitted);
      setTeams(resolved);
    });

    return () => unsubscribe();
  }, []);

  // the pre-migration copy still counts until migrate-scores.mjs has run
  const scoresFor = useMemo(
    () => (key) => ({ ...(teams[key]?.scores ?? {}), ...(firstScores[key] ?? {}) }),
    [teams, firstScores]
  );
  const finalScoresFor = useMemo(
    () => (key) => ({ ...(teams[key]?.finalScores ?? {}), ...(finalScores[key] ?? {}) }),
    [teams, finalScores]
  );

  const visibleTeams = useMemo(() => {
    const needle = query.toLowerCase();
    const keys = Object.keys(teams).filter((key) => {
      const team = teams[key];
      return (
        (team?.name ?? "").toLowerCase().includes(needle) ||
        (team?.submission?.ideaName ?? "").toLowerCase().includes(needle)
      );
    });

    const first = (key) => calculateAverageScore(scoresFor(key)) ?? -1;
    const final = (key) => calculateAverageScore(finalScoresFor(key)) ?? -1;

    return keys.sort((a, b) => {
      if (sortBy === "score") return first(b) - first(a);
      if (sortBy === "finalScore") return final(b) - final(a);
      return (teams[a]?.name ?? "").localeCompare(teams[b]?.name ?? "");
    });
  }, [teams, query, sortBy, scoresFor, finalScoresFor]);

  return (
    <Layout maxWidth="lg">
      <PageHeader
        title="Teams"
        progress={percentSubmitted}
        stats={[
          { label: "teams", value: teamCount },
          { label: "submitted", value: submittedCount },
          { label: "of teams", value: `${percentSubmitted.toFixed(0)}%` },
        ]}
      />

      <FilterBar>
        <SearchField
          placeholder="Search team or idea name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <TextField
          select
          label="Sort by"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="name">Name</MenuItem>
          <MenuItem value="score">First round score</MenuItem>
          <MenuItem value="finalScore">Final round score</MenuItem>
        </TextField>
      </FilterBar>

      <RowList empty="No teams match those filters.">
        {visibleTeams.map((key) => {
          const team = teams[key];
          const submission = team.submission;

          return (
            <Row key={key} accent={Boolean(team.submitted)}>
              <Stack spacing={0.5}>
                <Stack sx={{ gap: 1 }} direction="row" alignItems="center" flexWrap="wrap">
                  <Typography sx={{ fontWeight: 600 }}>{team.name || "Unnamed team"}</Typography>
                  <Chip
                    label={team.submitted ? "submitted" : "not submitted"}
                    size="small"
                    variant={team.submitted ? "filled" : "outlined"}
                    color={team.submitted ? "primary" : "default"}
                  />
                  {team.schedule && (
                    <Chip
                      label={`${team.schedule.time} · ${team.schedule.room}`}
                      size="small"
                      variant="outlined"
                    />
                  )}
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setEditing({ teamId: key, team })}
                    sx={{ ml: "auto" }}
                  >
                    Edit
                  </Button>
                </Stack>

                <Typography variant="body2">
                  {team.memberNames?.length
                    ? team.memberNames.join(", ")
                    : "No members"}
                </Typography>

                {team.submitted && submission && (
                  <Box sx={{ mt: 0.5 }}>
                    <Stack sx={{ gap: 1 }} direction="row" alignItems="baseline" flexWrap="wrap">
                      <Typography variant="body2" sx={{ fontWeight: 600, color: "text.primary" }}>
                        {submission.ideaName}
                      </Typography>
                      {submission.pitchDeckURL && (
                        <Link
                          href={submission.pitchDeckURL}
                          target="_blank"
                          rel="noopener noreferrer"
                          variant="body2"
                        >
                          Pitch deck
                        </Link>
                      )}
                    </Stack>
                    <Typography variant="body2">{submission.problemStatement}</Typography>
                    <Typography variant="body2">Industry: {submission.targetIndustry}</Typography>
                  </Box>
                )}

                <ScoreSummary
                  label="First round" round={FIRST_ROUND}
                  teamId={key} teamName={team.name}
                  scores={scoresFor(key)} judgeNames={judgeNames} onDelete={setDeleting}
                />
                <ScoreSummary
                  label="Final round" round={FINAL_ROUND}
                  teamId={key} teamName={team.name}
                  scores={finalScoresFor(key)} judgeNames={judgeNames} onDelete={setDeleting}
                />
              </Stack>
            </Row>
          );
        })}
      </RowList>

      {deleting && (
        <Dialog open onClose={busy ? undefined : () => setDeleting(null)} maxWidth="xs" fullWidth>
          <DialogTitle>Delete this score?</DialogTitle>
          <DialogContent dividers>
            <Alert severity="warning">
              {deleting.judgeName ?? "This judge"}'s {deleting.round} round card for{" "}
              {deleting.teamName}. It cannot be undone -- the rules pin a card to the
              person who entered it, so nobody else can write it back. You will be
              offered the values to re-type.
            </Alert>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button onClick={() => setDeleting(null)} disabled={busy} variant="outlined">Cancel</Button>
            <Button onClick={confirmDelete} disabled={busy} variant="contained" color="error">
              {busy ? "Deleting..." : "Delete"}
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {reentering && (
        <PaperScoreDialog
          team={{ teamId: reentering.teamId, name: reentering.teamName }}
          judges={Object.entries(judgeNames).map(([judgeId, judgeName]) => ({ judgeId, judgeName }))}
          round={reentering.round}
          initialJudgeUid={reentering.judgeUid}
          initialValues={reentering.card}
          onClose={() => setReentering(null)}
          onSaved={() => {
            setReentering(null);
            setToast({ severity: "success", message: "Card re-entered." });
          }}
        />
      )}

      {editing && (
        <TeamEditDrawer
          team={editing.team}
          teamId={editing.teamId}
          onClose={() => setEditing(null)}
          onResult={(result, message) =>
            setToast(result?.ok
              ? { severity: "success", message }
              : { severity: "error", message: result?.error ?? "Something went wrong." })}
        />
      )}

      <Snackbar open={Boolean(toast)} autoHideDuration={6000} onClose={() => setToast(null)}>
        {toast ? <Alert severity={toast.severity} onClose={() => setToast(null)}>{toast.message}</Alert> : undefined}
      </Snackbar>
    </Layout>
  );
}

export default TeamSearch;
