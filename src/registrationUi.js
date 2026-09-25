import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import Nav from "./siteNav";
import PageFooter from "./siteFooter";
import { pageMinHeight } from "./theme";

/**
 * The frame both public registration pages sit in.
 *
 * The old pages centred one 620px card on an otherwise empty screen and ran
 * thirteen fields down it in a single column, which gave no sense of how long
 * the form was or how close you were to the end. The form now runs in a
 * readable column beside a rail that answers exactly that question.
 */

/**
 * Date, hours and venue, separated by hairlines rather than middots.
 *
 * The hairline is a left border on every fact but the first, which is correct
 * only while they are all on one line. On a phone they are not: the strip wraps,
 * and whichever fact starts the second line carried its border with it -- a
 * divider hanging at the start of a line with nothing before it, on the first
 * page every attendee sees.
 *
 * A border cannot know it is at the start of a line, so below `sm` the facts
 * stack instead and the hairlines go away entirely. From `sm` up there is room
 * for one line and the strip reads as designed.
 */
export function FactStrip({ facts }) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      sx={{ flexWrap: "wrap", rowGap: { xs: 0.75, sm: 1 }, mt: 2.5 }}
    >
      {facts.map((fact, index) => (
        <Typography
          key={fact}
          variant="body2"
          sx={{
            pl: { xs: 0, sm: index === 0 ? 0 : 1.75 },
            pr: { xs: 0, sm: 1.75 },
            borderLeft: { xs: 0, sm: index === 0 ? 0 : 1 },
            borderColor: "divider",
            fontVariantNumeric: "tabular-nums",
            color: "text.primary",
            fontWeight: 500,
          }}
        >
          {fact}
        </Typography>
      ))}
    </Stack>
  );
}

export function Hero({ eyebrow, title, facts, children }) {
  return (
    <Box sx={{ pt: { xs: 5, md: 7 }, pb: { xs: 3, md: 4 } }}>
      <Typography variant="overline" component="p">
        {eyebrow}
      </Typography>
      <Typography
        variant="h1"
        sx={{
          mt: 0.5,
          maxWidth: "18ch",
          fontSize: { xs: "2.25rem", sm: "3rem", md: "3.5rem" },
          letterSpacing: "-0.035em",
          lineHeight: 1.02,
        }}
      >
        {title}
      </Typography>
      {facts && <FactStrip facts={facts} />}
      {children && (
        <Typography
          variant="body1"
          sx={{ mt: 2.5, maxWidth: "62ch", color: "text.secondary" }}
        >
          {children}
        </Typography>
      )}
    </Box>
  );
}

/* --------------------------------------------------------------- section -- */

export function Section({ id, label, children }) {
  return (
    <Box component="section" aria-labelledby={`${id}-heading`} sx={{ scrollMarginTop: 72 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2.5 }}>
        <Typography id={`${id}-heading`} variant="overline" component="h2">
          {label}
        </Typography>
        <Box sx={{ flex: 1, height: "1px", bgcolor: "divider" }} />
      </Stack>
      <Stack spacing={2.5}>{children}</Stack>
    </Box>
  );
}

/**
 * A field whose prompt is a full sentence. Putting that sentence in the
 * floating label truncated it; putting it in a sibling Typography carrying the
 * same id as the input, as the old form did, produced two elements sharing one
 * id and a label pointing at itself.
 */
export function Question({ htmlFor, prompt, hint, children }) {
  return (
    <Box>
      <Typography
        component="label"
        htmlFor={htmlFor}
        variant="h5"
        sx={{ display: "block", mb: hint ? 0.5 : 1.25 }}
      >
        {prompt}
      </Typography>
      {hint && (
        <Typography variant="body2" sx={{ mb: 1.25 }}>
          {hint}
        </Typography>
      )}
      {children}
    </Box>
  );
}

/* ------------------------------------------------------------------ rail -- */

function countLabel(remaining) {
  if (remaining <= 0) return "Everything is answered";
  return `${remaining} ${remaining === 1 ? "answer" : "answers"} left`;
}

/**
 * The signature of both pages, and the direct answer to the fault that started
 * this: a form that refused to submit without saying which of thirteen fields
 * it was unhappy about.
 *
 * One tick per required answer rather than a percentage bar, because "two
 * more" is actionable and "84%" is not. It fills as you go, including when the
 * browser fills the fields for you.
 */
