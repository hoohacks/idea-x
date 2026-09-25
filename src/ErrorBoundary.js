import React from "react";
import { Box, Button, Container, Stack, Typography } from "@mui/material";

/**
 * What to show when a page throws.
 *
 * React unmounts the whole tree when a render throws and nothing catches it, so
 * without this the result is a white page. That is the worst possible failure
 * mode for this app, because a blank page is also what a wrong URL looks like,
 * and what a page rendered below the fold looks like -- three different problems
 * with one symptom and no way to tell them apart from the outside.
 *
 * This does not try to recover. It says something broke, offers the two things
 * that actually help (reload, or go back to the dashboard), and shows the error
 * so it can be reported by someone who is not going to open the console.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // the console is still where the stack lives; this is for whoever is
    // looking at it afterwards
    console.error("Unhandled error while rendering:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Stack spacing={2}>
          <Typography variant="h1">Something went wrong on this page</Typography>
          <Typography variant="body1">
            Nothing you were looking at was saved or lost by this. It is a display problem. Reload
            to try again. If it keeps happening, send the message below to whoever is looking after
            the site.
          </Typography>

          <Box
            component="pre"
            sx={(t) => ({
              ...t.typography.data,
              p: 1.5,
              m: 0,
              borderRadius: 1,
              border: 1,
              borderColor: "divider",
              bgcolor: "background.default",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            })}
          >
            {String(this.state.error?.message ?? this.state.error)}
          </Box>

          <Stack direction="row" spacing={1}>
            <Button variant="contained" onClick={() => window.location.reload()}>
              Reload the page
            </Button>
            <Button
              variant="outlined"
              onClick={() => {
                window.location.hash = "#/user/home";
                window.location.reload();
              }}
            >
              Go to the dashboard
            </Button>
          </Stack>
        </Stack>
      </Container>
    );
  }
}
