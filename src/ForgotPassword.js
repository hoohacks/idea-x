import React, { useState } from "react";
import {
    Alert,
    Box,
    Button,
    Link,
    Stack,
    TextField,
} from "@mui/material";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "./firebase";
import { AuthCard, PublicShell } from "./registrationUi";
import { PAST_WINNERS } from "./winners";

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
        <PublicShell maxWidth="xs" pad backdrop={PAST_WINNERS}>
            <AuthCard
                title={sentReset ? "Check your email" : "Reset your password"}
                subtitle={
                    sentReset
                        ? `We sent a reset link to ${email}. It can take a minute, and sometimes lands in spam.`
                        : "Enter the email you signed up with and we will send you a link to set a new one."
                }
                footer={
                    <>
                        Remembered it? <Link href="#/login">Back to sign in</Link>
                    </>
                }
            >
                {sentReset ? (
                    <Button variant="contained" size="large" fullWidth href="#/login">
                        Back to sign in
                    </Button>
                ) : (
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
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                            />
                            {error && <Alert severity="error">{error}</Alert>}
                            <Button type="submit" fullWidth variant="contained" size="large" disabled={sending}>
                                {sending ? "Sending…" : "Send reset link"}
                            </Button>
                        </Stack>
                    </Box>
                )}
            </AuthCard>
        </PublicShell>
    );
}
