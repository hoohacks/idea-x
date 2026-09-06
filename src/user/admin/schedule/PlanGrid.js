import { useMemo } from "react";
import { Box, Button, Card, Chip, Grid, Stack, Typography } from "@mui/material";
import { PageHeader } from "../adminUi";

/**
 * The plan itself: batches as columns, one team card per room, live stats
 * above and the two lists an organizer needs beside it.
 *
 * A card's border is the whole legend -- red at zero judges (this team
 * cannot be published as-is), amber below `basis.target` (publishable, but
 * thin), and the default hairline otherwise. There is no fourth state and no
 * legend to read: an organizer scanning a wall of cards at 4:45 should not
 * need one.
 */

function judgesLabel(min, max) {
  return min === max ? String(min) : `${min}–${max}`;
}

function TeamCard({ assignment, target, onOpenTeam }) {
  const judgeCount = assignment.judges.length;
  const borderColor =
    judgeCount === 0 ? "error.main" : judgeCount < target ? "warning.main" : "divider";

  return (
    <Card
      variant="outlined"
      role="button"
      tabIndex={0}
      aria-label={`Open ${assignment.teamName}`}
      onClick={() => onOpenTeam(assignment.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onOpenTeam(assignment.id);
      }}
      sx={{
        p: 1.25,
        cursor: "pointer",
        borderWidth: 2,
        borderColor,
        "&:hover": { borderColor: judgeCount === 0 ? "error.dark" : judgeCount < target ? "warning.dark" : "primary.main" },
      }}
    >
      <Typography variant="caption" color="text.secondary">{assignment.room}</Typography>
      <Typography sx={{ fontWeight: 600 }}>{assignment.teamName}</Typography>
      <Stack direction="row" sx={{ mt: 0.75, flexWrap: "wrap", gap: 0.5 }}>
        {judgeCount === 0 ? (
          <Chip label="No judges" size="small" color="error" variant="outlined" />
        ) : (
          assignment.judges.map((judge) => (
            <Chip key={judge.judgeId} label={judge.judgeName} size="small" />
          ))
        )}
      </Stack>
    </Card>
  );
}

export default function PlanGrid({ plan, stats, onOpenTeam }) {
  const target = plan.basis?.target ?? 1;
  // memoised because `?? []` is a new array on every render, which would make
  // the useMemo below recompute every time and defeat the point of it
  const rooms = useMemo(() => plan.basis?.rooms ?? [], [plan.basis?.rooms]);
  const batchCount = plan.basis?.batchCount ?? 0;
  const batchTimes = plan.basis?.batchTimes ?? {};

  const byBatch = useMemo(() => {
    const map = new Map();
    for (const assignment of Object.values(plan.assignments ?? {})) {
      if (!map.has(assignment.batch)) map.set(assignment.batch, []);
      map.get(assignment.batch).push(assignment);
    }
    for (const list of map.values()) {
      list.sort((a, b) => rooms.indexOf(a.room) - rooms.indexOf(b.room));
    }
    return map;
  }, [plan.assignments, rooms]);

  const batches = Array.from({ length: batchCount }, (_, index) => index + 1);

  const spareJudges = (stats.spareJudgeIds ?? []).map((id) => plan.judgeNames?.[id] ?? id);
  const unscheduledTeams = (stats.unscheduledTeamIds ?? []).map((id) => ({
    id,
    name: plan.teamNames?.[id] ?? id,
  }));

  const headerStats = [
    { label: "teams", value: stats.teams },
    { label: "judges", value: stats.judges },
    { label: "judges per team", value: judgesLabel(stats.minJudgesPerTeam, stats.maxJudgesPerTeam) },
    { label: "spares", value: stats.spareJudgeIds?.length ?? 0 },
    { label: "below target", value: stats.belowTarget?.length ?? 0 },
    { label: "repeat pairings", value: stats.repeatPairings },
  ];

  return (
    <Box>
      <PageHeader title="Schedule preview" stats={headerStats} />

      <Grid container spacing={2}>
        <Grid item xs={12} md={9}>
          <Grid container spacing={2}>
            {batches.map((batch) => (
              <Grid item xs={12} sm={6} md={4} key={batch}>
                <Stack spacing={1}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Batch {batch}
                    {batchTimes[batch] ? ` · ${batchTimes[batch]}` : ""}
                  </Typography>
                  <Stack spacing={1}>
                    {(byBatch.get(batch) ?? []).map((assignment) => (
                      <TeamCard
                        key={assignment.id}
                        assignment={assignment}
                        target={target}
                        onOpenTeam={onOpenTeam}
                      />
                    ))}
                    {!(byBatch.get(batch) ?? []).length && (
                      <Typography variant="body2" color="text.secondary">
                        No teams in this batch.
                      </Typography>
                    )}
                  </Stack>
                </Stack>
              </Grid>
            ))}
          </Grid>
        </Grid>

        <Grid item xs={12} md={3}>
          <Stack spacing={2}>
            {spareJudges.length > 0 && (
              <Card variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.75 }}>
                  Spare judges
                </Typography>
                <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5 }}>
                  {spareJudges.map((name) => (
                    <Chip key={name} label={name} size="small" variant="outlined" />
                  ))}
                </Stack>
              </Card>
            )}

            {unscheduledTeams.length > 0 && (
              <Card variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.75 }}>
                  Unscheduled teams
                </Typography>
                <Stack spacing={0.75}>
                  {unscheduledTeams.map((team) => (
                    <Stack key={team.id} direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                      <Typography variant="body2">{team.name}</Typography>
                      <Button size="small" onClick={() => onOpenTeam(team.id)}>
                        Place
                      </Button>
                    </Stack>
                  ))}
                </Stack>
              </Card>
            )}
          </Stack>
        </Grid>
      </Grid>
    </Box>
  );
}
