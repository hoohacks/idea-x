import { useEffect, useState } from "react";
import { Box, Card, Typography } from "@mui/material";
import { onValue, ref } from "firebase/database";
import { PiFilePdf, PiFileText, PiLink, PiYoutubeLogo } from "react-icons/pi";
import { database } from "../firebase";
import { resourceKind, resourcesOpen, visibleResources } from "../resources";

const ICONS = { video: PiYoutubeLogo, pdf: PiFilePdf, doc: PiFileText, link: PiLink };

/**
 * The links organizers post for the day, on the home page.
 *
 * Shown from the start of the event to the end of that day, or whenever
 * organizers switch "Show now". Subscribed, so a link posted at lunch appears
 * without a reload. Renders nothing when there is nothing to show.
 */
export default function ResourcesSection({ userTypes, eventStart }) {
  const [all, setAll] = useState({});
  const [showNow, setShowNow] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    // rules not yet published, or signed out mid-subscription: show nothing
    const unsubscribeResources = onValue(
      ref(database, "resources"),
      (snapshot) => setAll(snapshot.val() ?? {}),
      () => setAll({})
    );
    const unsubscribeShowNow = onValue(
      ref(database, "config/resourcesShowNow"),
      (snapshot) => setShowNow(snapshot.val() === true),
      () => setShowNow(false)
    );
    return () => {
      unsubscribeResources();
      unsubscribeShowNow();
    };
  }, []);

  // the window opens and closes on the clock; a minute is fine-grained enough
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const shown = visibleResources(all, userTypes);
  if (!resourcesOpen(eventStart, now, showNow) || !shown.length) return null;

  return (
    <Box component="section" aria-labelledby="resources-heading">
      <Typography id="resources-heading" variant="h3" component="h2" sx={{ mb: 1.5 }}>
        Resources
      </Typography>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "repeat(2, minmax(0, 1fr))" },
          gap: 2,
        }}
      >
        {shown.map((resource) => {
          const Icon = ICONS[resourceKind(resource.url)];
          return (
            <Card
              key={resource.id}
              component="a"
              href={resource.url}
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                display: "flex",
                alignItems: "flex-start",
                gap: 2,
                p: { xs: 2, sm: 2.5 },
                color: "inherit",
                textDecoration: "none",
                "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
              }}
            >
              <Box
                aria-hidden
                sx={{
                  flexShrink: 0,
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  bgcolor: "background.default",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 22,
                  color: "text.primary",
                }}
              >
                <Icon />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="h5" sx={{ overflowWrap: "anywhere" }}>
                  {resource.title}
                  <Box component="span" sx={visuallyHidden}>
                    {" "}
                    (opens in a new tab)
                  </Box>
                </Typography>
                {resource.description && (
                  <Typography variant="body2" sx={{ mt: 0.25, overflowWrap: "anywhere" }}>
                    {resource.description}
                  </Typography>
                )}
              </Box>
            </Card>
          );
        })}
      </Box>
    </Box>
  );
}

const visuallyHidden = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};
