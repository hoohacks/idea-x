import { Box, Container, Link, Typography } from "@mui/material";
import { EVENT } from "./eventInfo";

/**
 * One footer for the portal and the public forms. They used to be two near
 * copies that disagreed about whether the event name was a link.
 */
function PageFooter({ maxWidth = "lg" }) {
    return (
        <Box component="footer" sx={{ borderTop: 1, borderColor: "divider", py: 2.5, mt: 6 }}>
            <Container maxWidth={maxWidth}>
                <Typography variant="body2" align="center">
                    {"© "}
                    {EVENT.year} HooHacks{" · "}
                    <Link color="inherit" href={EVENT.siteUrl}>
                        {EVENT.name}
                    </Link>
                </Typography>
            </Container>
        </Box>
    );
}

export default PageFooter;
