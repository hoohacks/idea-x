import React, { useState } from "react";
import { useAuth } from "./App.js";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControlLabel,
  Link,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { EVENT } from "./eventInfo";
import { PublicShell } from "./registrationUi";
import { REGISTRATION_OPEN, isStaffEntrance } from "./registrationWindow";
import ClosedNotice from "./ClosedNotice";

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

  const [formData, setFormData] = useState({
    email: "",
    password: "",
    remember: false,
  });

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
    else setError("We could not sign you in. Check your email and password, or reset it below.");
  };

  return (
    <PublicShell maxWidth="xs" pad>
      <Card>
        <CardContent sx={{ p: 3, "&:last-child": { pb: 3 } }}>
          {/* the bar carries the wordmark, so the page says what it is for */}
          <Typography variant="h1" gutterBottom>
            Sign in
          </Typography>
          <Typography variant="body2">{EVENT.dateLabel}</Typography>

          <Box component="form" onSubmit={handleSubmit}>
            <Stack spacing={2} sx={{ mt: 2 }}>
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
                type="password"
                id="password"
                autoComplete="current-password"
                value={formData.password}
                onChange={handleChange}
              />

              {error && <Alert severity="error">{error}</Alert>}

              <FormControlLabel
                control={
                  <Checkbox
                    name="remember"
                    size="small"
                    checked={formData.remember}
                    onChange={handleChange}
                  />
                }
                label={<Typography variant="body2">Keep me signed in</Typography>}
                sx={{ mr: 0 }}
              />

              <Button type="submit" fullWidth variant="contained" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </Button>

              <Stack
                direction="row"
                justifyContent="space-between"
                sx={{ pt: 0.5 }}
              >
                <Link href="#/forgot-password" variant="body2">
                  Forgot password?
                </Link>
                <Link href="#/ideathon-registration" variant="body2">
                  Create an account
                </Link>
              </Stack>
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </PublicShell>
  );
}
