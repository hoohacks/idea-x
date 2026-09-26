import Layout from "../Layout";
import { useContext, useEffect, useRef, useState } from "react";
import { AuthContext } from "../../App";
import { ref, get, set, onValue, runTransaction } from "firebase/database";
import { auth, database, storage } from "../../firebase";
import { useNavigate } from "react-router-dom";
import { memberIds } from "./teamMembers";
import { personName } from "../../roles.js";
import { leaveTeam } from "./teamMembership.js";
import { PageSkeleton } from "../../loadingUi";
import { EVENT, describeRemaining, formatEventTime } from "../../eventInfo";
import { uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { ref as storageRef } from "firebase/storage";
import {
    Alert,
    Avatar,
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
    Stack,
    TextField,
    Typography,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { PiArrowSquareOut, PiPresentationChart } from "react-icons/pi";

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
    // null until the flag arrives, so the form does not flash up and vanish
    const [submissionsOpen, setSubmissionsOpen] = useState(null);

    // Live, so the form appears the moment organizers open submissions on the
    // day, without anybody reloading. An absent flag means closed.
    useEffect(() => {
        return onValue(
            ref(database, "config/submissionsOpen"),
            (snapshot) => setSubmissionsOpen(snapshot.val() === true),
            () => setSubmissionsOpen(false)
        );
    }, []);

    // The optional deadline, as epoch ms. The rules check it against the
    // server's clock; the page checks it against this one, ticking so the form
    // closes and the countdown moves without a reload.
    const [closeAt, setCloseAt] = useState(null);
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        return onValue(
            ref(database, "config/submissionsCloseAt"),
            (snapshot) => setCloseAt(typeof snapshot.val() === "number" ? snapshot.val() : null),
            () => setCloseAt(null)
        );
    }, []);
    useEffect(() => {
        if (closeAt === null) return undefined;
        const timer = setInterval(() => setNow(Date.now()), 15_000);
        return () => clearInterval(timer);
    }, [closeAt]);

    const pastDeadline = closeAt !== null && now >= closeAt;
    const accepting = submissionsOpen === true && !pastDeadline;


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

            // The seed guard above only fills ideaName/problemStatement/
            // targetIndustry in ONCE per team, on purpose -- so a tab that has
            // been open since before this moment can still be holding exactly
            // what was there when it loaded, not what a teammate saved since.
            // Writing that straight over the database the way this used to
            // would silently erase a real submission with someone else's
            // stale or half-finished text. The pitch deck fields above don't
            // have this problem because they are re-derived from the live
            // `teamData` every time, not from state seeded once; these three
            // can't be re-derived the same way without also throwing away
            // whatever THIS tab is actively typing, which is the exact bug
            // the seed guard exists to prevent.
            //
            // So instead of guessing, check: has the database moved past what
            // this tab last saw? A transaction makes that check and the write
            // atomic, the same way saveDraft in draftStore.js protects two
            // organizers editing the same schedule draft -- reading the
            // stored value a moment before writing narrows the race but does
            // not close it.
            const baseline = submissionBaseline.current;
            const result = await runTransaction(
                ref(database, `teams/${teamId}/submission`),
                (current) => {
                    const storedIdea = current?.ideaName ?? "";
                    const storedProblem = current?.problemStatement ?? "";
                    const storedIndustry = current?.targetIndustry ?? "";
                    if (
                        storedIdea !== baseline.ideaName ||
                        storedProblem !== baseline.problemStatement ||
                        storedIndustry !== baseline.targetIndustry
                    ) {
                        // somebody saved real content this tab never saw --
                        // abort by returning nothing rather than overwrite it
                        return undefined;
                    }
                    return {
                        ideaName,
                        problemStatement,
                        targetIndustry,
                        pitchDeckName: deckName,
                        pitchDeckURL,
                    };
                },
                { applyLocally: false }
            );

            if (!result.committed) {
                setUploadError(
                    "A teammate already saved changes to the idea, problem statement or target " +
                    "industry since this page loaded them. Reload the page to see the latest " +
                    "version, then make your changes again on top of it."
                );
                return;
            }

            // This tab's own write just became the new baseline, so saving
            // again later in the same session (no reload in between) is
            // checked against what it actually wrote, not what it started with.
            submissionBaseline.current = { ideaName, problemStatement, targetIndustry };

            // only after the details land, so a team is never marked submitted
            // with nothing to show
            await set(ref(database, `teams/${teamId}/submitted`), true);

            setShowModal(true);
        } catch (error) {
            console.error("Could not save the submission:", error);
            setUploadError(
                String(error?.message ?? error).includes("PERMISSION_DENIED")
                    ? "Submissions are closed right now, so this was not saved."
                    : "Your submission could not be saved. Please try again."
            );
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

    // What the database held for these three fields at the moment they were
    // seeded (or, after this tab's own successful save, what it just wrote).
    // handleSubmitProject compares this against what's actually stored right
    // before writing, so a save started from a stale seed can tell it is
    // about to clobber a teammate's newer submission instead of doing it
    // silently.
    const submissionBaseline = useRef({ ideaName: "", problemStatement: "", targetIndustry: "" });

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
            // the ids ride along in the same order, so the page can mark "you"
            const teamData = { ...snapshot.val(), memberNames, memberUids: members };

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
                const seededIdea = teamData.submission?.ideaName || "";
                const seededProblem = teamData.submission?.problemStatement || "";
                const seededIndustry = teamData.submission?.targetIndustry || "";
                submissionBaseline.current = {
                    ideaName: seededIdea,
                    problemStatement: seededProblem,
                    targetIndustry: seededIndustry,
                };
                setIdeaName(seededIdea);
                setProblemStatement(seededProblem);
                setTargetIndustry(seededIndustry);
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
                        {/* Said outright, so nobody thinks they must arrive with a
                            team: plenty of people only meet theirs on the day. */}
                        <Typography variant="body2">
                            That is fine. You can find teammates on the day of the event, too. If you
                            already have people in mind, start a team and share the ID, or join theirs.
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
                    <PageSkeleton label="Loading your team" cards={3} />
                ) : (
                    <Stack spacing={2}>
                        <Box>
                            <Typography variant="h1">{teamData.name}</Typography>
                        </Box>

                        <TeamIdCard teamId={teamId} />

                        {/* When and where, as the sentence a team repeats to itself
                            on the day, not two chips to decode. */}
                        {(schedule || finalSlot) && (
                            <Card sx={{ borderRadius: 4 }}>
                                <CardContent sx={{ p: { xs: 2.5, sm: 3 }, "&:last-child": { pb: { xs: 2.5, sm: 3 } } }}>
                                    <Stack spacing={1.25}>
                                        {schedule && (
                                            <PitchLine time={schedule.time} room={schedule.room} />
                                        )}
                                        {finalSlot && (
                                            <PitchLine
                                                label="Final round"
                                                time={finalSlot.timeslot}
                                                room={finalSlot.room}
                                            />
                                        )}
                                    </Stack>
                                </CardContent>
                            </Card>
                        )}

                        {schedule || !accepting ? (
                            teamData.submission ? (
                                <Card>
                                    <CardContent sx={{ p: 2.5, "&:last-child": { pb: 2.5 } }}>
                                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                            Your submission
                                        </Typography>
                                        {/* the idea's own name: the team's is already the page title */}
                                        <Typography variant="h3" component="h2" sx={{ mt: 0.5 }}>
                                            {teamData.submission.ideaName}
                                        </Typography>
                                        <Typography variant="body1" sx={{ mt: 1, maxWidth: "65ch" }}>
                                            {teamData.submission.problemStatement}
                                        </Typography>
                                        {teamData.submission.targetIndustry && (
                                            <Chip
                                                label={teamData.submission.targetIndustry}
                                                size="small"
                                                sx={{ mt: 1.5, textTransform: "capitalize" }}
                                            />
                                        )}
                                        {teamData.submission.pitchDeckURL && (
                                            <Box sx={{ mt: 2 }}>
                                                <Button
                                                    variant="outlined"
                                                    size="small"
                                                    href={teamData.submission.pitchDeckURL}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    endIcon={<PiArrowSquareOut />}
                                                >
                                                    Open pitch deck
                                                </Button>
                                            </Box>
                                        )}
                                    </CardContent>
                                </Card>
                            ) : (
                                !schedule && submissionsOpen !== null && (
                                    <SubmissionsClosed closedAt={pastDeadline ? closeAt : null} now={now} />
                                )
                            )
                        ) : (
                            <Card>
                                <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
                                    <Typography variant="h5">Project submission</Typography>
                                    <Typography variant="body2" sx={{ mb: 2 }}>
                                        Judges read this before you pitch.
                                    </Typography>
                                    {closeAt !== null && <DeadlineNote closeAt={closeAt} now={now} />}

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
                                                    aria-label="Pitch deck upload"
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
                            <CardContent sx={{ p: 2.5, "&:last-child": { pb: 2.5 } }}>
                                <Typography variant="h5" sx={{ mb: 1.5 }}>Members</Typography>
                                {teamData.memberNames?.length ? (
                                    <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
                                        {teamData.memberNames.map((name, index) => {
                                            const isYou = teamData.memberUids?.[index] === auth.currentUser?.uid;
                                            return (
                                                <Chip
                                                    key={teamData.memberUids?.[index] ?? index}
                                                    avatar={<Avatar>{initialsOfName(name)}</Avatar>}
                                                    label={isYou ? `${name} (you)` : name}
                                                    sx={{
                                                        height: 40,
                                                        pr: 0.5,
                                                        bgcolor: "background.paper",
                                                        fontWeight: isYou ? 700 : 500,
                                                        "& .MuiChip-avatar": {
                                                            width: 30,
                                                            height: 30,
                                                            fontSize: "0.75rem",
                                                            bgcolor: isYou ? "primary.main" : "action.selected",
                                                            color: isYou ? "#fff" : "text.primary",
                                                        },
                                                    }}
                                                />
                                            );
                                        })}
                                    </Stack>
                                ) : (
                                    <Typography variant="body2">
                                        No members yet. Share the team ID above to bring people in.
                                    </Typography>
                                )}
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

/** "You pitch at 5:00 PM in Rice 340." with the time and room in bold. */
function PitchLine({ label, time, room }) {
    return (
        <Stack direction="row" alignItems="flex-start" sx={{ gap: 1.5 }}>
            <Box aria-hidden sx={{ fontSize: 24, lineHeight: 0, mt: 0.25, color: "primary.main" }}>
                <PiPresentationChart />
            </Box>
            <Box>
                {label && (
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {label}
                    </Typography>
                )}
                <Typography sx={{ fontSize: { xs: "1.25rem", sm: "1.5rem" }, fontWeight: 600, lineHeight: 1.3, color: "text.primary" }}>
                    You pitch at <Box component="span" sx={{ fontWeight: 800 }}>{time}</Box> in{" "}
                    <Box component="span" sx={{ fontWeight: 800 }}>{room}</Box>.
                </Typography>
            </Box>
        </Stack>
    );
}

/**
 * When the form is not taking submissions. Before organizers open it, this says
 * when it arrives and that the team can keep growing; after the deadline, it
 * says when it closed and who can still help. Either way it replaces a form the
 * database would refuse.
 */
function SubmissionsClosed({ closedAt, now }) {
    return (
        <Card>
            <CardContent sx={{ p: 2.5, "&:last-child": { pb: 2.5 } }}>
                <Typography variant="h5">Project submission</Typography>
                <Typography variant="body1" sx={{ mt: 1, maxWidth: "65ch" }}>
                    {closedAt !== null
                        ? `Submissions closed at ${formatEventTime(closedAt, now)}. If your team still needs to hand something in, find an organizer.`
                        : `Submissions open on the day of the event, ${EVENT.dayLabel}. Anyone can still join before then with your Team ID, and people keep finding teammates on the day, too.`}
                </Typography>
            </CardContent>
        </Card>
    );
}

/**
 * The deadline above the form. A quiet line while there is time, and a warning
 * in the last half hour, when a team that has not saved needs to hear it.
 */
function DeadlineNote({ closeAt, now }) {
    const left = closeAt - now;
    const text = `Submissions close at ${formatEventTime(closeAt, now)}, in ${describeRemaining(left)}.`;
    if (left <= 30 * 60_000) {
        return <Alert severity="warning" sx={{ mb: 2 }}>{text} Save what you have.</Alert>;
    }
    return (
        <Typography variant="body2" sx={{ mb: 2, fontWeight: 600, color: "text.primary" }}>
            {text}
        </Typography>
    );
}

function initialsOfName(name) {
    return String(name ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0].toUpperCase())
        .join("");
}

/**
 * The ID teammates type to join. It is a database push key, and those start
 * with a dash -- which, set inline after "Team ID", read as punctuation and got
 * left off. So it sits on its own, in mono, with a copy button and a line
 * saying the dash belongs to it.
 */
function TeamIdCard({ teamId }) {
    const [copied, setCopied] = useState(false);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(teamId);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // no clipboard access (an insecure origin, a refused permission):
            // the ID is still on screen to select by hand
        }
    };

    return (
        <Card>
            <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
                <Typography variant="h5" gutterBottom>Team ID</Typography>
                <Stack direction="row" sx={{ gap: 1 }} alignItems="center" flexWrap="wrap">
                    <Typography
                        variant="data"
                        component="code"
                        sx={{
                            fontSize: "1rem",
                            px: 1.25,
                            py: 0.75,
                            border: 1,
                            borderColor: "divider",
                            borderRadius: 1,
                            bgcolor: "background.default",
                            userSelect: "all",
                            wordBreak: "break-all",
                        }}
                    >
                        {teamId}
                    </Typography>
                    <Button size="small" variant="outlined" onClick={copy}>
                        {copied ? "Copied" : "Copy"}
                    </Button>
                </Stack>
                <Typography variant="body2" sx={{ mt: 1 }}>
                    Share this so teammates can join.
                    {teamId?.startsWith("-") && " The dash at the start is part of the ID."}
                </Typography>
            </CardContent>
        </Card>
    );
}

export default Team;
