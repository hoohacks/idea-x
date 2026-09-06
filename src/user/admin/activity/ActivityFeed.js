import { useState } from "react";
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Button, Chip, Stack, Typography,
} from "@mui/material";
import { IoChevronDown } from "react-icons/io5";
import { RowList, Row } from "../adminUi";
import { decodeChanges, undoAdminAction } from "../adminAction";
import { describeChange } from "./describeChange";

/**
 * What has been changed, newest first.
 *
 * Realtime Database keeps no history of its own, so without this an overwrite
 * is indistinguishable from the value having always been that way. It is not
 * tamper-proof -- admins hold root write and deletes skip validation -- so treat
 * it as a way to answer "what did we change at 4:52", not as a ledger.
 */
export default function ActivityFeed({ log, onResult }) {
  const [busyId, setBusyId] = useState(null);

  const undo = async (entry) => {
    setBusyId(entry.id);
    try {
      onResult(await undoAdminAction(entry.id), `Undid: ${entry.summary}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section>
      <Typography variant="h2" sx={{ fontSize: "1.1rem", mb: 1 }}>Recent activity</Typography>

      <Alert severity="info" sx={{ mb: 2 }}>
        The last 100 changes made from this panel. An undo restores the recorded value
        and refuses if anything has moved since.
      </Alert>

      <RowList empty="Nothing has been changed from this panel yet.">
        {log.map((entry) => {
          const changes = entry.changes ? decodeChanges(entry.changes) : [];
          const when = entry.at
            ? new Date(entry.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
            : "";

          return (
            <Row key={entry.id}>
              <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ md: "flex-start" }}>
                <Stack sx={{ flex: 1, minWidth: 0 }}>
                  <Stack sx={{ gap: 1 }} direction="row" alignItems="baseline" flexWrap="wrap">
                    <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
                      {when}
                    </Typography>
                    <Typography sx={{ fontWeight: 600 }}>{entry.byName ?? entry.by}</Typography>
                    <Chip size="small" variant="outlined" label={entry.action} />
                    {entry.undone && <Chip size="small" label="undone" />}
                  </Stack>

                  <Typography variant="body2">{entry.summary}</Typography>

                  {changes.length > 0 && (
                    <Accordion
                      disableGutters
                      elevation={0}
                      sx={{ "&:before": { display: "none" }, bgcolor: "transparent" }}
                    >
                      <AccordionSummary expandIcon={<IoChevronDown />} sx={{ px: 0, minHeight: 36 }}>
                        <Typography variant="body2">
                          {changes.length} path{changes.length === 1 ? "" : "s"}
                        </Typography>
                      </AccordionSummary>
                      <AccordionDetails sx={{ px: 0, pt: 0 }}>
                        <Stack spacing={0.25}>
                          {changes.map((change) => (
                            <Typography
                              key={change.path}
                              variant="body2"
                              sx={{ fontFamily: "monospace", fontSize: "0.78rem" }}
                            >
                              {describeChange(change)}
                            </Typography>
                          ))}
                        </Stack>
                      </AccordionDetails>
                    </Accordion>
                  )}
                </Stack>

                <Button
                  size="small"
                  variant="outlined"
                  disabled={busyId === entry.id || entry.undoable === false || Boolean(entry.undone)}
                  onClick={() => undo(entry)}
                  title={entry.undoable === false ? "Too large to record in full" : undefined}
                  sx={{ minWidth: 80 }}
                >
                  {busyId === entry.id ? "Undoing…" : "Undo"}
                </Button>
              </Stack>
            </Row>
          );
        })}
      </RowList>
    </section>
  );
}
