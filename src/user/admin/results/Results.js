import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert, Box, Button, Card, Chip, Divider, Stack, Typography,
} from "@mui/material";
import { onValue, ref } from "firebase/database";
import { database } from "../../../firebase";
import Layout from "../../Layout";
import { PageHeader } from "../adminUi";
import { SCORE_MAX_TOTAL } from "../../judge/scoreRubric";
import {
  finalStandings, latestArchive, panelsFrom, standingsState, winnerOf,
} from "./finalStandings";

/**
 * The result of the event.
 *
 * There was no screen for this. The standings were written at activation, never
 * read, and carried the first round's averages -- so the only way to find out
 * who won was to export the final round's raw cards and add them up. On the one
 * night of the year it matters, with a room waiting.
 *
 * The page is deliberately careful about one distinction: a ranking with cards
 * outstanding is a running total, not a result. The first row is always
 * somebody, because the tiebreak is a total order -- but announcing them while
 * a judge has not pressed submit is the mistake this page exists to prevent.
 */
export default function Results() {
  const [finalRoundTeams, setFinalRoundTeams] = useState(null);
  const [finalScores, setFinalScores] = useState({});
  const [judges, setJudges] = useState({});
  const [active, setActive] = useState(false);
  const [archive, setArchive] = useState({});

  useEffect(() => {
    const stop = [
      onValue(ref(database, "finalRound/teams"), (s) => setFinalRoundTeams(s.exists() ? s.val() : null)),
      onValue(ref(database, "scores/final"), (s) => setFinalScores(s.val() ?? {})),
      onValue(ref(database, "judges"), (s) => setJudges(s.val() ?? {})),
      onValue(ref(database, "finalRound/active"), (s) => setActive(s.val() === true)),
      onValue(ref(database, "finalRound/archive"), (s) => setArchive(s.val() ?? {})),
    ];
    return () => stop.forEach((fn) => fn());
  }, []);

  // Deactivating clears the standings and every panel, so a closed round is
  // read back out of the archive it was moved to.
  const archived = useMemo(() => latestArchive(archive), [archive]);
  const closed = !finalRoundTeams && Boolean(archived);
  const teamsInRound = finalRoundTeams ?? archived;

  const standings = useMemo(
    () => finalStandings({ finalRoundTeams: teamsInRound ?? {}, finalScores, panels: panelsFrom(judges) }),
    [teamsInRound, finalScores, judges]
  );
  const state = standingsState(standings, { closed });
  const winner = winnerOf(standings, { closed });

  return (
    <Layout maxWidth="md">
      <PageHeader
        title="Results"
        stats={[
          { label: "finalists", singular: "finalist", value: standings.length },
          { label: "cards in", value: `${state.cards}/${state.expected}` },
        ]}
      />

      {closed && (
        <Alert severity="info" sx={{ mb: 2 }}>
          The final round is closed, so these standings are final. Read back from the archive it
          was moved to when judging was closed.
        </Alert>
      )}

      {!teamsInRound && (
        <Alert severity="info" sx={{ mb: 2 }}>
          The final round has not been activated, so there is nothing to rank yet.{" "}
          <Button size="small" component={RouterLink} to="/user/admin/schedule?round=final">
            Plan the final round
          </Button>
        </Alert>
      )}

      {teamsInRound && !state.settled && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {state.waitingOn.length
            ? `Still scoring. Waiting on ${state.waitingOn
                .map((team) => `${team.missing} card${team.missing === 1 ? "" : "s"} for ${team.name}`)
                .join(", ")}. This is a running total, not the result.`
            : "No final round scores have been filed yet."}
        </Alert>
      )}

      {winner && (
        <Card sx={{ mb: 2, borderColor: "primary.main" }}>
          <Box sx={{ p: 2.5 }}>
            <Typography variant="overline" component="p" sx={{ color: "primary.main" }}>
              Winner
            </Typography>
            <Typography variant="h1" sx={{ mt: 0.5 }}>
              {winner.name}
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              <Typography variant="data" component="span">
                {winner.averageScore.toFixed(1)}
              </Typography>{" "}
              of {SCORE_MAX_TOTAL} across{" "}
              <Typography variant="data" component="span">
                {winner.received}
              </Typography>{" "}
              {winner.received === 1 ? "judge" : "judges"}.{" "}
              {closed ? "The round is closed." : "Every card is in."}
            </Typography>
          </Box>
        </Card>
      )}

      {standings.length > 0 && (
        <Card>
          <Box sx={{ px: 2.5, pt: 2, pb: 0.5 }}>
            <Typography variant="overline" component="p">
              Final round standings
            </Typography>
          </Box>
          <Stack divider={<Divider />} sx={{ px: 2.5, pb: 1 }}>
            {standings.map((team, index) => (
              <Stack
                key={team.teamId}
                direction={{ xs: "column", sm: "row" }}
                spacing={{ xs: 0.5, sm: 2 }}
                alignItems={{ sm: "center" }}
                sx={{ py: 1.5 }}
              >
                <Typography variant="data" sx={{ width: 24, color: "text.secondary" }}>
                  {typeof team.averageScore === "number" ? index + 1 : "—"}
                </Typography>

                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={{ fontWeight: 600 }}>{team.name}</Typography>
                  <Typography variant="caption" component="p">
                    First round{" "}
                    {typeof team.firstRound.averageScore === "number"
                      ? team.firstRound.averageScore.toFixed(1)
                      : "—"}{" "}
                    · {team.timeslot ?? "no slot"} · {team.room ?? "no room"}
                  </Typography>
                </Box>

                <Stack direction="row" spacing={2} alignItems="center">
                  <Box sx={{ textAlign: "right", minWidth: 64 }}>
                    <Typography variant="data" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                      {typeof team.averageScore === "number" ? team.averageScore.toFixed(1) : "—"}
                    </Typography>
                    <Typography variant="caption" component="p">
                      of {SCORE_MAX_TOTAL}
                    </Typography>
                  </Box>

                  <Chip
                    size="small"
                    variant="outlined"
                    color={team.complete ? "default" : "warning"}
                    label={`${team.received}/${team.expected} in`}
                    sx={{ "& .MuiChip-label": (t) => ({ ...t.typography.data }) }}
                  />
                </Stack>
              </Stack>
            ))}
          </Stack>
        </Card>
      )}

      {teamsInRound && (
        <Typography variant="caption" component="p" sx={{ mt: 2 }}>
          Ranked on the final round only, by average, then fundable votes, then judges, then name —
          the same tiebreak the cut used. {active ? "The final round is still open." : "The final round is closed."}
        </Typography>
      )}
    </Layout>
  );
}
