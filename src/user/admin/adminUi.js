import { useEffect, useState } from "react";
import {
    Accordion, AccordionDetails, AccordionSummary,
    Alert, Box, Button, Card, Dialog, DialogActions, DialogContent, DialogContentText,
    DialogTitle, Divider, LinearProgress, Stack, TextField, Typography,
} from "@mui/material";
import { IoChevronDown } from "react-icons/io5";

/**
 * Shared furniture for the three admin dashboards. They used to each carry
 * their own copy of a page title, a stats line, a progress bar and a filter
 * row, all sized with inline styles that had drifted apart.
 */

/**
 * Size a field to what goes in it.
 *
 * Every control in the panel was `flex: 1`, so a five-character time and a
 * paragraph of JSON got the same 1300px box on a laptop. A field that is ten
 * times wider than its longest possible value does not read as roomy, it reads
 * as unfinished -- and it hides the shape of what is being asked for, which on
 * a settings page is half the instruction.
 *
 * Named by content rather than by measurement, so a caller picks the meaning
 * and the number stays a decision made here.
 */
export const FIELD = {
    count: 92,      // 1-12
    time: 132,      // "5:00 PM"
    datetime: 232,  // "09/09/2026 02:27 PM" plus the picker button
    name: 280,      // a room, a team
    key: 320,       // a config key or a value
};

/**
 * The count strip under a page title, and under a preview that has its own.
 *
 * `singular` is not decoration: "1 admins" and "1 rooms" were on screen
 * whenever an event had one of something, which is most of them before the day
 * starts. One page had already fixed it inline for its own label, which is how
 * a rule ends up applied once out of six times.
 */
export function StatStrip({ stats = [], sx }) {
    if (stats.length === 0) return null;

    return (
        <Stack direction="row" sx={{ gap: 2.5, flexWrap: "wrap", rowGap: 1, ...sx }}>
            {stats.map(({ label, singular, value }) => (
                <Stack key={label} direction="row" spacing={0.75} alignItems="baseline">
                    {/* the numbers an organizer reads off the screen and acts on,
                        so they are set as data rather than as prose */}
                    <Typography variant="data" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                        {value}
                    </Typography>
                    <Typography variant="body2">
                        {singular && value === 1 ? singular : label}
                    </Typography>
                </Stack>
            ))}
        </Stack>
    );
}

export function PageHeader({ title, stats = [], progress, children }) {
    return (
        <Box sx={{ mb: 3 }}>
            <Stack
                direction={{ xs: "column", sm: "row" }}
                justifyContent="space-between"
                alignItems={{ xs: "flex-start", sm: "center" }}
                spacing={1}
            >
                <Typography variant="h1">{title}</Typography>
                {children}
            </Stack>

            <StatStrip stats={stats} sx={{ mt: 1.5 }} />

            {typeof progress === "number" && progress > 0 && (
                <LinearProgress
                    variant="determinate"
                    value={Math.min(100, Math.max(0, progress))}
                    sx={{
                        mt: 1.5,
                        height: 6,
                        borderRadius: 3,
                        bgcolor: "divider",
                        "& .MuiLinearProgress-bar": { borderRadius: 3 },
                    }}
                />
            )}
        </Box>
    );
}

/**
 * One block of the control panel: a heading, an optional line of standing
 * guidance, and the card of controls.
 *
 * Nine sections used to hand-roll this, and no two agreed. Each wrote its own
 * heading at a size the type scale does not have; some put their explanation in
 * an outlined `Alert severity="info"`, some in prose, two had no heading at all
 * because they were accordions; the gap under the heading was 8px here and
 * 16px there.
 *
 * **Guidance is not an alert.** Five bordered info boxes stacked down one page
 * is what the theme's own rule against colour-as-decoration is about: a
 * standing explanation ("these take effect next time you generate") and a live
 * warning ("no rooms are configured, so a schedule cannot be generated") were
 * drawn identically, so the one that needed acting on had no way to stand out.
 * Standing guidance is now quiet prose under the heading, and `Alert` is left
 * to mean something is true right now.
 *
 * `collapsible` is the same heading in an accordion, for the two sections that
 * should open closed. The chevron sits against the title rather than a screen
 * away at the right margin, because it belongs to the word, not to the row.
 */
