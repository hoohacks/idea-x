import React, { useState } from "react";
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Link,
    Stack,
    TextField,
    Typography,
} from "@mui/material";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "./firebase";
import { PublicShell } from "./registrationUi";

export default function ForgotPasswordPage() {
    const [sentReset, setSentReset] = useState(false);
    const [error, setError] = useState("");
    const [sending, setSending] = useState(false);
    const [email, setEmail] = useState("");

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (sending) return;
        setSending(true);
        setError("");
        try {
            await sendPasswordResetEmail(auth, email);
            setSentReset(true);
        } catch (err) {
            // this used to only reach the console, so a failed reset looked
            // exactly like a successful one from the outside
            console.error("Error sending password reset email:", err);
            setError(
                err.code === "auth/invalid-email"
                    ? "That does not look like a valid email address."
                    : "Could not send the reset email. Please check the address and try again."
            );
        } finally {
            setSending(false);
        }
    };

    return (
        <PublicShell maxWidth="xs" pad>
            <Card>
                <CardContent sx={{ p: 3, "&:last-child": { pb: 3 } }}>
                    <Typography variant="h1">Reset password</Typography>

                    {sentReset ? (
                        <Stack spacing={2} sx={{ mt: 2 }}>
                            <Alert severity="success">
                                Reset email sent to <strong>{email}</strong>. Check your inbox and
                                spam folder.
                            </Alert>
                            <Button variant="contained" fullWidth href="#/login">
                                Back to sign in
                            </Button>
                        </Stack>
                    ) : (
                        <Box component="form" onSubmit={handleSubmit}>
                            <Stack spacing={2} sx={{ mt: 2 }}>
                                <Typography variant="body2">
                                    We will email you a link to set a new password.
                                </Typography>
                                <TextField
                                    required
                                    fullWidth
                                    id="email"
                                    label="Email address"
                                    name="email"
                                    type="email"
                                    autoComplete="email"
                                    autoFocus
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                />
                                {error && <Alert severity="error">{error}</Alert>}
                                <Button type="submit" fullWidth variant="contained" disabled={sending}>
                                    {sending ? "Sending…" : "Send reset link"}
                                </Button>
                                <Link href="#/login" variant="body2" sx={{ textAlign: "center" }}>
                                    Back to sign in
                                </Link>
                            </Stack>
                        </Box>
                    )}
                </CardContent>
            </Card>
        </PublicShell>
    );
}
