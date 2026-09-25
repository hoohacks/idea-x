import { Box, Button, Link, Stack, Typography } from "@mui/material";
import { EVENT } from "./eventInfo";
import { Hero, PublicShell } from "./registrationUi";

/**
 * What the public sees before registration opens.
 *
 * The site goes live weeks before the event does, so for most of its life the
 * honest thing for it to say is "not yet". This says when, and where to go in
 * the meantime, rather than presenting a form that would not work or a page
 * that looks broken.
 *
 * It is deliberately the same shell as the forms it replaces: somebody who
 * comes back on the day should recognise the page, not wonder whether they are
 * on the right site.
 */
export default function ClosedNotice({ what = "Registration" }) {
  return (
    <PublicShell>
      <Hero
        eyebrow={`${EVENT.name} ${EVENT.year}`}
        title={`${what} is not open yet`}
        facts={[EVENT.dateLabel, EVENT.hours, EVENT.venue]}
      >
        Sign-ups have not started. This page will become the form when they do —
        there is nothing to do here until then, and nothing has gone wrong.
      </Hero>

      <Box sx={{ pb: 8 }}>
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
          <Button variant="contained" href={EVENT.siteUrl}>
            About the event
          </Button>
        </Stack>

        <Typography variant="body2" sx={{ mt: 3 }}>
          Organizers can <Link href="#/login?staff">sign in</Link>.
        </Typography>
      </Box>
    </PublicShell>
  );
}
