import Layout from "./Layout";
import { useContext, useState } from "react";
import { AuthContext } from "../App";
import { hasRole, roleList } from "../roles";
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    Divider,
    FormControl,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    Typography,
} from "@mui/material";
import { auth, database } from "../firebase";
import { sendPasswordResetEmail } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { ref, update } from "firebase/database";

const DIETARY = ["none", "vegetarian", "vegan", "gluten-free"];

// label/value pairs on one line each, rather than a stack of centred headings
function Row({ label, children }) {
    return (
        <Stack
            direction={{ xs: "column", sm: "row" }}
            sx={{ py: 1.25, gap: { xs: 0.25, sm: 2 } }}
            alignItems={{ xs: "flex-start", sm: "center" }}
        >
            <Typography variant="body2" sx={{ minWidth: 150 }}>
                {label}
            </Typography>
            <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
        </Stack>
    );
}

function Profile() {
    const { userData, userTypes, userCredential } = useContext(AuthContext);
    const roles = roleList(userTypes);
    const navigate = useNavigate();
    const [sentReset, setSentReset] = useState(false);
    const [resetError, setResetError] = useState("");
    const [dietaryRestriction, setDietaryRestriction] = useState(
        userData?.dietaryRestriction ?? "none"
    );



    const setDietaryRestrictions = async (restriction) => {
        if (!userData || !restriction) return;
        await update(ref(database, `/competitors/${userCredential.user.uid}`), {
            dietaryRestriction: restriction,
        });
        setDietaryRestriction(restriction);
    };

    const handlePasswordReset = async () => {
        const email = userData?.email ?? userCredential?.user?.email;
        if (!email) {
            setResetError("No email on file for this account.");
            return;
        }
        try {
            await sendPasswordResetEmail(auth, email);
            setSentReset(true);
            setResetError("");
        } catch (error) {
            console.error("Error sending password reset email:", error);
            setResetError("Could not send the reset email. Please try again.");
        }
    };

    const handleLogout = async () => {
        try {
            await auth.signOut();
            navigate("/login", { replace: true });
        } catch (error) {
            console.error("Error during logout:", error);
        }
    };

    if (!userData) {
        return (
            <Layout maxWidth="sm">
                <Typography variant="h1" gutterBottom>
                    Profile
                </Typography>
                <Alert severity="warning">
                    No profile found for this account. Please contact HooHacks at{" "}
                    <a href="mailto:support@hoohacks.com">support@hoohacks.com</a>.
                </Alert>
                <Button variant="outlined" onClick={handleLogout} sx={{ mt: 2 }}>
                    Log out
                </Button>
            </Layout>
        );
    }

    return (
        <Layout maxWidth="sm">
            <Typography variant="h1" gutterBottom>
                Profile
            </Typography>

            <Card>
                <CardContent sx={{ py: 1, "&:last-child": { pb: 1 } }}>
                    <Row label="Name">
                        <Typography>
                            {userData.firstName} {userData.lastName}
                        </Typography>
                    </Row>
                    <Divider />
                    <Row label="Email">
                        <Typography sx={{ wordBreak: "break-all" }}>{userData.email}</Typography>
                    </Row>
                    <Divider />
                    <Row label="Role">
                        <Stack sx={{ gap: 0.75 }} direction="row" flexWrap="wrap">
                            {roles.length ? (
                                roles.map((role) => (
                                    <Chip
                                        key={role}
                                        label={role}
                                        size="small"
                                        variant="outlined"
                                        sx={{ textTransform: "capitalize" }}
                                    />
                                ))
                            ) : (
                                <Typography variant="body2">None assigned</Typography>
                            )}
                        </Stack>
                    </Row>
                    {hasRole(userTypes, "competitor") && (
                        <>
                            <Divider />
                            <Row label="Dietary restrictions">
                                <FormControl sx={{ minWidth: 200 }}>
                                    <InputLabel>Dietary restrictions</InputLabel>
                                    <Select
                                        label="Dietary restrictions"
                                        value={dietaryRestriction}
                                        onChange={(e) => setDietaryRestrictions(e.target.value)}
                                    >
                                        {DIETARY.map((option) => (
                                            <MenuItem
                                                key={option}
                                                value={option}
                                                sx={{ textTransform: "capitalize" }}
                                            >
                                                {option}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            </Row>
                        </>
                    )}
                </CardContent>
            </Card>

            {sentReset && (
                <Alert severity="success" sx={{ mt: 2 }}>
                    Password reset email sent. Check your inbox and spam folder.
                </Alert>
            )}
            {resetError && (
                <Alert severity="error" sx={{ mt: 2 }}>
                    {resetError}
                </Alert>
            )}

            <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                {!sentReset && (
                    <Button variant="outlined" onClick={handlePasswordReset}>
                        Send password reset
                    </Button>
                )}
                <Button variant="outlined" onClick={handleLogout}>
                    Log out
                </Button>
            </Stack>
        </Layout>
    );
}

export default Profile;