export function ProgressMeter({ answered, total }) {
  return (
    <Stack direction="row" sx={{ gap: "3px", flexWrap: "wrap", mb: 1.25 }} aria-hidden="true">
      {Array.from({ length: total }, (_, index) => (
        <Box
          key={index}
          sx={{
            width: 12,
            height: 6,
            borderRadius: 3,
            bgcolor: index < answered ? "primary.main" : "#d3d8e0",
            transition: "background-color 160ms ease",
          }}
        />
      ))}
    </Stack>
  );
}

function RailChecklist({ sections }) {
  return (
    <Stack sx={{ mb: 2 }}>
      {sections.map((section) => (
        <Stack
          key={section.id}
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{ py: 0.75, borderTop: 1, borderColor: "divider" }}
        >
          <Typography
            variant="body2"
            sx={{ flex: 1, color: section.remaining ? "text.primary" : "text.secondary" }}
          >
            {section.label}
          </Typography>
          <Typography
            variant="body2"
            sx={{
              fontVariantNumeric: "tabular-nums",
              color: section.remaining ? "primary.main" : "success.main",
              fontWeight: 550,
            }}
          >
            {section.remaining ? `${section.remaining} left` : "Done"}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

export function SubmitRail({
  sections,
  answered,
  total,
  error,
  busy,
  submitLabel,
  busyLabel,
  footer,
}) {
  return (
    <Box sx={{ position: "sticky", top: 80 }}>
      <Card>
        <CardContent sx={{ p: 2.5, "&:last-child": { pb: 2.5 } }}>
          <Typography variant="overline" component="h2" sx={{ display: "block", mb: 1.25 }}>
            Before you submit
          </Typography>

          <ProgressMeter answered={answered} total={total} />
          <Typography
            sx={{ fontWeight: 600, mb: 1.75, fontVariantNumeric: "tabular-nums" }}
            aria-live="polite"
          >
            {countLabel(total - answered)}
          </Typography>

          <RailChecklist sections={sections} />

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Button type="submit" variant="contained" size="large" fullWidth disabled={busy}>
            {busy ? busyLabel : submitLabel}
          </Button>

          {footer && (
            <Typography variant="body2" align="center" sx={{ mt: 1.5 }}>
              {footer}
            </Typography>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}

/** Below md the rail collapses to this, pinned to the bottom of the viewport. */
export function MobileSubmitBar({ answered, total, error, busy, submitLabel, busyLabel }) {
  return (
    <Box
      sx={{
        display: { xs: "block", md: "none" },
        position: "sticky",
        bottom: 0,
        zIndex: 2,
        mt: 4,
        p: 2,
        bgcolor: "background.paper",
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        boxShadow: "0 -2px 12px rgba(20, 23, 31, 0.06)",
      }}
    >
      {error && (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {error}
        </Alert>
      )}
      <ProgressMeter answered={answered} total={total} />
      <Stack direction="row" alignItems="center" spacing={1.5}>
        <Typography variant="body2" sx={{ flex: 1 }} aria-live="polite">
          {countLabel(total - answered)}
        </Typography>
        <Button type="submit" variant="contained" disabled={busy}>
          {busy ? busyLabel : submitLabel}
        </Button>
      </Stack>
    </Box>
  );
}

/* ---------------------------------------------------------------- dialog -- */

export function ResultDialog({ open, title, children, actions, onClose }) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography variant="body1">{children}</Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>{actions}</DialogActions>
    </Dialog>
  );
}

/* ----------------------------------------------------------------- shell -- */

/**
 * Every signed-out page: the two registration forms, sign in, and the password
 * reset. They share the bar and the footer so that arriving from the marketing
 * site looks the same whichever one you land on.
 */
export function PublicShell({ children, maxWidth = "lg", pad = false }) {
  return (
    <Box
      sx={{
        ...pageMinHeight,
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.default",
      }}
    >
      <Nav variant="public" />
      <Container
        maxWidth={maxWidth}
        component="main"
        sx={{
          flex: 1,
          /*
           * Room for the submit bar, which is pinned to the bottom of the
           * viewport on a phone.
           *
           * Focusing a field makes the browser scroll it just barely into view,
           * and "just barely" means underneath a bar that is sitting over the
           * last 86 pixels of the screen -- so tapping Password put the cursor
           * somewhere the person could not see, right as the keyboard opened.
           * scroll-margin is what that scroll is told to leave clear.
           */
          "& input, & textarea": { scrollMarginBottom: 120 },
          ...(pad ? { py: { xs: 5, sm: 8 } } : null),
        }}
      >
        {children}
      </Container>
      <PageFooter maxWidth={maxWidth} />
    </Box>
  );
}

export function RegistrationShell({ hero, children }) {
  return (
    <PublicShell>
      {hero}
      {children}
    </PublicShell>
  );
}
