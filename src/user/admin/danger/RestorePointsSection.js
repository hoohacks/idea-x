import { useEffect, useState } from "react";
import {
  Alert, Box, Button, Card, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, Stack, Typography,
} from "@mui/material";
import { ref, get } from "firebase/database";
import { database } from "../../../firebase.js";
import {
  subscribeToSnapshots, restoreSnapshot, captureSnapshot, previewSnapshot, readJudgeNames,
  JUDGING_PATHS,
} from "../snapshots";
import { ConfirmDialog, Section } from "../adminUi.js";
import { diffSnapshot } from "./snapshotDiff";

/**
 * The way back from a bulk mistake.
 *
 * The activity feed can undo a field edit, because the before-state fits in the
 * log entry. It cannot undo a regeneration or a full wipe: past
 * UNDO_SIZE_CAP the entry keeps counts only. Restore points hold those
 * before-states out of line, so the size of the event stops deciding whether a
 * mistake is recoverable.
 *
 * One is taken automatically before every bulk action. The button here is for
 * the other case -- taking one deliberately, before doing something manual and
 * risky.
 */
function bytes(value) {
  if (!Number.isFinite(value)) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Date as well as time, unlike the activity feed.
 *
 * The feed is read during the event, where everything happened today and the
 * hour is enough. A restore point can be the one taken before last year's
 * schedule, so the day matters.
 */
function when(value) {
  if (!Number.isFinite(value)) return "";
  return new Date(value).toLocaleString();
}

/** `{ teamId: { name } }`, parsed from the snapshot's own "teams" entry. */
function teamNamesFrom(entries) {
  const teamsEntry = entries.find((entry) => entry.path === "teams");
  if (!teamsEntry) return {};
  let parsed;
  try {
    parsed = JSON.parse(teamsEntry.value);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  return Object.fromEntries(
    Object.entries(parsed).map(([teamId, team]) => [teamId, team?.name || teamId])
  );
}

function pathLine({ path, added, changed, removed }) {
  return `${path}: ${added} added, ${changed} changed, ${removed} removed`;
}

/**
 * "<n> score card(s) will be destroyed: <team> by <judge>, ..." or null.
 *
 * A `round` on an entry means the same team+judge pair lost more than one
 * card -- the bare "scores" path lets that happen (a first-round judge not
 * excluded from that team in the final, scored in both). Without the round
 * in the line, two distinct destroyed cards for "Aurora by Judge Smith"
 * would render as the same text twice, reading as a duplicate or a single
 * card rather than the two that are actually going.
 */
function lostScoresLine(lostScores, teamNames, judgeNames) {
  if (!lostScores.length) return null;
  const who = lostScores
    .map(({ teamId, judgeUid, round }) => {
      const named = `${teamNames[teamId] ?? teamId} by ${judgeNames[judgeUid] ?? judgeUid}`;
      return round ? `${named} (${round})` : named;
    })
    .join(", ");
  return `${lostScores.length} score card${lostScores.length === 1 ? "" : "s"} will be destroyed: ${who}`;
}

export default function RestorePointsSection({ onResult }) {
  const [points, setPoints] = useState([]);
  const [busy, setBusy] = useState(false);

  // the point currently open in the preview dialog, or null
  const [previewing, setPreviewing] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [diff, setDiff] = useState(null);
  const [teamNames, setTeamNames] = useState({});
  const [judgeNames, setJudgeNames] = useState({});
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  // The typed-confirmation phrase, same rule as SchedulePreview's publish
  // confirmation: config/eventName when it is set, a short count otherwise --
  // NEVER the restore point's own label. A label like "Manual restore point —
  // 9/2/2026, 4:17:00 PM" cannot be retyped on a phone by someone who is
  // already dealing with something having gone wrong.
  const [eventName, setEventName] = useState(null);

  // live, so a restore point taken by the danger zone or by a generation shows
  // up here without a reload
  useEffect(() => subscribeToSnapshots(setPoints), []);

  // Reads the snapshot's payload and the live values for its paths, so the
  // dialog can show what a restore would actually change before anyone
  // commits to it. Judge names are a one-shot read issued here rather than a
  // subscription kept open in Control.js -- a permanently open /judges
  // listener is the wrong price for a dialog almost nobody opens. If that
  // read fails, the fallback below (`judgeNames[uid] ?? uid`) renders the uid
  // instead -- naming who loses a score is a nicety, not the reason this
  // dialog exists, so its failure must not keep the dialog from opening.
  useEffect(() => {
    if (!previewing) return undefined;
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    setDiff(null);
    setTeamNames({});
    setJudgeNames({});
    setEventName(null);

    (async () => {
      const [snap, judges, eventNameSnap] = await Promise.all([
        previewSnapshot(previewing.id),
        readJudgeNames(),
        get(ref(database, "config/eventName")).catch(() => null),
      ]);
      if (cancelled) return;

      setJudgeNames(judges.names ?? {});
      setEventName(eventNameSnap && eventNameSnap.exists() ? eventNameSnap.val() : null);

      if (!snap.ok) {
        setPreviewError(snap.error || "Could not read that restore point.");
        setPreviewLoading(false);
        return;
      }

      setTeamNames(teamNamesFrom(snap.entries));
      setDiff(diffSnapshot(snap.entries, snap.live));
      setPreviewLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [previewing]);

  const closePreview = () => {
    setPreviewing(null);
    setConfirmingRestore(false);
  };

  const take = async () => {
    setBusy(true);
    try {
      const result = await captureSnapshot({
        label: `Manual restore point — ${new Date().toLocaleString()}`,
        reason: "taken by hand from the control panel",
        paths: JUDGING_PATHS,
      });
      onResult(result, "Restore point saved");
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    const target = previewing;
    const confirmedDiff = diff;
    setBusy(true);
    try {
      // The diff on screen was computed once, when Preview was opened, and
      // Preview can sit open for as long as it takes to talk a decision over.
      // A judge who files a card in that window is invisible to that diff --
      // so before the destructive write actually happens, look again. If
      // what this restore point would destroy has moved since the organizer
      // read the warning and confirmed it, that confirmation does not cover
      // the new set: refuse, and show the organizer the real numbers instead
      // of quietly destroying something that appeared in no warning they saw.
      const recheck = await previewSnapshot(target.id);
      if (!recheck.ok) {
        setConfirmingRestore(false);
        onResult(
          {
            ok: false,
            error:
              recheck.error ||
              "Could not check that restore point again before restoring, so nothing was changed.",
          },
          null
        );
        return;
      }

      const freshDiff = diffSnapshot(recheck.entries, recheck.live);
      if (JSON.stringify(freshDiff) !== JSON.stringify(confirmedDiff)) {
        setConfirmingRestore(false);
        setDiff(freshDiff);
        setTeamNames(teamNamesFrom(recheck.entries));
        onResult(
          {
            ok: false,
            error:
              "What this restore point would destroy has changed since you opened this preview " +
              "-- probably a score came in. The numbers below are now current. Check them again " +
              "before confirming.",
          },
          null
        );
        return;
      }

      closePreview();
      const result = await restoreSnapshot(target.id);
      onResult(
        result,
        `Restored ${result.restored ?? 0} path(s). The state from before this restore was saved as a new point.`
      );
    } finally {
      setBusy(false);
    }
  };

  const lostLine = diff ? lostScoresLine(diff.lostScores, teamNames, judgeNames) : null;
  const consequences = diff
    ? [
        ...diff.byPath.map(pathLine),
        "The current state is saved as a new restore point first, so this is reversible.",
        ...(lostLine ? [lostLine] : []),
      ]
    : [];
  // Same rule as SchedulePreview's publish confirmation: the configured event
  // name if there is one, otherwise a short count -- the number of paths this
  // restore touches, always available the moment the diff loads. Never the
  // restore point's own label: a locale timestamp is exactly the phrase
  // nobody can retype on autopilot, on the one path used when something has
  // already gone wrong.
  const confirmPhrase = eventName || String(diff?.byPath?.length ?? 0);

  return (
    <Section
      title="Restore points"
      note="One is taken automatically before the schedule is generated, before the final round is
            activated, and before anything in the danger zone. Restoring also saves the current
            state first, so you can undo an undo."
      action={
        <Button variant="outlined" onClick={take} disabled={busy}>
          {busy ? "Working…" : "Take a restore point now"}
        </Button>
      }
    >
      <Card sx={{ p: 2.5 }}>
        <Stack spacing={2}>
          {points.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              None yet. One appears here the first time a schedule is generated.
            </Typography>
          ) : (
            <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>
              {points.map((point) => (
                <Stack
                  key={point.id}
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1}
                  alignItems={{ sm: "center" }}
                  justifyContent="space-between"
                  sx={{ py: 1.25 }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {point.label ?? point.id}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="div">
                      {when(point.at)} · {point.byName ?? point.by} · {bytes(point.bytes)}
                    </Typography>
                    <Stack direction="row" sx={{ mt: 0.5, flexWrap: "wrap", gap: 0.5 }}>
                      {(point.paths ?? []).map((path) => (
                        <Chip key={path} label={path} size="small" variant="outlined" />
                      ))}
                    </Stack>
                  </Box>
                  <Button
                    size="small"
                    color="warning"
                    variant="outlined"
                    disabled={busy}
                    onClick={() => setPreviewing(point)}
                    sx={{ flexShrink: 0 }}
                  >
                    Preview
                  </Button>
                </Stack>
              ))}
            </Stack>
          )}
        </Stack>
      </Card>

      <Dialog open={Boolean(previewing)} onClose={closePreview} fullWidth maxWidth="sm">
        <DialogTitle>Preview “{previewing?.label ?? previewing?.id}”</DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            {previewLoading && (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
                <CircularProgress size={18} />
                <Typography variant="body2">Comparing against the live data…</Typography>
              </Stack>
            )}

            {!previewLoading && previewError && <Alert severity="error">{previewError}</Alert>}

            {!previewLoading && diff && (
              <Stack spacing={1.5} sx={{ py: 1 }}>
                <Typography variant="body2">
                  Restoring replaces every path below with the values held in this restore point.
                  Anything written since then — including scores judges have submitted in the
                  meantime — is overwritten.
                </Typography>
                <Stack spacing={0.5}>
                  {diff.byPath.map((p) => (
                    <Typography key={p.path} variant="body2">
                      <strong>{p.path}</strong> — {p.added} added, {p.changed} changed,{" "}
                      {p.removed} removed
                    </Typography>
                  ))}
                </Stack>
                {lostLine && <Alert severity="warning">{lostLine}</Alert>}
              </Stack>
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={closePreview}>Close</Button>
          <Button
            color="warning"
            variant="contained"
            disabled={previewLoading || Boolean(previewError)}
            onClick={() => setConfirmingRestore(true)}
          >
            Restore…
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmingRestore}
        title={`Restore “${previewing?.label ?? previewing?.id}”?`}
        consequences={consequences}
        typeToConfirm={confirmPhrase}
        confirmLabel="Restore"
        onConfirm={restore}
        onCancel={() => setConfirmingRestore(false)}
      />
    </Section>
  );
}
