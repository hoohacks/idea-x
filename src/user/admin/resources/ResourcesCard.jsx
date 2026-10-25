import { useEffect, useState } from "react";
import {
  Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, IconButton, Stack, Switch, TextField, Typography
} from "@mui/material";
import { onValue, ref } from "firebase/database";
import { PiArrowDown, PiArrowUp } from "react-icons/pi";
import { database } from "../../../firebase";
import { ConfirmDialog } from "../adminUi";
import { EVENT_START, formatEventTime } from "../../../eventInfo";
import {
  MAX_RESOURCE_DESCRIPTION, MAX_RESOURCE_TITLE, isResourceUrl, resourcesOpen, sortedResources
} from "../../../resources";
import { addResource, deleteResource, moveResource, setResourcesShowNow, updateResource } from "./resourcesService";

const EMPTY = { title: "", url: "", description: "", forJudges: false };

/** Whether the fields are good enough to save, so the button can say so. */
const valid = (fields) =>
  fields.title.trim().length > 0 &&
  fields.title.trim().length <= MAX_RESOURCE_TITLE &&
  isResourceUrl(fields.url) &&
  fields.description.trim().length <= MAX_RESOURCE_DESCRIPTION;

/** What gets saved: the same four fields, trimmed. */
const trimmed = (fields) => ({
  title: fields.title.trim(),
  url: fields.url.trim(),
  description: fields.description.trim(),
  forJudges: fields.forJudges,
});

/** The same four inputs for adding a link and for editing one. */
function ResourceFields({ fields, onChange }) {
  const set = (name) => (event) => onChange({ ...fields, [name]: event.target.value });
  const badUrl = fields.url.trim() !== "" && !isResourceUrl(fields.url);

  return (
    <Stack spacing={1.5}>
      <TextField
        label="Title"
        placeholder="Judging rubric"
        value={fields.title}
        onChange={set("title")}
        fullWidth
        error={fields.title.trim().length > MAX_RESOURCE_TITLE}
        helperText={`${fields.title.trim().length} / ${MAX_RESOURCE_TITLE}`}
      />
      <TextField
        label="Link"
        placeholder="https://"
        value={fields.url}
        onChange={set("url")}
        fullWidth
        error={badUrl}
        helperText={badUrl ? "Use a full link that starts with https://" : " "}
        slotProps={{ htmlInput: { inputMode: "url", autoCapitalize: "none", autoCorrect: "off" } }}
      />
      <TextField
        label="Description (optional)"
        value={fields.description}
        onChange={set("description")}
        fullWidth
        error={fields.description.trim().length > MAX_RESOURCE_DESCRIPTION}
        helperText={`${fields.description.trim().length} / ${MAX_RESOURCE_DESCRIPTION}`}
      />
      <FormControlLabel
        control={
          <Switch checked={fields.forJudges} onChange={(event) => onChange({ ...fields, forJudges: event.target.checked })} />
        }
        label="Also show to judges"
      />
    </Stack>
  );
}

/**
 * Where organizers post the links the day runs on: the rubric, a video on
 * pitching. Competitors see them on their home page during the event; judges
 * only see the ones marked for them.
 */
