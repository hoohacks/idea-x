import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  Divider,
  Grid,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import { Link } from "react-router-dom";
import Layout from "../Layout";
import ScheduleCard from "./ScheduleCard";
import { readScheduleMeta } from "./scheduleConfig";
import { subscribeToPersonalSchedule, subscribeToFinalRoundSchedule } from "./getPersonalSchedule";
import ScoreSubmission from "./ScoreSubmission";
import { useAuth } from "../../App";
import { hasRole } from "../../roles";
import { ConfirmDialog } from "../admin/adminUi";
import {
  findTeamIdByName,
  submitScore,
  getMyScoredTeamIds,
  getMyFinalRoundScoredTeamIds,
  FIRST_ROUND,
  FINAL_ROUND,
} from "./getTeamInfo";
import { deactivateFinalRound, subscribeToFinalRoundActive } from "./finalRoundService";
import { useJudgingSync } from "./useJudgingSync";
import { clearDraft } from "./scoreDraft";
import { readDraft } from "./draftStore";

function Section({ title, caption, children }) {
  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="baseline" sx={{ mb: 1.5 }}>
        <Typography variant="h2">{title}</Typography>
        {caption && <Typography variant="body2">{caption}</Typography>}
      </Stack>
      {children}
    </Box>
  );
}

