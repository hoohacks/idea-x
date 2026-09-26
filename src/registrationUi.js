import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
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
import { PiCalendarBlank, PiCheckCircle, PiClock, PiMapPin } from "react-icons/pi";

/**
 * The frame both public registration pages sit in.
 *
 * The old pages centred one 620px card on an otherwise empty screen and ran
 * thirteen fields down it in a single column, which gave no sense of how long
 * the form was or how close you were to the end. The form now runs in a
 * readable column beside a rail that answers exactly that question.
 */

const FACT_ICONS = [<PiCalendarBlank />, <PiClock />, <PiMapPin />];

/** Date, hours and venue as pills, each with its icon. */
function FactPills({ facts }) {
  return (
    <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, mt: 2.5 }}>
      {facts.map((fact, index) => (
        <Chip
          key={fact}
          icon={FACT_ICONS[index] ?? undefined}
          label={fact}
          sx={{
            height: 36,
            pl: 0.75,
            fontSize: "0.875rem",
            "& .MuiChip-icon": { fontSize: 18, color: "text.primary" },
          }}
        />
      ))}
    </Stack>
  );
}

/**
 * One photo, large, with what it shows written under it. Four tiles made the
 * hero taller than the screen and pushed the form out of sight; one picture of
 * a team holding the cheque says the same thing and leaves the form in view.
 * Hidden on a phone, where it would sit between the title and the first field.
 */
function FeaturedPhoto({ photo, caption }) {
  return (
    <Box
      component="figure"
      sx={{ m: 0, display: { xs: "none", md: "block" }, justifySelf: "end", width: "100%", maxWidth: 380 }}
    >
      <Box
        component="img"
        src={photo.src}
        alt={photo.alt}
        width={photo.width}
        height={photo.height}
        sx={{
          display: "block",
          width: "100%",
          height: "auto",
          borderRadius: 4,
          bgcolor: "action.hover",
        }}
      />
      {caption && (
        <Typography component="figcaption" variant="body2" sx={{ mt: 1, px: 0.5 }}>
          {caption}
        </Typography>
      )}
    </Box>
  );
}

/**
 * The top of a public page: what it is, when and where, and one sentence on
 * why you would come. `summary` is that sentence; the longer explanation, when
 * there is one, is `children`, set quieter under the facts.
 */