export function Section({
    title, note, tone = "default", collapsible = false, defaultExpanded = false,
    action, children,
}) {
    const heading = (
        <Typography
            variant="sectionTitle"
            sx={tone === "danger" ? { color: "error.main" } : undefined}
        >
            {title}
        </Typography>
    );

    const body = (
        <>
            {note && (
                <Typography variant="body2" sx={{ mt: 0.5, maxWidth: "68ch" }}>
                    {note}
                </Typography>
            )}
            <Box sx={{ mt: note ? 2 : 1.5 }}>{children}</Box>
        </>
    );

    if (collapsible) {
        return (
            <Box component="section">
                <Accordion
                    disableGutters
                    elevation={0}
                    defaultExpanded={defaultExpanded}
                    sx={{ "&:before": { display: "none" }, bgcolor: "transparent" }}
                >
                    <AccordionSummary
                        expandIcon={<IoChevronDown />}
                        sx={{
                            px: 0,
                            minHeight: 0,
                            // AccordionSummary is a ButtonBase, and ButtonBase
                            // centres its contents. Nothing shows that while the
                            // summary content is flex-grow: 1 and fills the row --
                            // it does the moment the chevron is pulled in beside
                            // the title, which is how the heading ended up in the
                            // middle of the page.
                            justifyContent: "flex-start",
                            "& .MuiAccordionSummary-content": { flexGrow: 0, my: 1.25 },
                            "& .MuiAccordionSummary-expandIconWrapper": {
                                ml: 1,
                                color: tone === "danger" ? "error.main" : "text.secondary",
                            },
                        }}
                    >
                        {heading}
                    </AccordionSummary>
                    <AccordionDetails sx={{ px: 0, pt: 1, pb: 0 }}>{body}</AccordionDetails>
                </Accordion>
            </Box>
        );
    }

    return (
        <Box component="section">
            <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                spacing={2}
            >
                {heading}
                {action}
            </Stack>
            {body}
        </Box>
    );
}

/**
 * The settings atom: what the setting is on the left, the control that changes
 * it on the right, a hairline between one and the next.
 *
 * The panel had no such thing, so a label and the button that acts on it could
 * end up 1300px apart with nothing tying them together, and a helper sentence
 * inherited the width of the 120px number field it belonged to and wrapped into
 * a four-line column. The hint now belongs to the row, not to the input.
 */
export function SettingList({ children }) {
    const items = Array.isArray(children) ? children.filter(Boolean) : children;
    return <Stack divider={<Divider />}>{items}</Stack>;
}

export function SettingRow({ label, hint, children }) {
    return (
        <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={{ xs: 1, sm: 3 }}
            alignItems={{ sm: "flex-start" }}
            justifyContent="space-between"
            sx={{ py: 2, "&:first-of-type": { pt: 0 }, "&:last-of-type": { pb: 0 } }}
        >
            {/*
              A floor on the label and a ceiling on nothing.

              The control side used to be `flexShrink: 0` while the label was
              `minWidth: 0`, so every pixel of overflow came out of the label:
              raise the batch count to nine and the times ran off the right edge
              of the card while "Batch times" was squeezed into a column one
              word wide. Both halves now give -- the label down to a readable
              floor, the controls by wrapping onto another line.
            */}
            <Box sx={{ flex: "1 1 auto", minWidth: { sm: 200 }, maxWidth: "58ch", pt: { sm: 0.75 } }}>
                <Typography variant="body2" sx={{ fontWeight: 600, color: "text.primary" }}>
                    {label}
                </Typography>
                {hint && (
                    <Typography variant="caption" component="p" sx={{ mt: 0.25 }}>
                        {hint}
                    </Typography>
                )}
            </Box>

            <Stack
                direction="row"
                alignItems="flex-start"
                sx={{
                    flex: "0 1 auto",
                    minWidth: 0,
                    flexWrap: "wrap",
                    // wrapped rows stay against the right edge, so the column
                    // reads as one block however many lines it takes
                    justifyContent: { sm: "flex-end" },
                    gap: 1,
                }}
            >
                {children}
            </Stack>
        </Stack>
    );
}

