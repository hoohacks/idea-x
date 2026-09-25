import { createTheme } from "@mui/material/styles";

/**
 * One theme for the whole app.
 *
 * White chrome, warm-cream surfaces that recede, one saturated red for the
 * action to take, and a shape vocabulary of exactly three radii -- 16px for
 * buttons, fields and cards, 32px for dialogs, and a full pill for chips and
 * avatars.
 *
 * **The red is the logo's crimson.** It sits above every button on the site,
 * so any other red beside it reads as a mistake.
 *
 * **State keeps its colours.** This is an operations tool whose whole job on
 * the day is telling an organizer which team has no scores: error is an
 * oxblood, success a deep green on pale green, caution an amber.
 *
 * **Figures are tabular.** No monospace -- one family everywhere -- but Inter's
 * tabular figures keep a column of times or scores lined up. That is the
 * `data` variant.
 */

// Brand. Sampled from the logo: every crimson pixel in it is exactly this.
// Reserved for the primary action, the active tab, and the wordmark.
const BRAND = "#d62749";
const BRAND_DARK = "#b41f3c";
const BRAND_WASH = "#fdf0f3";

// Text, darkest to lightest.
const INK = "#000000";
const INK_HOVER = "#262622";
const BODY_TEXT = "#33332e";
const MUTED = "#62625b";
const ASH = "#91918c";

// Surfaces and rules.
const SURFACE = "#ffffff";
const CANVAS = "#ffffff";
const SURFACE_SOFT = "#fbfbf9";
const SURFACE_CARD = "#f6f6f3";
const SECONDARY_BG = "#e5e5e0";
const SECONDARY_PRESSED = "#c8c8c1";
const LINE = "#e5e5e0";
const LINE_STRONG = "#dadad3";

// State.
const DANGER = "#9e0a0a";
const DANGER_PALE = "#fbe9e9";
const CAUTION = "#8a4f06";
const CAUTION_PALE = "#fdf0dc";
const GOOD = "#103c25";
const GOOD_PALE = "#c7f0da";

const FOCUS = "#435ee5";

// Dark. Only the camera scanner still sits on a dark ground, where a light page
// around a live viewfinder would glare.
const NIGHT = "#262622";
const NIGHT_RAISED = "#33332e";
const NIGHT_LINE = "#4a4a44";
const ON_NIGHT = "#ffffff";
const ON_NIGHT_MUTED = "rgba(255,255,255,0.7)";

const BODY =
  '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
// kept as a name for anything that asked for "the data face"; it is the same
// family now, and `data` switches on tabular figures instead
const MONO = BODY;

const RADIUS = 16;
const RADIUS_LG = 32;

// kept so anything that referenced the old roles still resolves
const DISPLAY = BODY;
const ACCENT = BRAND;
const ACCENT_DARK = BRAND_DARK;
const ACCENT_WASH = BRAND_WASH;

