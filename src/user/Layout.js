import { Box, Container } from "@mui/material";
import Nav, { RAIL_WIDTH, TAB_BAR_HEIGHT } from "../siteNav";
import PageFooter from "../siteFooter";
import { pageMinHeight } from "../theme";

/**
 * Page frame for the signed-in portal. The old version pinned main to a fixed
 * 800px, which left the admin tables cramped on a laptop and the short forms
 * adrift on a wide screen. Pages now pick their own width via `maxWidth`.
 *
 * `bleed` is for the one page that wants the whole viewport: the check-in
 * scanner runs edge to edge and dark.
 */
function Layout({ children, maxWidth = "md", bleed = false }) {
    return (
        <Box
            sx={{
                ...pageMinHeight,
                display: "flex",
                flexDirection: "column",
                bgcolor: "background.default",
                // clear of the rail on a laptop, and of the tab bar on a phone
                // (and of the notch, now there is no top bar to sit under it)
                pl: { md: `${RAIL_WIDTH}px` },
                pt: { xs: "env(safe-area-inset-top, 0px)", md: 0 },
                pb: {
                    xs: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom, 0px))`,
                    md: 0,
                },
            }}
        >
            <Nav />
            {bleed ? (
                <Box component="main" sx={{ flex: 1, display: "flex", flexDirection: "column" }}>
                    {children}
                </Box>
            ) : (
                <Container
                    component="main"
                    maxWidth={maxWidth}
                    sx={{ flex: 1, width: "100%", py: { xs: 3, sm: 4 } }}
                >
                    {children}
                </Container>
            )}
            {/* on a phone the tab bar is the bottom of the page; a copyright
                strip sitting above it was dead space before the chrome */}
            {!bleed && (
                <Box sx={{ display: { xs: "none", md: "block" } }}>
                    <PageFooter maxWidth={maxWidth} />
                </Box>
            )}
        </Box>
    );
}

export default Layout;