export function FilterBar({ children }) {
    return (
        <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{ mb: 2 }}
        >
            {children}
        </Stack>
    );
}

export function SearchField(props) {
    return <TextField sx={{ flex: 1, minWidth: 200 }} {...props} />;
}

/** A flat list of hairline-separated rows, not a stack of 30px-padded boxes. */
export function RowList({ children, empty = "Nothing to show." }) {
    const items = Array.isArray(children) ? children.filter(Boolean) : children;
    const isEmpty = Array.isArray(items) ? items.length === 0 : !items;

    if (isEmpty) {
        return (
            <Card sx={{ p: 3 }}>
                <Typography variant="body2" align="center">
                    {empty}
                </Typography>
            </Card>
        );
    }

    return (
        <Card>
            <Box
                sx={{
                    /*
                      `borderColor` is the four-sided shorthand, and it was
                      repainting each row's left edge as well as drawing the rule
                      under it. A flagged row -- a team with no scores, a judge
                      who has not checked in -- therefore had its crimson accent
                      overwritten in divider grey on every row but the last one
                      in the list, which is the only row this rule skips. The
                      signal was on screen the whole time and visible almost
                      nowhere. Only the bottom edge belongs to the separator.
                    */
                    "& > *:not(:last-child)": {
                        borderBottom: "1px solid",
                        borderBottomColor: "divider",
                    },
                }}
            >
                {items}
            </Box>
        </Card>
    );
}

/**
 * A row in a `RowList`, optionally flagged.
 *
 * `accent` means **this row still needs something doing to it**: a team with no
 * scores, a judge who has not checked in, a team that has not submitted. Four
 * dashboards used it and two of them had it the other way round, flagging the
 * rows that were already settled -- which, on an event that is going well, is
 * every row. Since the bar was invisible almost everywhere (see `RowList`),
 * nothing made the contradiction obvious.
 */
export function Row({ children, accent = false }) {
    return (
        <Box
            sx={{
                // the accent replaces padding rather than adding to it, so a
                // flagged row's content stays on the same left edge as the rest
                pl: accent ? "14px" : 2,
                pr: 2,
                py: 1.5,
                borderLeft: accent ? "2px solid" : 0,
                borderLeftColor: "primary.main",
            }}
        >
            {children}
        </Box>
    );
}

/**
 * The shared destructive-action dialog. `window.confirm` gets dismissed by
 * reflex, so this spells out what will happen in an `Alert`, and for the
 * worst actions makes the confirm button unusable until the caller's phrase
 * — usually the event name, not "DELETE" — is typed exactly.
 *
 * The typed value always resets when `open` goes false, so cancelling and
 * reopening never leaves the button enabled from a stale value.
 */
export function ConfirmDialog({
    open, title, consequences = [], typeToConfirm, confirmLabel, onConfirm, onCancel,
}) {
    const [typed, setTyped] = useState("");

    useEffect(() => {
        if (!open) setTyped("");
    }, [open]);

    const requiresPhrase = typeof typeToConfirm === "string" && typeToConfirm.length > 0;
    const canConfirm = !requiresPhrase || typed === typeToConfirm;

    return (
        <Dialog open={open} onClose={onCancel}>
            <DialogTitle>{title}</DialogTitle>
            <DialogContent>
                <DialogContentText component="div">
                    {consequences.length > 0 && (
                        <Alert severity="warning" sx={{ my: 1 }}>
                            <Stack spacing={0.5}>
                                {consequences.map((consequence) => (
                                    <Typography key={consequence} variant="body2">
                                        {consequence}
                                    </Typography>
                                ))}
                            </Stack>
                        </Alert>
                    )}
                    {requiresPhrase && (
                        <TextField
                            fullWidth
                            size="small"
                            sx={{ mt: 2 }}
                            label={`Type "${typeToConfirm}" to confirm`}
                            value={typed}
                            onChange={(event) => setTyped(event.target.value)}
                        />
                    )}
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                <Button onClick={onCancel}>Cancel</Button>
                <Button color="error" variant="contained" disabled={!canConfirm} onClick={onConfirm}>
                    {confirmLabel}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
