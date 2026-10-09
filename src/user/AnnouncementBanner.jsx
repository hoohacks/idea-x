import { useContext, useEffect, useState } from "react";
import { Alert, Stack, Typography } from "@mui/material";
import { onValue, ref } from "firebase/database";
import { PiMegaphone } from "react-icons/pi";
import { AuthContext } from "../App";
import { database } from "../firebase";
import { formatEventTime } from "../eventInfo";
import { readDismissed, rememberDismissed, visibleAnnouncements } from "../announcements";

/**
 * Live organizer announcements, at the top of every signed-in page.
 *
 * Subscribed rather than fetched, so "Rice 340 has moved" reaches a judge who
 * has had their assignments open since lunch. Each can be dismissed, which is
 * remembered in this browser.
 */
export default function AnnouncementBanner() {
  const { userTypes } = useContext(AuthContext) ?? {};
  const [all, setAll] = useState({});
  const [dismissed, setDismissed] = useState(readDismissed);

  useEffect(
    () =>
      onValue(
        ref(database, "announcements"),
        (snapshot) => setAll(snapshot.val() ?? {}),
        // rules not yet published, or signed out mid-subscription: show nothing
        () => setAll({})
      ),
    []
  );

  const shown = visibleAnnouncements(all, userTypes, dismissed);
  if (!shown.length) return null;

  const dismiss = (id) => {
    const next = [...dismissed, id];
    setDismissed(next);
    rememberDismissed(next);
  };

  return (
    <Stack component="section" aria-label="Announcements" spacing={1} sx={{ mb: { xs: 2.5, sm: 3 } }}>
      {shown.map((announcement) => (
        <Alert
          key={announcement.id}
          severity="info"
          icon={<PiMegaphone size={20} />}
          onClose={() => dismiss(announcement.id)}
          closeText="Dismiss"
          sx={{
            alignItems: "flex-start",
            // the theme drops an alert's action under the message on a phone,
            // which suits a labelled button; a lone close icon stays beside it
            "@media (max-width: 599.95px)": {
              flexWrap: "nowrap",
              "& .MuiAlert-action": { flexBasis: "auto", ml: "auto", pl: 1, mt: -0.5 },
            },
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600, color: "text.primary", whiteSpace: "pre-line" }}>
            {announcement.text}
          </Typography>
          {announcement.postedAt && (
            <Typography variant="caption" component="p" sx={{ mt: 0.25 }}>
              Posted {formatEventTime(announcement.postedAt)}
            </Typography>
          )}
        </Alert>
      ))}
    </Stack>
  );
}
