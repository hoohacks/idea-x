import { Box, Container } from "@mui/material";
import Nav from "../siteNav";
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
            {!bleed && <PageFooter maxWidth={maxWidth} />}
        </Box>
    );
}

export default Layout;
