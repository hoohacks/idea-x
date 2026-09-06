import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { IoInformationCircleOutline } from "react-icons/io5";
import { RUBRIC, SCORE_MAX_TOTAL, NOTES_MAX_LENGTH } from "./scoreRubric";
import { loadDraft, saveDraft } from "./scoreDraft";

const CRITERIA = Object.keys(RUBRIC);

/**
 * Nothing is pre-selected. The form used to open on 5/5/5/3/3/Yes, which meant
 * an untouched card was a complete, submittable score — a mis-tap filed a
 * middling score for a team nobody had watched, indistinguishable afterwards
 * from a real one. An unfilled criterion now blocks submission instead.
 */
const EMPTY = {
  ...Object.fromEntries(CRITERIA.map((field) => [field, ""])),
  fundable: "",
  notes: "",
};

function Criterion({ field, spec, value, onChange }) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="space-between">
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
        <Typography variant="body1">{spec.label}</Typography>
        <Tooltip title={spec.desc} enterTouchDelay={0}>
          <Box
            component="span"
            sx={{ display: "flex", color: "text.secondary", cursor: "help", fontSize: "1rem" }}
          >
            <IoInformationCircleOutline />
          </Box>
        </Tooltip>
      </Stack>

      <TextField
        select
        name={field}
        value={value}
        onChange={onChange}
        sx={{ width: 104 }}
        // the maximum sits under the field, so a 5-point criterion cannot be
        // mistaken for a 10-point one at a glance
        helperText={`of ${spec.range}`}
        FormHelperTextProps={{ sx: { textAlign: "right", mr: 0 } }}
      >
        {Array.from({ length: spec.range }, (_, i) => String(i + 1)).map((n) => (
          <MenuItem key={n} value={n}>
            {n}
          </MenuItem>
        ))}
      </TextField>
    </Stack>
  );
}

function ScoreSubmission({
  teamName = "Team",
  room = "TBD",
  time = "TBD",
  submitting = false,
  // { round, teamId, judgeUid } — identifies the draft. Omitted in tests.
  draftTarget = null,
  // true when this judge has already filed a card for this team
  isOverwrite = false,
  onClose = () => {},
  onSubmit = () => {},
}) {
  const [values, setValues] = useState(EMPTY);
  const [restored, setRestored] = useState(false);

  // Restoring has to happen before the first save, or the effect below writes
  // the empty form over a draft the judge is about to get back.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const draft = draftTarget ? loadDraft(draftTarget) : null;
    if (draft) {
      setValues({ ...EMPTY, ...draft });
      setRestored(true);
    }
  }, [draftTarget]);

  // Persist on every change. The dialog is unmounted on close, so without this
  // a cancel, a refresh or a dead battery loses everything typed.
  useEffect(() => {
    if (!hydrated.current || !draftTarget) return;
    if (values === EMPTY) return;
    saveDraft(draftTarget, values);
  }, [values, draftTarget]);

  const [busy, setBusy] = useState(false);
  const inFlight = submitting || busy;

  const missing = useMemo(
    () => CRITERIA.filter((field) => values[field] === "").length + (values.fundable === "" ? 1 : 0),
    [values]
  );

  const runningTotal = CRITERIA.reduce((sum, field) => sum + Number(values[field] || 0), 0);

  function handleChange(e) {
    const { name, value } = e.target;
    setValues((v) => ({ ...v, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    // the write is async, so without this guard a double click writes twice
    if (inFlight || missing) return;

    const score = {
      ...Object.fromEntries(CRITERIA.map((field) => [field, Number(values[field])])),
      fundable: values.fundable === "yes",
      notes: values.notes,
      teamName,
      room,
      time,
    };

    setBusy(true);
    try {
      await onSubmit(score);
    } finally {
      // if the parent failed it keeps the dialog open, so re-enable the button
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={inFlight ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h3" component="div">
          {teamName}
        </Typography>
        <Stack direction="row" spacing={0.75} sx={{ mt: 1 }}>
          <Chip label={time} size="small" variant="outlined" />
          <Chip label={room} size="small" variant="outlined" />
        </Stack>
      </DialogTitle>

      {/*
        The form has to be a flex column, not a plain wrapper.

        Dialog lays its paper out as a column and expects DialogContent to be
        the flex child that scrolls. Putting a form between them made the
        sections stack at their natural height instead, so on a phone the whole
        rubric ran past the bottom of the card and left "Submit score" hanging
        outside it, over the page behind -- on the one screen a judge uses
        standing in a room. `minHeight: 0` is the half that does the work: it
        lets this shrink below its content so DialogContent can scroll.
      */}
      <Box
        component="form"
        onSubmit={handleSubmit}
        sx={{ display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 }}
      >
        <DialogContent dividers sx={{ py: 2 }}>
          <Stack spacing={1.75}>
            {restored && (
              <Alert severity="info" sx={{ py: 0.25 }}>
                Picked up where you left off on this device.
              </Alert>
            )}
            {isOverwrite && (
              <Alert severity="warning" sx={{ py: 0.25 }}>
                You have already scored this team. Submitting replaces that score.
              </Alert>
            )}

            {Object.entries(RUBRIC).map(([field, spec]) => (
              <Criterion
                key={field}
                field={field}
                spec={spec}
                value={values[field]}
                onChange={handleChange}
              />
            ))}

            <Divider />

            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="body1">Worth funding?</Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={values.fundable}
                onChange={(_, next) => next && setValues((v) => ({ ...v, fundable: next }))}
              >
                <ToggleButton value="yes" sx={{ px: 2 }}>
                  Yes
                </ToggleButton>
                <ToggleButton value="no" sx={{ px: 2 }}>
                  No
                </ToggleButton>
              </ToggleButtonGroup>
            </Stack>

            <TextField
              name="notes"
              label="Notes (optional)"
              value={values.notes}
              onChange={handleChange}
              multiline
              minRows={2}
              fullWidth
              // the rules reject anything longer, so stop the judge at the
              // limit rather than losing the card on submit
              inputProps={{ maxLength: NOTES_MAX_LENGTH }}
            />
          </Stack>
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2, gap: 1, flexWrap: "wrap", justifyContent: "space-between" }}>
          <Typography variant="body2">
            {missing ? `${missing} left to fill in` : `Total ${runningTotal} / ${SCORE_MAX_TOTAL}`}
          </Typography>
          {/* ml:auto keeps the pair on the right when the row wraps on a phone */}
          <Stack direction="row" spacing={1} sx={{ ml: "auto" }}>
            <Button onClick={onClose} disabled={inFlight} variant="outlined">
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={inFlight || missing > 0}>
              {inFlight ? "Submitting…" : "Submit score"}
            </Button>
          </Stack>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

export default ScoreSubmission;
