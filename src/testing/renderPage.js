import React from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import theme from "../theme";
import { AuthContext } from "../App";

/**
 * Render a page the way the app does: themed, inside a router, with a signed-in
 * account in the auth context. `auth` overrides any field of that context.
 */
export function renderPage(ui, { auth = {}, route = "/" } = {}) {
  const value = {
    userCredential: { user: { uid: "admin-1", email: "admin@example.com" } },
    userData: { firstName: "Olu", lastName: "Admin", email: "admin@example.com" },
    userTypes: ["admin"],
    loadingAuth: false,
    loadingUserData: false,
    refreshUserData: jest.fn(),
    handleLogin: jest.fn(),
    token: null,
    ...auth,
  };
  return render(
    <ThemeProvider theme={theme}>
      <AuthContext.Provider value={value}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </AuthContext.Provider>
    </ThemeProvider>
  );
}
