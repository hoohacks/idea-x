import React from "react";
import ReactDOM from "react-dom/client";
import reportWebVitals from "./reportWebVitals";
import { HashRouter } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import App from "./App";
import ErrorBoundary from "./ErrorBoundary";
import theme from "./theme";
import "./index.css";
import { redirectToHashRoute } from "./hashRedirect";

// Before anything renders: a path-shaped URL (…/judge-registration) has an
// empty hash, so the router would match "/" and quietly serve the competitor
// form. Send it to the hash route it meant instead.
redirectToHashRoute();

const root = ReactDOM.createRoot(document.getElementById("root"));

// one ThemeProvider for the whole app, so pages stop defining their own
root.render(
  <ThemeProvider theme={theme}>
    <CssBaseline />
    {/* inside the theme so the fallback is not unstyled, outside the router so
        a throw during routing is still caught */}
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </ThemeProvider>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
