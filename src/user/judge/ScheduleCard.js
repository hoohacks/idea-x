import React, { useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import { IoChevronDown, IoChevronUp } from "react-icons/io5";
import { getTeamSubmission } from "./getTeamInfo";

/**
 * One judging assignment.
 *
 * Props:
 * - teamId: the database key. Team names are not unique, so scoring keys off
 *   this rather than the name.
 * - pending: the score is written on this device but has not reached the
 *   database yet. Distinct from `disabled`, which means it has landed.
 */
function ScheduleCard({
  teamId = null,
  teamName = "Team",
  room = "TBD",
  time = "TBD",
  onButtonClick = () => {},
  disabled = false,
  pending = false,
}) {
  const [open, setOpen] = useState(false);
  const [submission, setSubmission] = useState(null);
  const [loadState, setLoadState] = useState("idle");

  async function toggleSubmission() {
    const next = !open;
    setOpen(next);
    // fetched on demand rather than on mount: a judge with three assignments
    // would otherwise fire three reads nobody has asked for
    if (!next || loadState !== "idle") return;

    setLoadState("loading");
    try {
      setSubmission(await getTeamSubmission(teamId));
      setLoadState("done");
    } catch (error) {
      console.warn(`Could not load the submission for ${teamName}:`, error);
      setLoadState("error");
    }
  }

  const buttonLabel = pending ? "Saved on device" : disabled ? "Scored" : "Score team";

  return (
    <Card sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <CardContent
        sx={{
          p: 2,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 1.5,
          "&:last-child": { pb: 2 },
        }}
      >
        <Stack spacing={0.75}>
          <Typography variant="h5" sx={{ lineHeight: 1.3 }}>
            {teamName}
          </Typography>
          <Stack sx={{ gap: 0.75 }} direction="row" flexWrap="wrap">
            {/* where and when: the two things a judge reads off this card while
                walking, so they are set as data rather than as labels */}
            <Chip
              label={time}
              size="small"
              variant="outlined"
              sx={{ "& .MuiChip-label": (t) => ({ ...t.typography.data }) }}
            />
            <Chip
              label={room}
              size="small"
              variant="outlined"
              sx={{ "& .MuiChip-label": (t) => ({ ...t.typography.data }) }}
            />
            {pending && <Chip label="Not synced" size="small" color="warning" />}
          </Stack>
        </Stack>

        {teamId && (
          <Box>
            <Button
              size="small"
              onClick={toggleSubmission}
              endIcon={open ? <IoChevronUp /> : <IoChevronDown />}
              sx={{ px: 0.5, minWidth: 0 }}
            >
              Submission
            </Button>

            <Collapse in={open} unmountOnExit>
              <Stack spacing={0.75} sx={{ pt: 1 }}>
                {loadState === "loading" && (
                  <Typography variant="body2">Loading…</Typography>
                )}
                {loadState === "error" && (
                  <Typography variant="body2">
                    Could not load the submission.
                  </Typography>
                )}
                {loadState === "done" && !submission && (
                  <Typography variant="body2">This team has not submitted yet.</Typography>
                )}
                {submission && (
                  <>
                    {submission.ideaName && (
                      <Typography variant="body1">{submission.ideaName}</Typography>
                    )}
                    {submission.targetIndustry && (
                      <Chip
                        label={submission.targetIndustry}
                        size="small"
                        variant="outlined"
                        sx={{ alignSelf: "flex-start" }}
                      />
                    )}
                    {submission.problemStatement && (
                      <Typography variant="body2">{submission.problemStatement}</Typography>
                    )}
                    {submission.pitchDeckURL && (
                      <Link
                        href={submission.pitchDeckURL}
                        target="_blank"
                        rel="noreferrer"
                        variant="body2"
                      >
                        {submission.pitchDeckName || "Pitch deck"}
                      </Link>
                    )}
                  </>
                )}
              </Stack>
            </Collapse>
          </Box>
        )}

        <Button
          fullWidth
          variant={disabled || pending ? "outlined" : "contained"}
          disabled={disabled || pending}
          onClick={(e) => {
            if (!disabled && !pending) onButtonClick({ teamId, teamName, room, time, event: e });
          }}
          sx={{ mt: "auto" }}
        >
          {buttonLabel}
        </Button>
      </CardContent>
    </Card>
  );
}

export default ScheduleCard;
