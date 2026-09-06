import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { Alert, Box, Button, Card, CardContent, Divider, Stack, Typography } from "@mui/material";
import { onValue, ref } from "firebase/database";
import { database } from "../../firebase";
import { readEventState } from "./eventReadiness";

/**
 * What an organizer sees when they sign in.
 *
 * They used to see nothing. The dashboard built its cards for competitors and
 * for judges, and an account that is only an organizer matched neither -- so
 * the people who do almost all the work in this app landed on a countdown and
 * an empty page, and everything they needed was behind a dropdown of seven
 * destinations in no particular order.
 *
 * This answers the three questions that page should have been answering:
 * where the day has got to, what is not ready yet, and what to do next. All of
 * it is derived from the same data the rest of the app reads -- there is no
 * "current phase" flag to keep in step with reality.
 */
export default function AdminHome() {
  const [config, setConfig] = useState({});
  const [teams, setTeams] = useState({});
  const [judges, setJudges] = useState({});
  const [competitors, setCompetitors] = useState({});
  const [scoredTeams, setScoredTeams] = useState(0);
  const [finalActive, setFinalActive] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [legacyScoreTeams, setLegacyScoreTeams] = useState(0);

  useEffect(() => {
    const stop = [
      onValue(ref(database, "config"), (s) => setConfig(s.val() ?? {})),
      onValue(ref(database, "teams"), (s) => {
        const all = s.val() ?? {};
        setTeams(all);
        // cards still under the team node mean migrate-scores has not been run
        setLegacyScoreTeams(Object.values(all).filter((team) => team?.scores).length);
      }),
      onValue(ref(database, "judges"), (s) => setJudges(s.val() ?? {})),
      onValue(ref(database, "competitors"), (s) => setCompetitors(s.val() ?? {})),
      onValue(ref(database, "scores/first"), (s) => setScoredTeams(Object.keys(s.val() ?? {}).length)),
      onValue(ref(database, "finalRound/active"), (s) => setFinalActive(s.val() === true)),
      onValue(ref(database, "scheduleDraft"), (s) => setHasDraft(s.exists())),
    ];
    return () => stop.forEach((fn) => fn());
  }, []);

  const state = useMemo(
    () =>
      readEventState({
        config, teams, judges, competitors, scoredTeams, finalActive, hasDraft, legacyScoreTeams,
      }),
    [config, teams, judges, competitors, scoredTeams, finalActive, hasDraft, legacyScoreTeams]
  );

  const { counts } = state;
  const outstanding = state.checks.filter((check) => !check.done);

  return (
    <Stack spacing={2.5}>
      {/* Both of these fail silently rather than loudly, so nothing else in the
          app would ever mention them. */}
      {state.blockers.map((blocker) => (
        <Alert
          key={blocker.id}
          severity="error"
          action={
            <Button size="small" component={RouterLink} to={blocker.to}>
              Open
            </Button>
          }
        >
          <Typography variant="body2" sx={{ fontWeight: 600, color: "inherit" }}>
            {blocker.title}
          </Typography>
          <Typography variant="body2">{blocker.detail}</Typography>
          <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>
            {blocker.how}
          </Typography>
        </Alert>
      ))}

      <Card>
        <CardContent sx={{ p: 2.5, "&:last-child": { pb: 2.5 } }}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            justifyContent="space-between"
            alignItems={{ sm: "center" }}
          >
            <Box>
              <Typography variant="overline" component="p">
                Event status
              </Typography>
              <Typography variant="h2" sx={{ mt: 0.25 }}>
                {state.phaseLabel}
              </Typography>
            </Box>

            <Stack direction="row" sx={{ gap: 2.5, flexWrap: "wrap", rowGap: 1 }}>
              <Figure value={counts.teams.submitted} of={counts.teams.total} label="submitted" />
              <Figure value={counts.judges.checkedIn} of={counts.judges.roundOne} label="judges in" />
              <Figure value={counts.people.checkedIn} of={counts.people.competitors} label="checked in" />
              {counts.scoredTeams > 0 && (
                <Figure value={counts.scoredTeams} of={counts.teams.submitted} label="scored" />
              )}
            </Stack>
          </Stack>

          {/* The planner's own refusal, asked early enough to act on -- but not
              before anyone has submitted, when every downstream number is
              trivially zero and the checklist below already says so. A warning
              that is always on from the day the site opens is one people learn
              to read past. */}
          {counts.teams.submitted > 0 && !state.supply.ok && state.supply.error && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              {state.supply.error}
            </Alert>
          )}

          <Stack direction="row" sx={{ mt: 2, flexWrap: "wrap", gap: 1 }}>
            {state.actions.map((action, index) => (
              <Button
                key={action.label}
                component={RouterLink}
                to={action.to}
                variant={action.primary || index === 0 ? "contained" : "outlined"}
              >
                {action.label}
              </Button>
            ))}
          </Stack>

          {state.actions[0]?.why && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              {state.actions[0].why}
            </Typography>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent sx={{ p: 2.5, "&:last-child": { pb: 2.5 } }}>
          <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 1 }}>
            <Typography variant="overline" component="p">
              Before judging can run
            </Typography>
            <Typography variant="data">
              {state.checks.length - outstanding.length}/{state.checks.length}
            </Typography>
          </Stack>

          <Stack divider={<Divider />}>
            {state.checks.map((check) => (
              <Stack
                key={check.id}
                direction="row"
                spacing={1.5}
                alignItems="center"
                sx={{ py: 1 }}
              >
                <Box
                  aria-hidden="true"
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    flexShrink: 0,
                    bgcolor: check.done ? "success.main" : "divider",
                    border: check.done ? "none" : 1,
                    borderColor: "text.disabled",
                  }}
                />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" sx={{ color: "text.primary" }}>
                    {check.label}
                  </Typography>
                  <Typography variant="caption" component="p">
                    {check.detail}
                  </Typography>
                </Box>
                {!check.done && (
                  <Button size="small" component={RouterLink} to={check.to}>
                    Fix
                  </Button>
                )}
              </Stack>
            ))}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}

/** A count against the number it is out of, because neither means much alone. */
function Figure({ value, of, label }) {
  return (
    <Box>
      <Typography variant="data" sx={{ fontSize: "1rem", fontWeight: 600 }}>
        {value}
        <Box component="span" sx={{ color: "text.secondary", fontWeight: 400 }}>
          /{of}
        </Box>
      </Typography>
      <Typography variant="caption" component="p">
        {label}
      </Typography>
    </Box>
  );
}
