import { useEffect, useState } from "react";
import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from "@mui/material";
import { onValue, ref } from "firebase/database";
import { database } from "../../../firebase";
import { FilterChips } from "../adminUi";
import { formatEventTime } from "../../../eventInfo";
import { AUDIENCES, MAX_ANNOUNCEMENT_LENGTH, audienceLabel } from "../../../announcements";
import { postAnnouncement, takeDownAnnouncement } from "./announcementsService";

/**
 * Where organizers tell the room something on the day. What is posted appears
 * at the top of every signed-in page for the people picked, live, until it is
 * taken down here.
 */
export default function AnnouncementsCard() {
  const [all, setAll] = useState({});
  const [text, setText] = useState("");
  const [audience, setAudience] = useState("everyone");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => onValue(ref(database, "announcements"), (s) => setAll(s.val() ?? {}), () => setAll({})), []);

  const live = Object.entries(all)
    .map(([id, announcement]) => ({ id, ...announcement }))
    .filter((announcement) => announcement.active === true)
    .sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0));

  const run = async (work, success) => {
    setBusy(true);
    setResult(null);
    try {
      const outcome = await work();
      setResult(outcome.ok ? { severity: "success", text: success } : { severity: "error", text: outcome.error });
      return outcome.ok;
    } finally {
      setBusy(false);
    }
  };

  const post = async () => {
    if (await run(() => postAnnouncement({ text, audience }), `Posted to ${audienceLabel(audience).toLowerCase()}.`)) {
      setText("");
    }
  };

  const tooLong = text.trim().length > MAX_ANNOUNCEMENT_LENGTH;

  return (
    <Card>
      <CardContent sx={{ p: 2.5, "&:last-child": { pb: 2.5 } }}>
        <Typography variant="h5" component="h2">Announcements</Typography>
        <Typography variant="body2" sx={{ mt: 0.5, maxWidth: "65ch" }}>
          Shows at the top of every page for the people you pick, straight away, until you take it down.
        </Typography>

        <Stack spacing={1.5} sx={{ mt: 2 }}>
          <TextField
            label="Announcement"
            placeholder="Lunch is in the atrium until 1:00 PM."
            value={text}
            onChange={(event) => setText(event.target.value)}
            multiline
            minRows={2}
            fullWidth
            error={tooLong}
            helperText={`${text.trim().length} / ${MAX_ANNOUNCEMENT_LENGTH}`}
          />
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            justifyContent="space-between"
            alignItems={{ sm: "center" }}
          >
            <FilterChips
              label="Send to"
              value={audience}
              onChange={setAudience}
              options={AUDIENCES}
            />
            <Button
              variant="contained"
              onClick={post}
              disabled={busy || !text.trim() || tooLong}
              sx={{ flexShrink: 0 }}
            >
              Post announcement
            </Button>
          </Stack>
          {result && <Alert severity={result.severity}>{result.text}</Alert>}
        </Stack>

        {live.length > 0 && (
          <Box sx={{ mt: 2.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, color: "text.primary", mb: 1 }}>
              Showing now
            </Typography>
            <Stack spacing={1}>
              {live.map((announcement) => (
                <Stack
                  key={announcement.id}
                  direction="row"
                  spacing={1.5}
                  alignItems="flex-start"
                  sx={{ p: 1.5, borderRadius: 2, bgcolor: "background.default" }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ color: "text.primary", whiteSpace: "pre-line", overflowWrap: "anywhere" }}>
                      {announcement.text}
                    </Typography>
                    <Typography variant="caption" component="p">
                      {audienceLabel(announcement.audience)}
                      {announcement.postedAt ? `, posted ${formatEventTime(announcement.postedAt)}` : ""}
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={busy}
                    onClick={() => run(() => takeDownAnnouncement(announcement.id, announcement.text), "Taken down.")}
                    sx={{ flexShrink: 0 }}
                  >
                    Take down
                  </Button>
                </Stack>
              ))}
            </Stack>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