function Assignments() {
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  function openFor(card) {
    setSelected(card);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setSelected(null);
  }

  const [scheduleMeta, setScheduleMeta] = useState(null);
  const [draft, setDraft] = useState(null);
  const [personalAssignments, setPersonalAssignments] = useState([]);
  const [finalAssignments, setFinalAssignments] = useState([]);
  const [loadingAssignments, setLoadingAssignments] = useState(true);
  // scored teams are tracked by database id, never by name -- team names are
  // not unique and would collide
  const [scoredTeamIds, setScoredTeamIds] = useState(() => new Set());
  const [finalRoundScoredTeamIds, setFinalRoundScoredTeamIds] = useState(() => new Set());
  const [finalRoundActive, setFinalRoundActive] = useState(false);
  const [finalRoundLoading, setFinalRoundLoading] = useState(true);
  const [togglingFinalRound, setTogglingFinalRound] = useState(false);
  const [finalRoundError, setFinalRoundError] = useState(null);
  const [deactivateConfirmOpen, setDeactivateConfirmOpen] = useState(false);

  const { userTypes, userCredential } = useAuth();
  const currentUserId = userCredential?.user?.uid;
  const canManageSchedule = hasRole(userTypes, "admin");
  const canViewAssignments = hasRole(userTypes, "judge");

  const { online, pendingCount, pendingTeamIdsByRound, syncing, retry } = useJudgingSync(
    canViewAssignments ? currentUserId : null
  );

  /**
   * The judge's first-round assignments, live.
   *
   * This used to be a one-shot `get` that ran once on mount and never again,
   * so a judge who left the page open all day never saw an organizer's room
   * fix or reassignment -- their card just sat there wrong while the actual
   * schedule moved on. Subscribing to the judge's own assignment node means
   * an edit reaches an open tab the same way `.info/connected` already does,
   * with no reload required.
   */
  useEffect(() => {
    if (!canViewAssignments) {
      setPersonalAssignments([]);
      setLoadingAssignments(false);
      return undefined;
    }

    setLoadingAssignments(true);
    let cancelled = false;

    const onError = (err) => {
      if (cancelled) return;
      console.error("Error fetching personal schedule:", err);
      // silently showing "no assignments yet" for what is really a failed read
      // sends a judge to find an organizer for a problem that is not theirs
      setToast({
        severity: "error",
        message: "Could not load your assignments. Check your connection and reload.",
      });
      setLoadingAssignments(false);
    };

    let unsubscribe = () => {};
    try {
      unsubscribe = subscribeToPersonalSchedule(async (teams) => {
        if (cancelled) return;
        setPersonalAssignments(teams ?? []);
        setLoadingAssignments(false);
        try {
          const scored = await getMyScoredTeamIds((teams ?? []).map((t) => t.id));
          if (!cancelled) setScoredTeamIds(scored);
        } catch (err) {
          if (!cancelled) console.warn("Could not check scored teams:", err);
        }
      }, onError);
    } catch (err) {
      onError(err);
    }

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [canViewAssignments]);

  /**
   * Pick up scores that synced in the background.
   *
   * `scoredTeamIds` is read once, when the assignments load. A card queued on
   * the device and drained later therefore landed in the database without this
   * component knowing: the card stopped being "Saved on device" and fell back
   * to "Score team", inviting the judge to score the same team a second time
   * and reading, to them, as though their work had been thrown away.
   *
   * The queue emptying is the signal, so that is what this watches.
   */
  const lastPending = useRef(0);
  useEffect(() => {
    const drained = lastPending.current > 0 && pendingCount === 0;
    lastPending.current = pendingCount;
    if (!drained || !canViewAssignments) return undefined;

    let cancelled = false;
    (async () => {
      try {
        const firstRoundIds = personalAssignments.map((assignment) => assignment.id);
        if (firstRoundIds.length) {
          const scored = await getMyScoredTeamIds(firstRoundIds);
          if (!cancelled) setScoredTeamIds(scored);
        }

        const finalIds = finalAssignments.map((team) => team.id);
        if (finalIds.length) {
          const scored = await getMyFinalRoundScoredTeamIds(finalIds);
          if (!cancelled) setFinalRoundScoredTeamIds(scored);
        }
      } catch (error) {
        // the card stays as it is; the next load will correct it
        console.warn("Could not refresh scored teams after syncing:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pendingCount, canViewAssignments, personalAssignments, finalAssignments]);

  useEffect(() => {
    if (!canManageSchedule) return;
    readScheduleMeta().then(setScheduleMeta).catch(() => setScheduleMeta(null));
  }, [canManageSchedule]);

  // A one-shot check, not a live subscription -- this button just needs to
  // know whether a draft exists when the page loads, so a live draft is not
  // invisible from the page an organizer starts on. readDraft() already
  // returns null on any failure (including "no draft yet"), so no .catch is
  // needed here.
  useEffect(() => {
    if (!canManageSchedule) return;
    readDraft().then(setDraft);
  }, [canManageSchedule]);

  async function handleDeactivateFinalRound() {
    setDeactivateConfirmOpen(true);
  }

  async function confirmDeactivateFinalRound() {
    setDeactivateConfirmOpen(false);
    setTogglingFinalRound(true);
    setFinalRoundError(null);
    try {
      await deactivateFinalRound();
    } catch (err) {
      console.error("Failed to deactivate final round:", err);
      setFinalRoundError(err.message || "Failed to deactivate final round.");
    } finally {
      setTogglingFinalRound(false);
    }
  }

  async function handleSubmit(scores) {
    if (submitting) return;
    try {
      setSubmitting(true);

      const teamName = selected?.teamName;
      if (!teamName) throw new Error("No team selected");

      const round = selected?.round === FINAL_ROUND ? FINAL_ROUND : FIRST_ROUND;
      const isFinalRound = round === FINAL_ROUND;

      // schedules written before assignments carried an id fall back to a name
      // lookup, which is why duplicate team names are worth avoiding
      const teamId = selected?.teamId ?? (await findTeamIdByName(teamName));
      if (!teamId) {
        setToast({ severity: "error", message: `Could not find "${teamName}" in the database.` });
        return;
      }

      const result = await submitScore({ round, teamId, teamName, score: scores });

      // the outbox owns the card either way now, so the draft has done its job
      if (currentUserId) clearDraft({ round, teamId, judgeUid: currentUserId });

      const record = isFinalRound ? setFinalRoundScoredTeamIds : setScoredTeamIds;
      if (result.status === "saved") {
        record((prev) => new Set(prev).add(teamId));
        setToast({ severity: "success", message: `Score submitted for ${teamName}.` });
      } else {
        setToast({
          severity: "warning",
          message: `No connection. ${teamName}'s score is saved on this device and will send itself when you are back online.`,
        });
      }
      closeModal();
    } catch (e) {
      console.error(e);
      setToast({ severity: "error", message: `Could not submit: ${e.message}` });
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    const unsubscribe = subscribeToFinalRoundActive((state) => {
      setFinalRoundActive(Boolean(state?.active));
      setFinalRoundLoading(false);
      setFinalRoundError(state?.error ?? null);
    });
    return () => unsubscribe();
  }, []);

  // The judge's finalists come from their own record. Deriving them in the
  // browser from /finalRound only worked because every judge could read the
  // standings -- team names and average scores -- before they were announced.
  //
  // This is a live subscription, not a one-shot read keyed on
  // `finalRoundActive`. A one-shot read only ever re-ran when that boolean
  // flipped, so a final round that was published and then corrected -- a
  // room swap, a panel fix, a republish -- while `finalRound/active` stayed
  // true the entire time never reached a judge who already had the page
  // open. Subscribing to the judge's own `finalAssignments` node picks up
  // that edit the moment it lands, the same way the first-round schedule
  // above does.
  useEffect(() => {
    if (!finalRoundActive || !canViewAssignments) {
      setFinalAssignments([]);
      setFinalRoundScoredTeamIds(new Set());
      return undefined;
    }

    let cancelled = false;

    const onError = (err) => {
      if (cancelled) return;
      console.error("Error fetching final round assignments:", err);
      // same failure mode as the first-round read above: a transient denial
      // renders identically to "you have no final round assignments" unless
      // it says otherwise, which sends a judge looking for an organizer over
      // a problem that is not theirs
      setToast({
        severity: "error",
        message: "Could not load your final round assignments. Check your connection and reload.",
      });
    };

    let unsubscribe = () => {};
    try {
      unsubscribe = subscribeToFinalRoundSchedule(async (teams) => {
        if (cancelled) return;
        setFinalAssignments(teams);
        try {
          const scored = await getMyFinalRoundScoredTeamIds(teams.map((t) => t.id));
          if (!cancelled) setFinalRoundScoredTeamIds(scored);
        } catch (err) {
          if (!cancelled) console.warn("Could not check final round scored teams:", err);
        }
      }, onError);
    } catch (err) {
      onError(err);
    }

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [finalRoundActive, canViewAssignments]);

  const remaining = useMemo(
    () =>
      personalAssignments.filter(
        (a) => !scoredTeamIds.has(a.id) && !pendingTeamIdsByRound[FIRST_ROUND].has(a.id)
      ).length,
    [personalAssignments, scoredTeamIds, pendingTeamIdsByRound]
  );

  const draftTarget = useMemo(() => {
    if (!selected?.teamId || !currentUserId) return null;
    return {
      round: selected.round === FINAL_ROUND ? FINAL_ROUND : FIRST_ROUND,
      teamId: selected.teamId,
      judgeUid: currentUserId,
    };
  }, [selected, currentUserId]);

  // An unpublished draft takes priority over scheduleMeta -- otherwise a
  // live draft is invisible from the page an organizer starts on, and
  // "Plan a new schedule" reads as an invitation to lose it.
  const scheduleButtonLabel = draft
    ? `Resume draft (${draft.edits?.length ?? 0} edit${(draft.edits?.length ?? 0) === 1 ? "" : "s"})`
    : scheduleMeta?.generatedAt
      ? "Plan a new schedule"
      : "Plan schedule";

  return (
    <Layout maxWidth="lg">
      <Stack spacing={3}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          justifyContent="space-between"
          alignItems={{ xs: "flex-start", sm: "center" }}
          spacing={1}
        >
          <Typography variant="h1">Judging</Typography>
          {canViewAssignments && personalAssignments.length > 0 && (
            <Typography variant="body2">
              {remaining === 0
                ? "All teams scored"
                : `${remaining} of ${personalAssignments.length} left to score`}
            </Typography>
          )}
        </Stack>

        {canViewAssignments && (pendingCount > 0 || !online) && (
          <Alert
            severity={pendingCount > 0 ? "warning" : "info"}
            action={
              pendingCount > 0 ? (
                <Button color="inherit" size="small" onClick={retry} disabled={syncing}>
                  {syncing ? "Sending…" : "Retry now"}
                </Button>
              ) : undefined
            }
          >
            {pendingCount > 0
              ? `${pendingCount} score${pendingCount === 1 ? "" : "s"} saved on this device and waiting to send. Keep this page open.`
              : "You are offline. Scores will be saved on this device until the connection is back."}
          </Alert>
        )}

        {canManageSchedule && (
          <Card sx={{ p: 2 }}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              alignItems={{ xs: "stretch", sm: "center" }}
            >
              <Typography variant="h5" sx={{ flex: 1 }}>
                Run of show
              </Typography>
              <Button variant="contained" component={Link} to="/user/admin/schedule">
                {scheduleButtonLabel}
              </Button>
              {finalRoundActive ? (
                <Button
                  variant="outlined"
                  onClick={handleDeactivateFinalRound}
                  disabled={togglingFinalRound || finalRoundLoading}
                >
                  Deactivate final round
                </Button>
              ) : (
                <Button
                  variant="outlined"
                  component={Link}
                  to="/user/admin/schedule?round=final"
                  disabled={togglingFinalRound || finalRoundLoading}
                >
                  Plan final round
                </Button>
              )}
            </Stack>

            {(finalRoundError || finalRoundActive || scheduleMeta) && (
              <Stack spacing={1} sx={{ mt: 2 }}>
                {finalRoundActive && <Alert severity="info">Final round is active.</Alert>}
                {scheduleMeta?.generatedAt && (
                  <Typography variant="body2">
                    Schedule generated {new Date(scheduleMeta.generatedAt).toLocaleString()}.
                    Use Judging progress to move a single judge instead of rebuilding the plan.
                  </Typography>
                )}
                {finalRoundError && <Alert severity="error">{finalRoundError}</Alert>}
              </Stack>
            )}
          </Card>
        )}

        {canViewAssignments && (
          <>
            <Section title="First round">
              {loadingAssignments ? (
                <Typography variant="body2">Loading your assignments…</Typography>
              ) : personalAssignments.length === 0 ? (
                <Card sx={{ p: 3 }}>
                  <Typography variant="body2" align="center">
                    No assignments yet. They appear once an admin generates the schedule.
                  </Typography>
                </Card>
              ) : (
                <Grid container spacing={2}>
                  {personalAssignments.map((assignment, idx) => (
                    <Grid item xs={12} sm={6} md={4} key={assignment.id ?? `${assignment.teamName}-${idx}`}>
                      <ScheduleCard
                        teamId={assignment.id}
                        teamName={assignment.teamName}
                        room={assignment.room}
                        time={assignment.time}
                        onButtonClick={(card) => openFor({ ...card, round: FIRST_ROUND })}
                        disabled={scoredTeamIds.has(assignment.id)}
                        pending={pendingTeamIdsByRound[FIRST_ROUND].has(assignment.id)}
                      />
                    </Grid>
                  ))}
                </Grid>
              )}
            </Section>

            {finalRoundActive && (
              <>
                <Divider />
                <Section title="Final round">
                  {finalAssignments.length === 0 ? (
                    <Card sx={{ p: 3 }}>
                      <Typography variant="body2" align="center">
                        No final round assignments for you.
                      </Typography>
                    </Card>
                  ) : (
                    <Grid container spacing={2}>
                      {finalAssignments.map((team) => (
                        <Grid item xs={12} sm={6} md={4} key={`final-${team.id}`}>
                          <ScheduleCard
                            teamId={team.id}
                            teamName={team.teamName}
                            room={team.room}
                            time={team.timeslot ?? team.time}
                            disabled={finalRoundScoredTeamIds.has(team.id)}
                            pending={pendingTeamIdsByRound[FINAL_ROUND].has(team.id)}
                            onButtonClick={(card) => openFor({ ...card, round: FINAL_ROUND })}
                          />
                        </Grid>
                      ))}
                    </Grid>
                  )}
                </Section>
              </>
            )}
          </>
        )}

        {!canViewAssignments && !canManageSchedule && (
          <Typography variant="body2">You do not have assigned judging duties.</Typography>
        )}
      </Stack>

      {modalOpen && selected && (
        <ScoreSubmission
          teamName={selected.teamName}
          room={selected.room}
          time={selected.time}
          submitting={submitting}
          draftTarget={draftTarget}
          isOverwrite={
            selected.round === FINAL_ROUND
              ? finalRoundScoredTeamIds.has(selected.teamId)
              : scoredTeamIds.has(selected.teamId)
          }
          onClose={closeModal}
          onSubmit={handleSubmit}
        />
      )}

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={6000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {toast ? (
          <Alert severity={toast.severity} onClose={() => setToast(null)} variant="filled">
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>

      <ConfirmDialog
        open={deactivateConfirmOpen}
        title="Deactivate final round judging?"
        consequences={[
          "Assignments are withdrawn from every judge.",
          "The standings are archived.",
        ]}
        confirmLabel="Deactivate"
        onConfirm={confirmDeactivateFinalRound}
        onCancel={() => setDeactivateConfirmOpen(false)}
      />

    </Layout>
  );
}

export default Assignments;