export function Hero({ eyebrow, title, facts, summary, photo, photoCaption, children }) {
  return (
    <Box sx={{ pt: { xs: 4, md: 6 }, pb: { xs: 3, md: 5 } }}>
      <Box
        sx={{
          display: "grid",
          gap: { xs: 3, md: 6 },
          alignItems: "center",
          gridTemplateColumns: { xs: "1fr", md: photo ? "1fr auto" : "1fr" },
        }}
      >
        <Box>
          {eyebrow && (
            <Typography variant="body2" component="p" sx={{ fontWeight: 600, color: "text.primary" }}>
              {eyebrow}
            </Typography>
          )}
          <Typography
            variant="h1"
            sx={{
              mt: 0.5,
              maxWidth: "16ch",
              fontSize: { xs: "2.5rem", sm: "3.5rem", md: "4.375rem" },
              letterSpacing: "-0.03em",
              lineHeight: 1.05,
            }}
          >
            {title}
          </Typography>
          {summary && (
            <Typography
              sx={{ mt: 2, maxWidth: "36ch", fontSize: { xs: "1.125rem", sm: "1.25rem" }, lineHeight: 1.4, color: "text.primary" }}
            >
              {summary}
            </Typography>
          )}
          {facts && <FactPills facts={facts} />}
          {children && (
            <Typography variant="body1" sx={{ mt: 2.5, maxWidth: "58ch", color: "text.secondary" }}>
              {children}
            </Typography>
          )}
        </Box>
        {photo && <FeaturedPhoto photo={photo} caption={photoCaption} />}
      </Box>
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
            bgcolor: index < answered ? "primary.main" : "action.selected",
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
          <Stack
            direction="row"
            alignItems="center"
            spacing={0.5}
            sx={{ color: section.remaining ? "primary.main" : "success.main" }}
          >
            {!section.remaining && <PiCheckCircle aria-hidden size={18} />}
            <Typography
              variant="body2"
              sx={{ fontVariantNumeric: "tabular-nums", color: "inherit", fontWeight: 600 }}
            >
              {section.remaining ? `${section.remaining} left` : "Done"}
            </Typography>
          </Stack>
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
        borderRadius: 2,
        boxShadow: "0 0 16px rgba(0, 0, 0, 0.12)",
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
/**
 * Photos behind a page, blurred and dimmed so a card set over them reads as
 * the one thing to look at: the way a sign-in sheet sits over a board of pins.
 * Decorative, so hidden from screen readers; the same photos are described
 * properly on the registration page.
 */
function PhotoBackdrop({ photos }) {
  return (
    <Box aria-hidden sx={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <Box
        sx={{
          position: "absolute",
          inset: -24,
          display: "grid",
          gridTemplateColumns: { xs: "repeat(2, 1fr)", md: `repeat(${photos.length}, 1fr)` },
          gap: "8px",
          filter: "blur(6px)",
        }}
      >
        {photos.map((photo) => (
          <Box
            key={photo.src}
            component="img"
            src={photo.src}
            alt=""
            sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ))}
      </Box>
      <Box sx={{ position: "absolute", inset: 0, bgcolor: "rgba(17, 17, 16, 0.55)" }} />
    </Box>
  );
}

export function PublicShell({ children, maxWidth = "lg", pad = false, backdrop = null }) {
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
      <Box sx={{ flex: 1, position: "relative", display: "flex", flexDirection: "column" }}>
        {backdrop && <PhotoBackdrop photos={backdrop} />}
        <Container
          maxWidth={maxWidth}
          component="main"
          sx={{
            flex: 1,
            position: "relative",
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
            // over photos the card is the only thing on the page, so it sits in
            // the middle of them rather than at the top with space below
            ...(backdrop ? { display: "flex", flexDirection: "column", justifyContent: "center" } : null),
          }}
        >
          {children}
        </Container>
      </Box>
      <PageFooter maxWidth={maxWidth} flush={Boolean(backdrop)} />
    </Box>
  );
}

/**
 * The card the sign-in and password pages are built on: the bulb mark, a
 * greeting, one line on what the page is for, the form, and a footer line
 * pointing at the other door.
 *
 * It is laid out the way a sign-in sheet over a board of pins is: centred,
 * generously padded, with the mark carrying the brand rather than the heading.
 * The plain "Sign in" heading over a date line it replaced said nothing the
 * button did not already say.
 *
 * It rises into place once when the page opens, which is what draws the eye
 * to it over the photos; reduced motion (index.css) stills that.
 */
export function AuthCard({ title, subtitle, footer, children }) {
  return (
    <Box
      sx={{
        bgcolor: "background.paper",
        borderRadius: 4,
        boxShadow: "0 24px 48px rgba(17, 17, 16, 0.24), 0 2px 8px rgba(17, 17, 16, 0.12)",
        px: { xs: 3, sm: 5 },
        pt: { xs: 4, sm: 5 },
        pb: { xs: 3, sm: 4 },
        "@keyframes authRise": {
          from: { opacity: 0, transform: "translateY(12px)" },
          to: { opacity: 1, transform: "none" },
        },
        animation: "authRise 360ms cubic-bezier(0.16, 1, 0.3, 1) both",
      }}
    >
      <Stack alignItems="center" sx={{ textAlign: "center" }}>
        <Box
          component="img"
          src={`${process.env.PUBLIC_URL ?? ""}/ideathon-bulb.png`}
          alt=""
          aria-hidden
          sx={{ height: 44, width: "auto", display: "block" }}
        />
        <Typography
          variant="h1"
          sx={{ mt: 2, fontSize: { xs: "1.625rem", sm: "1.75rem" }, letterSpacing: "-0.03em" }}
        >
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" sx={{ mt: 1, maxWidth: "30ch", fontSize: "0.9375rem" }}>
            {subtitle}
          </Typography>
        )}
      </Stack>

      <Box sx={{ mt: 3.5 }}>{children}</Box>

      {footer && (
        <Box sx={{ mt: 3, pt: 2.5, borderTop: 1, borderColor: "divider", textAlign: "center" }}>
          <Typography variant="body2">{footer}</Typography>
        </Box>
      )}
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
