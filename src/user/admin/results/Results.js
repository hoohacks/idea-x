import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import {
  Alert, Box, Button, Card, Chip, Divider, Stack, Tab, Tabs, Typography,
} from "@mui/material";
import { onValue, ref } from "firebase/database";
import { database } from "../../../firebase";
import Layout from "../../Layout";
import { PageHeader } from "../adminUi";
import { SCORE_MAX_TOTAL } from "../../judge/scoreRubric";
import {
  finalStandings, firstRoundStandings, panelsFrom, standingsState, winnerOf,
} from "./standings";

/**
 * The result of the event, in both rounds.
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
 *
 * **The final tab shows the round that is on, and nothing else.** It used to
 * fall back to the most recently archived standings once the round was
 * deactivated, so a page titled Results answered with a previous round's teams.
 * The archive is still written -- deactivating keeps a record rather than
 * destroying one -- it is just not what this page reads.
 *
 * The rounds are tabs rather than two pages because the question an organizer
 * asks is the same one twice: who is on top, and is it settled yet. The tab is
 * in the URL, so the standings that are being read off a screen can be linked
 * to rather than described.
 */

const ROUNDS = [
  { id: "final", label: "Final round" },
  { id: "first", label: "First round" },
];

export default function Results() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("round");
  // Final by default: this page exists to answer who won, and the first round
  // is a step on the way to that rather than the thing being announced.
  const round = ROUNDS.some((entry) => entry.id === requested) ? requested : "final";
  const final = round === "final";

  const [teams, setTeams] = useState({});
  const [firstScores, setFirstScores] = useState({});
  const [finalRoundTeams, setFinalRoundTeams] = useState(null);
  const [finalScores, setFinalScores] = useState({});
  const [judges, setJudges] = useState({});
  const [active, setActive] = useState(false);

  useEffect(() => {
    const stop = [
      onValue(ref(database, "teams"), (s) => setTeams(s.val() ?? {})),
      onValue(ref(database, "scores/first"), (s) => setFirstScores(s.val() ?? {})),
      onValue(ref(database, "finalRound/teams"), (s) => setFinalRoundTeams(s.exists() ? s.val() : null)),
      onValue(ref(database, "scores/final"), (s) => setFinalScores(s.val() ?? {})),
      onValue(ref(database, "judges"), (s) => setJudges(s.val() ?? {})),
      onValue(ref(database, "finalRound/active"), (s) => setActive(s.val() === true)),
    ];
    return () => stop.forEach((fn) => fn());
  }, []);

  const finalRanking = useMemo(
    () => finalStandings({
      finalRoundTeams: finalRoundTeams ?? {},
      finalScores,
      panels: panelsFrom(judges),
    }),
    [finalRoundTeams, finalScores, judges]
  );

  const firstRanking = useMemo(
    () => firstRoundStandings({ teams, firstScores }),
    [teams, firstScores]
  );

  const standings = final ? finalRanking : firstRanking;
  const state = standingsState(standings);
  // Only the final round crowns anybody. A first round that is fully scored is
  // a complete ranking, not a winner -- the finalists are drawn off the top of
  // it and the night is still to come.
  const winner = final ? winnerOf(standings) : null;

  return (
    <Layout maxWidth="md">
      <PageHeader
        title="Results"
        stats={
          final
            ? [
                { label: "finalists", singular: "finalist", value: standings.length },
                { label: "cards in", value: `${state.cards}/${state.expected}` },
              ]
            : [
                { label: "teams ranked", singular: "team ranked", value: standings.length },
                { label: "cards in", value: `${state.cards}/${state.expected}` },
              ]
        }
      />

      <Tabs
        value={round}
        onChange={(_, next) => setParams(next === "final" ? {} : { round: next }, { replace: true })}
        sx={{ borderBottom: 1, borderColor: "divider", mb: 3 }}
      >
        {ROUNDS.map((entry) => (
          <Tab key={entry.id} value={entry.id} label={entry.label} />
        ))}
      </Tabs>

      {final && !finalRoundTeams && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No final round is running, so there is nobody to rank.{" "}
          <Button size="small" component={RouterLink} to="/user/admin/schedule?round=final">
            Plan the final round
          </Button>
        </Alert>
      )}

      {!final && standings.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No first round scores have been filed yet.{" "}
          <Button size="small" component={RouterLink} to="/user/admin/judging">
            Watch judging progress
          </Button>
        </Alert>
      )}

      {standings.length > 0 && !state.settled && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {state.waitingOn.length
            ? `Still scoring. Waiting on ${state.waitingOn
                .map((team) => `${team.missing} card${team.missing === 1 ? "" : "s"} for ${team.name}`)
                .join(", ")}. This is a running total, not the result.`
            : `No ${final ? "final" : "first"} round scores have been filed yet.`}
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
              {winner.received === 1 ? "judge" : "judges"}. Every card is in.
            </Typography>
          </Box>
        </Card>
      )}

      {standings.length > 0 && (
        <Card>
          <Box sx={{ px: 2.5, pt: 2, pb: 0.5 }}>
            <Typography variant="overline" component="p">
              {final ? "Final round standings" : "First round standings"}
            </Typography>
          </Box>
          <Stack divider={<Divider />} sx={{ px: 2.5, pb: 1 }}>
            {standings.map((team, index) => (
              <StandingRow key={team.teamId} team={team} place={index + 1} final={final} />
            ))}
          </Stack>
        </Card>
      )}

      {standings.length > 0 && (
        <Typography variant="caption" component="p" sx={{ mt: 2 }}>
          Ranked on the {final ? "final" : "first"} round only, by average, then fundable votes,
          then judges, then name — the same tiebreak the cut uses.{" "}
          {final
            ? active
              ? "The final round is still open."
              : "The final round is closed."
            : "The finalists are drawn off the top of this."}
        </Typography>
      )}
    </Layout>
  );
}

/**
 * One place in the table.
 *
 * The second line is what the round was decided against: for the final that is
 * the first-round average the cut was made on, so a team that led all day and
 * came second on the night can be seen doing it. For the first round it is
 * where and when they presented, which is what an organizer checking a
 * surprising score wants next.
 */
function StandingRow({ team, place, final }) {
  const scored = typeof team.averageScore === "number";

  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={{ xs: 0.5, sm: 2 }}
      alignItems={{ sm: "center" }}
      sx={{ py: 1.5 }}
    >
      <Typography variant="data" sx={{ width: 24, color: "text.secondary" }}>
        {scored ? place : "—"}
      </Typography>

      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontWeight: 600 }}>{team.name}</Typography>
        <Typography variant="caption" component="p">
          {final ? (
            <>
              First round{" "}
              {typeof team.firstRound.averageScore === "number"
                ? team.firstRound.averageScore.toFixed(1)
                : "—"}{" "}
              · {team.timeslot ?? "no slot"} · {team.room ?? "no room"}
            </>
          ) : (
            <>
              {team.batch ? `Batch ${team.batch}` : "no batch"} · {team.timeslot ?? "no slot"} ·{" "}
              {team.room ?? "no room"}
            </>
          )}
        </Typography>
      </Box>

      <Stack direction="row" spacing={2} alignItems="center">
        <Box sx={{ textAlign: "right", minWidth: 64 }}>
          <Typography variant="data" sx={{ fontSize: "1rem", fontWeight: 600 }}>
            {scored ? team.averageScore.toFixed(1) : "—"}
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
  );
}
