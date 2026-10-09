import { Box, Grid, Skeleton, Stack } from "@mui/material";

/**
 * Placeholders in the shape of what is about to arrive.
 *
 * A line of "Loading…" text told people nothing about what was coming and then
 * shoved the page down when it did. These hold the space the real content will
 * take, so the page does not jump when it lands. The label is for screen
 * readers; sighted people see the shapes.
 *
 * The shimmer is a transition, so reduced motion (index.css) stills it.
 */

const bone = { bgcolor: "action.selected", borderRadius: 2 };

/** A page title, its subtitle, and a few cards under them. */
export function PageSkeleton({ label = "Loading", cards = 3 }) {
    return (
        <Box role="status" aria-label={label}>
            <Skeleton variant="rounded" width={220} height={34} sx={bone} />
            <Skeleton variant="rounded" width={320} height={18} sx={{ ...bone, mt: 1.25 }} />
            <Stack spacing={2} sx={{ mt: 3 }}>
                {Array.from({ length: cards }, (_, i) => (
                    <Skeleton key={i} variant="rounded" height={112} sx={{ ...bone, borderRadius: 4 }} />
                ))}
            </Stack>
        </Box>
    );
}

/** A grid of cards, as the judge's list of teams to score. */
export function CardGridSkeleton({ label = "Loading", count = 3 }) {
    return (
        <Grid container spacing={2} role="status" aria-label={label}>
            {Array.from({ length: count }, (_, i) => (
                <Grid item xs={12} sm={6} md={4} key={i}>
                    <Skeleton variant="rounded" height={180} sx={{ ...bone, borderRadius: 4 }} />
                </Grid>
            ))}
        </Grid>
    );
}

/** A few lines of text, for a panel or a section still being read. */
export function LinesSkeleton({ label = "Loading", lines = 3 }) {
    return (
        <Stack spacing={1} role="status" aria-label={label}>
            {Array.from({ length: lines }, (_, i) => (
                <Skeleton key={i} variant="rounded" height={16} width={i === lines - 1 ? "60%" : "100%"} sx={bone} />
            ))}
        </Stack>
    );
}