const theme = createTheme({
  palette: {
    primary: { main: BRAND, dark: BRAND_DARK, contrastText: "#fff" },
    secondary: { main: INK, dark: INK_HOVER, contrastText: "#fff" },
    error: { main: DANGER, light: DANGER_PALE },
    warning: { main: CAUTION, light: CAUTION_PALE },
    success: { main: GOOD, light: GOOD_PALE },
    info: { main: INK, light: SURFACE_CARD },
    background: { default: CANVAS, paper: SURFACE },
    text: { primary: INK, secondary: MUTED, disabled: ASH },
    divider: LINE,
    action: { hover: SURFACE_CARD, selected: SECONDARY_BG, disabledBackground: SURFACE_CARD, disabled: ASH },
  },

  // MUI multiplies this; 8 keeps `borderRadius: 2` meaning 16px in an sx
  shape: { borderRadius: 8 },

  typography: {
    fontFamily: BODY,

    // Tight tracking on the large sizes is part of the voice.
    h1: { color: INK, fontSize: "1.75rem", fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1.2 },
    h2: { color: INK, fontSize: "1.375rem", fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.25 },
    h3: { color: INK, fontSize: "1.125rem", fontWeight: 600, lineHeight: 1.3 },
    h4: { color: INK, fontSize: "1rem", fontWeight: 600, lineHeight: 1.4 },
    h5: { color: INK, fontSize: "1rem", fontWeight: 600, lineHeight: 1.4 },
    h6: { color: INK, fontSize: "0.875rem", fontWeight: 700, lineHeight: 1.4 },

    body1: { fontSize: "1rem", lineHeight: 1.4, color: BODY_TEXT },
    body2: { fontSize: "0.875rem", lineHeight: 1.4, color: MUTED },
    caption: { fontSize: "0.75rem", lineHeight: 1.5, fontWeight: 500, color: MUTED },
    button: { textTransform: "none", fontWeight: 700, letterSpacing: 0, fontSize: "0.875rem" },

    // A small section label. Sentence case, in the body face.
    overline: {
      fontSize: "0.875rem",
      fontWeight: 700,
      letterSpacing: 0,
      textTransform: "none",
      lineHeight: 1.4,
      color: INK,
    },

    /**
     * The heading on a block of settings: smaller than a page title, larger
     * than a label. Mapped to `<h2>`, because these are the top-level divisions
     * of a page whose title is the h1.
     */
    sectionTitle: {
      color: INK,
      fontSize: "1.125rem",
      fontWeight: 600,
      lineHeight: 1.3,
    },

    /**
     * Operational data: a time, a room, a slot, a score, a count.
     *
     * Tabular figures so a column of them lines up and a changed digit does
     * not shift the ones beside it. `<Typography variant="data">`, or
     * `theme.typography.data` spread into an sx.
     */
    data: {
      fontFamily: BODY,
      fontSize: "0.875rem",
      fontWeight: 600,
      fontVariantNumeric: "tabular-nums",
      fontFeatureSettings: '"tnum" 1',
    },
  },

  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: CANVAS, color: BODY_TEXT },
        // The system's focus signal: a blue ring with a white gap, the same on
        // every interactive element whatever the browser's default.
        ":focus-visible": { outline: `2px solid ${FOCUS}`, outlineOffset: 2 },
      },
    },

    MuiTypography: {
      defaultProps: { variantMapping: { data: "span", sectionTitle: "h2" } },
    },

    MuiButton: {
      defaultProps: { disableElevation: true, disableRipple: true },
      styleOverrides: {
        root: {
          paddingInline: 16,
          minHeight: 40,
          borderRadius: RADIUS,
          "&.Mui-disabled": { backgroundColor: SURFACE_CARD, color: ASH, borderColor: "transparent" },
        },
        containedPrimary: {
          "&:hover": { backgroundColor: BRAND_DARK },
          "&:active": { backgroundColor: BRAND_DARK },
        },
        containedSecondary: {
          "&:hover": { backgroundColor: INK_HOVER },
        },
        // No outlined buttons in this system: "outlined" is the grey-cream
        // secondary button, so every existing call site gets it for free.
        outlined: {
          backgroundColor: SECONDARY_BG,
          border: "1px solid transparent",
          color: INK,
          "&:hover": { backgroundColor: SECONDARY_PRESSED, border: "1px solid transparent" },
        },
        outlinedPrimary: { color: INK },
        text: {
          color: INK,
          "&:hover": { backgroundColor: SURFACE_CARD },
        },
        textPrimary: { color: INK },
        sizeSmall: { minHeight: 32, paddingInline: 12, fontSize: "0.8125rem", borderRadius: RADIUS },
        sizeLarge: { minHeight: 48, fontSize: "1rem", paddingInline: 20 },
      },
    },

    MuiIconButton: {
      styleOverrides: {
        root: { "&:hover": { backgroundColor: SURFACE_CARD } },
      },
    },

    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { backgroundImage: "none" },
        rounded: { borderRadius: RADIUS },
        outlined: { borderColor: LINE },
      },
    },
    // Cards sit flat on a warm-cream fill: no border, no shadow.
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { backgroundColor: SURFACE_CARD, border: "none", borderRadius: RADIUS },
      },
    },

    MuiTextField: {
      // Labels sit above the field. Besides reading more cleanly, it sidesteps
      // Chrome autofilling a value before React sees a change event, which left
      // a floating label sitting on top of it.
      defaultProps: { size: "small", InputLabelProps: { shrink: true } },
    },
    // displayEmpty so a filter whose "Any" option has the value "" shows that
    // label; without it MUI renders "" as a blank box that looks broken.
    MuiSelect: { defaultProps: { size: "small", displayEmpty: true } },
    MuiFormControl: { defaultProps: { size: "small" } },
    MuiInputLabel: {
      defaultProps: { shrink: true },
      styleOverrides: {
        root: { fontWeight: 600, color: INK, "&.Mui-focused": { color: INK } },
        // Out of the field's border and onto its own line above it.
        outlined: {
          "&.MuiInputLabel-shrink": {
            position: "relative",
            transform: "none",
            marginBottom: 6,
            fontSize: "0.875rem",
            lineHeight: 1.4,
            maxWidth: "100%",
          },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: SURFACE,
          borderRadius: RADIUS,
          "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: MUTED },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: INK, borderWidth: 2 },
          "&.Mui-focused": { boxShadow: `0 0 0 3px ${SURFACE}, 0 0 0 5px ${FOCUS}` },
          "&.Mui-error .MuiOutlinedInput-notchedOutline": { borderColor: DANGER },
        },
        input: { paddingBlock: 11, paddingInline: 15 },
        inputSizeSmall: { paddingBlock: 10, paddingInline: 14 },
        // the label lives above the field, so the border has no gap to leave
        notchedOutline: {
          borderColor: ASH,
          top: 0,
          "& legend": { display: "none" },
        },
      },
    },
    /**
     * 16px fields on a phone, whatever the density is elsewhere. iOS Safari
     * zooms in on any field under 16px and does not zoom back out.
     */
    MuiInputBase: {
      styleOverrides: {
        root: { fontSize: "1rem", color: INK },
        input: { "&::placeholder": { color: ASH, opacity: 1 } },
      },
    },

    MuiFormHelperText: { styleOverrides: { root: { marginLeft: 2, color: MUTED } } },

    MuiCheckbox: {
      styleOverrides: { root: { color: ASH, "&.Mui-checked": { color: INK } } },
    },
    MuiRadio: {
      styleOverrides: { root: { color: ASH, "&.Mui-checked": { color: INK } } },
    },
    MuiSwitch: {
      styleOverrides: {
        switchBase: { "&.Mui-checked": { color: SURFACE }, "&.Mui-checked + .MuiSwitch-track": { backgroundColor: INK, opacity: 1 } },
      },
    },

    // White, with a hairline under it. See siteNav for the bar's contents.
    MuiAppBar: {
      defaultProps: { elevation: 0, color: "inherit" },
      styleOverrides: {
        root: { backgroundColor: SURFACE, color: INK, borderBottom: `1px solid ${LINE}` },
      },
    },

    MuiLink: {
      defaultProps: { underline: "hover" },
      styleOverrides: { root: { color: INK, fontWeight: 600 } },
    },

    // The one place with depth: a card over a 50% scrim.
    MuiDialog: {
      defaultProps: { maxWidth: "xs", fullWidth: true },
      styleOverrides: {
        paper: {
          borderRadius: RADIUS_LG,
          padding: 8,
          boxShadow: "0 0 16px rgba(0,0,0,0.12)",
        },
      },
    },
    MuiBackdrop: {
      styleOverrides: {
        root: { "&:not(.MuiBackdrop-invisible)": { backgroundColor: "rgba(0,0,0,0.5)" } },
      },
    },
    MuiDialogTitle: {
      styleOverrides: {
        root: { fontSize: "1.375rem", fontWeight: 600, lineHeight: 1.25, color: INK },
      },
    },
    MuiDrawer: {
      styleOverrides: { paper: { borderRadius: 0 } },
    },
    MuiMenu: {
      styleOverrides: {
        paper: { borderRadius: RADIUS, boxShadow: "0 0 16px rgba(0,0,0,0.12)", border: "none" },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          marginInline: 6,
          fontSize: "0.9375rem",
          "&.Mui-selected": { backgroundColor: SURFACE_CARD, fontWeight: 600 },
          "&.Mui-selected:hover": { backgroundColor: SECONDARY_BG },
        },
      },
    },

    // Filled and soft rather than outlined: the state colour is in the tint.
    MuiAlert: {
      defaultProps: { variant: "standard" },
      styleOverrides: {
        root: { alignItems: "center", borderRadius: RADIUS, fontSize: "0.875rem" },
        standardError: { backgroundColor: DANGER_PALE, color: DANGER, "& .MuiAlert-icon": { color: DANGER } },
        standardWarning: { backgroundColor: CAUTION_PALE, color: CAUTION, "& .MuiAlert-icon": { color: CAUTION } },
        standardSuccess: { backgroundColor: GOOD_PALE, color: GOOD, "& .MuiAlert-icon": { color: GOOD } },
        standardInfo: { backgroundColor: SURFACE_CARD, color: INK, "& .MuiAlert-icon": { color: INK } },
        // outlined alerts still exist at a few call sites; they get the same look
        outlinedError: { backgroundColor: DANGER_PALE, color: DANGER, border: "none" },
        outlinedWarning: { backgroundColor: CAUTION_PALE, color: CAUTION, border: "none" },
        outlinedSuccess: { backgroundColor: GOOD_PALE, color: GOOD, border: "none" },
        outlinedInfo: { backgroundColor: SURFACE_CARD, color: INK, border: "none" },
        message: { fontSize: "0.875rem" },
      },
    },

    // Pills. Outlined chips are drawn as the filled secondary tint too; a
    // state colour becomes a pale fill with dark text.
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 700,
          borderRadius: 999,
          "&.MuiChip-outlined": { border: "none" },
          "&.MuiChip-colorDefault": { backgroundColor: SECONDARY_BG, color: INK },
          "&.MuiChip-colorPrimary.MuiChip-filled": { backgroundColor: BRAND, color: "#fff" },
          "&.MuiChip-colorPrimary.MuiChip-outlined": { backgroundColor: BRAND_WASH, color: BRAND_DARK },
          "&.MuiChip-colorSecondary": { backgroundColor: INK, color: "#fff" },
          "&.MuiChip-colorSuccess": { backgroundColor: GOOD_PALE, color: GOOD },
          "&.MuiChip-colorError": { backgroundColor: DANGER_PALE, color: DANGER },
          "&.MuiChip-colorWarning": { backgroundColor: CAUTION_PALE, color: CAUTION },
        },
        sizeSmall: { height: 24, fontSize: "0.75rem" },
        labelSmall: { paddingInline: 10 },
      },
    },

    MuiTab: {
      defaultProps: { disableRipple: true },
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 600,
          minHeight: 44,
          fontSize: "0.9375rem",
          color: MUTED,
          "&.Mui-selected": { color: INK },
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 44 },
        indicator: { height: 3, borderRadius: 3 },
      },
    },

    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: 999, backgroundColor: SECONDARY_BG },
        bar: { borderRadius: 999 },
      },
    },

    MuiAccordion: {
      defaultProps: { elevation: 0, disableGutters: true },
      styleOverrides: {
        root: {
          backgroundColor: "transparent",
          "&::before": { display: "none" },
        },
      },
    },

    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: LINE, fontSize: "0.875rem" },
        head: { fontWeight: 700, color: INK, fontSize: "0.875rem" },
      },
    },

    MuiTooltip: {
      styleOverrides: {
        tooltip: { backgroundColor: INK, fontSize: "0.75rem", fontWeight: 500, padding: "6px 10px", borderRadius: 8 },
      },
    },

    MuiAvatar: {
      styleOverrides: { root: { fontWeight: 700 } },
    },
  },
});

