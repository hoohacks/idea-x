import React, { useState } from "react";
import { useAuth } from "./App.jsx";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Link,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { EVENT } from "./eventInfo";
import { AuthCard, PublicShell } from "./registrationUi";
import { PiEye, PiEyeSlash } from "react-icons/pi";
import { PAST_WINNERS } from "./winners";
import { REGISTRATION_OPEN, isStaffEntrance } from "./registrationWindow";
import ClosedNotice from "./ClosedNotice";

// page title
import usePageTitle from "./usePageTitle.js";

export default function LoginPage() {
  // Organizers still have to reach the control panel while the doors are shut,
  // and signing in is how. `#/login?staff` is the way through.
  const { search } = useLocation();
  if (!REGISTRATION_OPEN && !isStaffEntrance(search)) {
    return <ClosedNotice what="Sign-in" />;
  }

  return <SignInForm />;
}

function SignInForm() {
  const { handleLogin } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [formData, setFormData] = useState({
    email: "",
    password: "",
    remember: false,
  });

  usePageTitle("Sign in");

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const success = await handleLogin(
      formData.email,
      formData.password,
      formData.remember
    );
    setBusy(false);
    if (success) navigate("/user/home");
    else setError("We could not sign you in. Check your email and password, or reset your password above.");
  };

  return (
    <PublicShell maxWidth="xs" pad backdrop={PAST_WINNERS}>
      <AuthCard
        title="Welcome back"
        footer={
          <>
            New to {EVENT.name}?{" "}
            <Link href="#/ideathon-registration">Create an account</Link>
          </>
        }
      >
        <Box component="form" onSubmit={handleSubmit}>
          <Stack spacing={2.25}>
            <TextField
              required
              fullWidth
              id="email"
              label="Email address"
              name="email"
              type="email"
              autoComplete="email"
              autoFocus
              value={formData.email}
              onChange={handleChange}
            />
            <TextField
              required
              fullWidth
              name="password"
              label="Password"
              type={showPassword ? "text" : "password"}
              id="password"
              autoComplete="current-password"
              value={formData.password}
              onChange={handleChange}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    {/* labelled without the word "password", so a label lookup
                        for the field itself still finds exactly one thing */}
                    <IconButton
                      edge="end"
                      onClick={() => setShowPassword((shown) => !shown)}
                      aria-label={showPassword ? "Hide what you typed" : "Show what you typed"}
                      aria-pressed={showPassword}
                      sx={{ mr: -0.5, color: "text.secondary" }}
                    >
                      {showPassword ? <PiEyeSlash size={20} /> : <PiEye size={20} />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />

            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ gap: 1 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    name="remember"
                    size="small"
                    checked={formData.remember}
                    onChange={handleChange}
                  />
                }
                label={<Typography variant="body2" sx={{ color: "text.primary" }}>Keep me signed in</Typography>}
                sx={{ mr: 0 }}
              />
              <Link href="#/forgot-password" variant="body2">
                Forgot password?
              </Link>
            </Stack>

            {error && <Alert severity="error">{error}</Alert>}

            <Button type="submit" fullWidth variant="contained" size="large" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </Stack>
        </Box>
      </AuthCard>
    </PublicShell>
  );
}