export default function ResourcesCard() {
  const [all, setAll] = useState({});
  const [showNow, setShowNow] = useState(null);
  const [eventStart, setEventStart] = useState(EVENT_START);
  const [fields, setFields] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [editError, setEditError] = useState(null);

  useEffect(() => {
    const stop = [
      onValue(ref(database, "resources"), (s) => setAll(s.val() ?? {}), () => setAll({})),
      // kept as stored, null included, so the log's before-state is what was there
      onValue(ref(database, "config/resourcesShowNow"), (s) => setShowNow(s.val())),
      onValue(ref(database, "config/eventStart"), (s) => setEventStart(s.val() || EVENT_START)),
    ];
    return () => stop.forEach((fn) => fn());
  }, []);

  const resources = sortedResources(all);
  const open = resourcesOpen(eventStart, new Date(), showNow === true);

  const run = async (work, success) => {
    setBusy(true);
    setResult(null);
    try {
      const outcome = await work();
      const failed = outcome?.ok === false;
      setResult(failed ? { severity: "error", text: outcome.error } : success ? { severity: "success", text: success } : null);
      return !failed;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (await run(() => addResource(trimmed(fields), resources), "Added.")) setFields(EMPTY);
  };

  const saveEdit = async () => {
    const { id, ...before } = editing.before;
    setBusy(true);
    setEditError(null);
    try {
      const outcome = await updateResource(id, before, trimmed(editing.fields));
      if (outcome?.ok === false) setEditError(outcome.error);
      else setEditing(null);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (resource) => {
    setEditError(null);
    setEditing({
      before: resource,
      fields: {
        title: resource.title,
        url: resource.url,
        description: resource.description ?? "",
        forJudges: resource.forJudges === true,
      },
    });
  };

  const confirmRemove = async () => {
    const { id, ...before } = removing;
    setRemoving(null);
    await run(() => deleteResource(id, before), "Deleted.");
  };

  return (
    <Card>
      <CardContent sx={{ p: 2.5, "&:last-child": { pb: 2.5 } }}>
        <Typography variant="h5" component="h2">Resources</Typography>
        <Typography variant="body2" sx={{ mt: 0.5, maxWidth: "65ch" }}>
          Links competitors see on their home page during the event. Judges only see the ones marked for judges.
        </Typography>

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ mt: 1.5, justifyContent: "space-between", alignItems: { sm: "center" } }}>
          <Typography variant="body2" sx={{ color: "text.primary" }}>
            {open
              ? "Visible now"
              : `Shown to competitors from ${formatEventTime(eventStart)} until the end of the day`}
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={showNow === true}
                disabled={busy}
                onChange={(event) => run(() => setResourcesShowNow(showNow, event.target.checked))}
              />
            }
            label="Show now"
            sx={{ mr: 0 }}
          />
        </Stack>

        <Box sx={{ mt: 2 }}>
          <ResourceFields fields={fields} onChange={setFields} />
          <Button variant="contained" onClick={add} disabled={busy || !valid(fields)} sx={{ mt: 1 }}>
            Add resource
          </Button>
        </Box>
        {result && <Alert severity={result.severity} sx={{ mt: 1.5 }}>{result.text}</Alert>}

        <Box sx={{ mt: 2.5 }}>
          {resources.length === 0 ? (
            <Typography variant="body2">No resources yet. Add one above and it shows up here.</Typography>
          ) : (
            <Stack spacing={1}>
              {resources.map((resource, index) => (
                <Stack
                  key={resource.id}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "flex-start", p: 1.5, borderRadius: 2, bgcolor: "background.default" }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", columnGap: 1, rowGap: 0.5 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: "text.primary", overflowWrap: "anywhere" }}>
                        {resource.title}
                      </Typography>
                      {resource.forJudges === true && <Chip size="small" label="Judges too" />}
                    </Stack>
                    <Typography variant="caption" component="p" noWrap>
                      {resource.url}
                    </Typography>
                    {resource.description && (
                      <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                        {resource.description}
                      </Typography>
                    )}
                    <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                      <Button size="small" disabled={busy} onClick={() => startEdit(resource)}>Edit</Button>
                      <Button size="small" color="error" disabled={busy} onClick={() => setRemoving(resource)}>Delete</Button>
                    </Stack>
                  </Box>
                  <Stack direction="row" sx={{ flexShrink: 0 }}>
                    <IconButton
                      size="small"
                      aria-label={`Move ${resource.title} up`}
                      disabled={busy || index === 0}
                      onClick={() => run(() => moveResource(resources, index, -1))}
                    >
                      <PiArrowUp aria-hidden />
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label={`Move ${resource.title} down`}
                      disabled={busy || index === resources.length - 1}
                      onClick={() => run(() => moveResource(resources, index, 1))}
                    >
                      <PiArrowDown aria-hidden />
                    </IconButton>
                  </Stack>
                </Stack>
              ))}
            </Stack>
          )}
        </Box>
      </CardContent>

      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} fullWidth maxWidth="sm">
        <DialogTitle>Edit resource</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            {editing && (
              <ResourceFields fields={editing.fields} onChange={(next) => setEditing({ ...editing, fields: next })} />
            )}
            {editError && <Alert severity="error">{editError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>Cancel</Button>
          <Button variant="contained" onClick={saveEdit} disabled={busy || !editing || !valid(editing.fields)}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(removing)}
        title="Delete this resource?"
        consequences={[`"${removing?.title ?? ""}" disappears from every home page.`]}
        confirmLabel="Delete"
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </Card>
  );
}