/**
 * The judge and mentor form once carried its own accent. Under one brand red it
 * is the same theme; kept as an export so the form does not have to change.
 */
export const judgeTheme = theme;

export const tokens = {
  BRAND,
  BRAND_DARK,
  BRAND_WASH,
  DANGER,
  DANGER_PALE,
  CAUTION,
  CAUTION_PALE,
  GOOD,
  GOOD_PALE,
  FOCUS,
  INK,
  INK_HOVER,
  BODY_TEXT,
  MUTED,
  ASH,
  LINE,
  LINE_STRONG,
  SURFACE,
  SURFACE_SOFT,
  SURFACE_CARD,
  SECONDARY_BG,
  SECONDARY_PRESSED,
  CANVAS,
  NIGHT,
  NIGHT_RAISED,
  NIGHT_LINE,
  ON_NIGHT,
  ON_NIGHT_MUTED,
  BODY,
  MONO,
  RADIUS,
  RADIUS_LG,
  // previous names, so anything that referenced them still resolves
  ACCENT,
  ACCENT_DARK,
  ACCENT_WASH,
  DISPLAY,
};

/**
 * A page frame's minimum height, in a unit a phone agrees with.
 *
 * `100vh` on iOS is the height the viewport would have if the address bar were
 * hidden, so a frame set to it is always taller than the screen actually shows.
 * `dvh` is the height that is really visible; `vh` stays as the fallback.
 */
export const pageMinHeight = {
  minHeight: "100vh",
  "@supports (min-height: 100dvh)": { minHeight: "100dvh" },
};

export default theme;
