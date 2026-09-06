import Layout from "../Layout";
import { useContext, useEffect, useRef, useState } from "react";
import { AuthContext } from "../../App";
import { ref, get, set, onValue } from "firebase/database";
import { auth, database, storage } from "../../firebase";
import { useNavigate } from "react-router-dom";
import { memberIds } from "./teamMembers";
import { personName } from "../../roles.js";
import { leaveTeam } from "./teamMembership.js";
import { uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { ref as storageRef } from "firebase/storage";
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    LinearProgress,
    Link as MuiLink,
    Stack,
    TextField,
    Typography,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";

function Team() {
    const navigate = useNavigate();
    // leaveTeam reads the signed-in uid itself, so this no longer destructures
    // userCredential just to build a path out of it
    const { userData, refreshUserData } = useContext(AuthContext);
    const [teamData, setTeamData] = useState(null);
    const [uploadPitchDeck, setUploadPitchDeck] = useState(null);
    const [pitchDeckName, setPitchDeckName] = useState("");
    const [uploadProgress, setUploadProgress] = useState(null);
    const [uploadError, setUploadError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [ideaName, setIdeaName] = useState(userData ? userData.ideaName : "");
    const [problemStatement, setProblemStatement] = useState(userData ? userData.problemStatement : "");
    const [targetIndustry, setTargetIndustry] = useState(userData ? userData.targetIndustry : "");
    const [showModal, setShowModal] = useState(false);


    // Get team ID from userData if available
    const teamId = userData ? userData.teamId : null;

    const uploadFileToFirebase = (event) => {
        if (!event.target.files[0]) return;

        const storageReference = storageRef(
            storage,
            // the uploader's uid is part of the path so storage.rules can stop
            // one team overwriting another's deck; it cannot read the database
            // to check membership
            `teams/${teamId}/${auth.currentUser?.uid}/${event.target.files[0].name}`
        );
        const uploadResumeToDB = uploadBytesResumable(
            storageReference,
            event.target.files[0]
        );
        uploadResumeToDB.on(
            "state_changed",
            (snapshot) => {
                setUploadProgress(
                    (snapshot.bytesTransferred / snapshot.totalBytes) * 100
                );
            },
            (error) => {
                console.error("Pitch deck upload failed:", error);
                setUploadError("The pitch deck failed to upload. Please try again.");
                setUploadProgress(null);
            },
            () => setUploadProgress(100)
        );

        // set synchronously: this used to happen only inside the progress
        // callback, so submitting straight after picking a file saw no upload
        // task and saved the submission with no pitch deck URL at all
        setUploadPitchDeck(uploadResumeToDB);
        setUploadError("");
        setPitchDeckName(event.target.files[0].name);
    }

    const handleSubmitProject = async () => {
        if (submitting) return;
        if (!ideaName.trim() || !problemStatement.trim() || !targetIndustry.trim()) {
            setUploadError("Please fill in the idea name, problem statement and target industry.");
            return;
        }

        const existingURL = teamData?.submission?.pitchDeckURL ?? null;
        if (!uploadPitchDeck && !existingURL) {
            setUploadError("Please upload a pitch deck before submitting.");
            return;
        }

        setSubmitting(true);
        setUploadError("");
        try {
            let pitchDeckURL = existingURL;
            let deckName = teamData?.submission?.pitchDeckName ?? pitchDeckName;

            if (uploadPitchDeck) {
                // await the task itself rather than trusting a progress counter
                await uploadPitchDeck;
                pitchDeckURL = await getDownloadURL(uploadPitchDeck.snapshot.ref);
                deckName = pitchDeckName;
            }

            await set(ref(database, `teams/${teamId}/submission`), {
                ideaName,
                problemStatement,
                targetIndustry,
                pitchDeckName: deckName,
                pitchDeckURL,
            });
            // only after the details land, so a team is never marked submitted
            // with nothing to show
            await set(ref(database, `teams/${teamId}/submitted`), true);

            setShowModal(true);
        } catch (error) {
            console.error("Could not save the submission:", error);
            setUploadError("Your submission could not be saved. Please try again.");
        } finally {
            setSubmitting(false);
        }
    }

    const handleLeaveTeam = async () => {
        // Both halves of the membership go in one update. As two writes, a
        // failure between them left the person still in members but with no
        // teamId -- looking teamless while still counting toward the team.
        const result = await leaveTeam(teamId);
        if (!result.ok) {
            setUploadError(result.error);
            return;
        }

        await refreshUserData();

        navigate('/user/team');
    }

    // Which team the form fields were last filled in from, so a later snapshot
    // does not overwrite what somebody is typing. See below.
    const seededFor = useRef(null);

    // Fetch team data from Firebase if teamId is available
    useEffect(() => {
        if (!teamId) return;
        const teamRef = ref(database, "teams/" + teamId);
        const unsubscribe = onValue(teamRef, async (snapshot) => {
            if (!snapshot.exists())
                return;

            // Map member UIDs to names
            const members = memberIds(snapshot.val().members);
            const memberNames = await Promise.all(members.map(async (uid) => {
                const userRef = ref(database, `competitors/${uid}`);
                const userSnapshot = await get(userRef);
                if (userSnapshot.exists()) {
                    const userInfo = userSnapshot.val();
                    return personName(userInfo, "Unnamed teammate");
                }
                return "Unknown User";
            }));
            const teamData = { ...snapshot.val(), memberNames };

            // Seed the form from the database ONCE per team, not on every
            // snapshot.
            //
            // This is a live subscription: it fires again whenever anything
            // about the team changes -- a teammate joining, an organizer fixing
            // the name, the schedule being published. Re-seeding on each of
            // those overwrote whatever the person was in the middle of typing,
            // with no warning and nothing to undo it. Somebody writing their
            // problem statement lost it the moment a teammate pressed Join.
            if (seededFor.current !== teamId) {
                seededFor.current = teamId;
                setIdeaName(teamData.submission?.ideaName || "");
                setProblemStatement(teamData.submission?.problemStatement || "");
                setTargetIndustry(teamData.submission?.targetIndustry || "");
                setPitchDeckName(teamData.submission?.pitchDeckName || "");
            }

            setTeamData(teamData);
        });
        return () => unsubscribe();
    }, [teamId]);

    if (!teamId) {
        return (
            <Layout maxWidth="sm">
                <Typography variant="h1" gutterBottom>Team</Typography>
                <Card>
                    <CardContent sx={{ p: 3, "&:last-child": { pb: 3 } }}>
                        <Typography variant="body1" gutterBottom>
                            You are not on a team yet.
                        </Typography>
                        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                            <Button variant="contained" component={RouterLink} to="/user/team/create">
                                Create a team
                            </Button>
                            <Button variant="outlined" component={RouterLink} to="/user/team/join">
                                Join with an ID
                            </Button>
                        </Stack>
                    </CardContent>
                </Card>
            </Layout>
        );
    }

    const schedule = teamData?.schedule;
    // Written into the team by activateFinalRound. Subscribing to /finalRound
    // for this used to hand every competitor the full standings -- team names
    // and average scores -- before they were announced.
    const finalSlot = teamData?.finalSlot;

    return (
        <>
            <Dialog open={showModal} onClose={() => setShowModal(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Submission received</DialogTitle>
                <DialogContent>
                    <Typography variant="body1">
                        Your project is in. You can come back and update it any time before the
                        schedule is published.
                    </Typography>
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button variant="contained" onClick={() => setShowModal(false)}>
                        Done
                    </Button>
                </DialogActions>
            </Dialog>

            <Layout maxWidth="sm">
                {!teamData ? (
                    <Typography variant="body2">Loading team…</Typography>
                ) : (
                    <Stack spacing={2}>
                        <Box>
                            <Typography variant="h1">{teamData.name}</Typography>
                            <Typography variant="body2" sx={{ mt: 0.5 }}>
                                Team ID {teamId} — share this so teammates can join
                            </Typography>
                        </Box>

                        {(schedule || finalSlot) && (
                            <Card>
                                <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
                                    <Typography variant="h5" gutterBottom>Your pitch</Typography>
                                    {schedule && (
                                        <Stack direction="row" spacing={0.75} sx={{ mb: finalSlot ? 1.5 : 0 }}>
                                            <Chip label={schedule.time} size="small" color="primary" />
                                            <Chip label={schedule.room} size="small" variant="outlined" />
                                        </Stack>
                                    )}
                                    {finalSlot && (
                                        <>
                                            <Typography variant="body2" sx={{ mb: 0.75 }}>Final round</Typography>
                                            <Stack direction="row" spacing={0.75}>
                                                <Chip label={finalSlot.timeslot} size="small" color="primary" />
                                                <Chip label={finalSlot.room} size="small" variant="outlined" />
                                            </Stack>
                                        </>
                                    )}
                                </CardContent>
                            </Card>
                        )}

                        {schedule ? (
                            teamData.submission && (
                                <Card>
                                    <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
                                        <Typography variant="h5" gutterBottom>
                                            {teamData.submission.ideaName}
                                        </Typography>
                                        <Typography variant="body2">
                                            {teamData.submission.problemStatement}
                                        </Typography>
                                        {teamData.submission.pitchDeckURL && (
                                            <MuiLink
                                                href={teamData.submission.pitchDeckURL}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                variant="body2"
                                                sx={{ display: "inline-block", mt: 1 }}
                                            >
                                                Pitch deck
                                            </MuiLink>
                                        )}
                                    </CardContent>
                                </Card>
                            )
                        ) : (
                            <Card>
                                <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
                                    <Typography variant="h5">Project submission</Typography>
                                    <Typography variant="body2" sx={{ mb: 2 }}>
                                        Judges read this before you pitch.
                                    </Typography>

                                    <Stack spacing={2}>
                                        <TextField
                                            label="Idea name"
                                            value={ideaName}
                                            onChange={(e) => setIdeaName(e.target.value)}
                                            fullWidth
                                        />
                                        <TextField
                                            label="Problem statement"
                                            value={problemStatement}
                                            onChange={(e) => setProblemStatement(e.target.value)}
                                            helperText="What problem does this solve, and why does it matter?"
                                            multiline
                                            minRows={3}
                                            fullWidth
                                        />
                                        <TextField
                                            label="Target industry"
                                            value={targetIndustry}
                                            onChange={(e) => setTargetIndustry(e.target.value)}
                                            helperText="e.g. technology, finance, healthcare, energy, fitness"
                                            fullWidth
                                        />

                                        <Box>
                                            <Button variant="outlined" component="label" fullWidth>
                                                {pitchDeckName || "Upload pitch deck (.ppt, .pptx, .pdf)"}
                                                <input
                                                    type="file"
                                                    hidden
                                                    accept=".ppt,.pptx,.pdf"
                                                    onChange={(e) => uploadFileToFirebase(e)}
                                                />
                                            </Button>
                                            {uploadProgress !== null && uploadProgress < 100 && (
                                                <LinearProgress
                                                    variant="determinate"
                                                    value={uploadProgress}
                                                    sx={{ mt: 1, height: 4, borderRadius: 2 }}
                                                />
                                            )}
                                        </Box>

                                        {uploadError && <Alert severity="error">{uploadError}</Alert>}

                                        <Button
                                            variant="contained"
                                            onClick={handleSubmitProject}
                                            disabled={submitting}
                                        >
                                            {submitting ? "Saving…" : "Save submission"}
                                        </Button>
                                    </Stack>
                                </CardContent>
                            </Card>
                        )}

                        <Card>
                            <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
                                <Typography variant="h5" gutterBottom>Members</Typography>
                                <Stack spacing={0.5}>
                                    {teamData.memberNames?.length ? (
                                        teamData.memberNames.map((name, index) => (
                                            <Typography key={index} variant="body1">{name}</Typography>
                                        ))
                                    ) : (
                                        <Typography variant="body2">No members yet.</Typography>
                                    )}
                                </Stack>
                            </CardContent>
                        </Card>

                        <Divider />

                        <Box>
                            <Button variant="outlined" onClick={handleLeaveTeam}>
                                Leave team
                            </Button>
                        </Box>
                    </Stack>
                )}
            </Layout>
        </>
    );
}

export default Team;
