import Layout from "./Layout";
import { useContext, useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { AuthContext } from "../App";
import { hasRole } from "../roles";
import AdminHome from "./admin/AdminHome";
import { Box, Button, Card, CardContent, Chip, Divider, Stack, Typography } from "@mui/material";
import { PiCalendarBlank, PiClock, PiMapPin, PiQrCode, PiPresentationChart, PiUsers } from "react-icons/pi";
import { ref, onValue } from "firebase/database";
import { database } from "../firebase";
import { EVENT, EVENT_START, eventPhase } from "../eventInfo";
import { tokens } from "../theme";

function differenceToTime(target) {
    if (!target || Number.isNaN(target.getTime())) return null;

    const difference = target - new Date();
    if (difference <= 0) return null;

    return {
        days: Math.floor(difference / (1000 * 60 * 60 * 24)),
        hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((difference / (1000 * 60)) % 60),
        seconds: Math.floor((difference / 1000) % 60),
    };
}

function Unit({ value, label }) {
    return (
        <Box sx={{ textAlign: "center", minWidth: { xs: 60, sm: 78 } }}>
            <Typography
                sx={{
                    // A clock. Tabular figures so the digits hold their
                    // columns as they tick rather than nudging each other.
                    color: tokens.INK,
                    fontSize: { xs: "2.5rem", sm: "3.5rem", md: "4rem" },
                    fontWeight: 700,
                    letterSpacing: "-0.03em",
                    lineHeight: 1.05,
                    fontVariantNumeric: "tabular-nums",
                }}
            >
                {String(value).padStart(2, "0")}
            </Typography>
            <Typography variant="body2" sx={{ display: "block", fontWeight: 600, mt: 0.5 }}>
                {label}
            </Typography>
        </Box>
    );
}

/**
 * One thing to do next, with the button that does it. A row in one list rather
 * than a card each: they are steps in an order, and equal cards side by side
 * said they were interchangeable.
 */
function NextStep({ icon, title, body, actions }) {
    // the icon stays beside the title at every width; the button moves under
    // the text on a phone rather than squeezing the text into a sliver
    const buttons = (
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, flexShrink: 0 }}>
            {actions}
        </Stack>
    );
    return (
        <Stack direction="row" alignItems={{ xs: "flex-start", sm: "center" }} sx={{ gap: 2, p: { xs: 2, sm: 2.5 } }}>
            <Box
                aria-hidden
                sx={{
                    flexShrink: 0,
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    bgcolor: "background.paper",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 22,
                    color: "text.primary",
                }}
            >
                {icon}
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="h5">{title}</Typography>
                <Typography variant="body2" sx={{ mt: 0.25, maxWidth: "60ch" }}>
                    {body}
                </Typography>
                <Box sx={{ display: { xs: "block", sm: "none" }, mt: 1.5 }}>{buttons}</Box>
            </Box>
            <Box sx={{ display: { xs: "none", sm: "block" } }}>{buttons}</Box>
        </Stack>
    );
}

/** Date, hours and venue, each as a pill with its icon. */
function EventFacts() {
    const facts = [
        { icon: <PiCalendarBlank />, text: EVENT.dateLabel },
        { icon: <PiClock />, text: EVENT.hours },
        { icon: <PiMapPin />, text: EVENT.venue },
    ];
    return (
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
            {facts.map((fact) => (
                <Chip key={fact.text} icon={fact.icon} label={fact.text} sx={{ pl: 0.5, "& .MuiChip-icon": { fontSize: 18, color: "text.primary" } }} />
            ))}
        </Stack>
    );
}

function Home() {
    const { userData, userTypes } = useContext(AuthContext);
    const [eventStart, setEventStart] = useState(() => new Date(EVENT_START));
    const [time, setTime] = useState(() => differenceToTime(new Date(EVENT_START)));

    useEffect(() => {
        const unsubscribe = onValue(ref(database, "config/eventStart"), (snapshot) => {
            if (!snapshot.exists()) return;
            const parsed = new Date(snapshot.val());
            if (!Number.isNaN(parsed.getTime())) setEventStart(parsed);
        });
        return () => unsubscribe();
    }, []);

    const [phase, setPhase] = useState(() => eventPhase(eventStart));

    useEffect(() => {
        const tick = () => {
            setTime(differenceToTime(eventStart));
            setPhase(eventPhase(eventStart));
        };
        tick();
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [eventStart]);

    const isAdmin = hasRole(userTypes, "admin");
    const isCompetitor = hasRole(userTypes, "competitor");
    const isJudge = hasRole(userTypes, "judge");
    const onATeam = Boolean(userData?.teamId);

    const steps = [];

    if (isCompetitor) {
        steps.push(
            onATeam
                ? {
                      key: "team",
                      icon: <PiPresentationChart />,
                      title: "Get the pitch ready",
                      body: "Your idea, the problem it solves and your deck all live on the team page. Judges read it before you present.",
                      actions: (
                          <Button variant="contained" component={RouterLink} to="/user/team">
                              Open your team
                          </Button>
                      ),
                  }
                : {
                      key: "team",
                      icon: <PiUsers />,
                      title: "Find a team",
                      body: "Nobody pitches alone. Start a team and share the ID, or join one a friend has already made.",
                      actions: (
                          <>
                              <Button variant="contained" component={RouterLink} to="/user/team/create">
                                  Create a team
                              </Button>
                              <Button variant="outlined" component={RouterLink} to="/user/team/join">
                                  Join with an ID
                              </Button>
                          </>
                      ),
                  }
        );
    }

    if (isJudge) {
        steps.push({
            key: "judging",
            icon: <PiPresentationChart />,
            title: "Your judging list",
            body: `Teams, rooms and times appear here once the schedule is set. Judging runs ${EVENT.judgingHours}.`,
            actions: (
                <Button variant="contained" component={RouterLink} to="/user/judging">
                    See your assignments
                </Button>
            ),
        });
    }

    if (isCompetitor || isJudge) {
        steps.push({
            key: "checkin",
            icon: <PiQrCode />,
            title: "Check-in code",
            body: `Show this at the desk in ${EVENT.venue}. It also covers lunch and dinner.`,
            actions: (
                <Button variant="outlined" component={RouterLink} to="/user/checkin">
                    Show code
                </Button>
            ),
        });
    }

    return (
        <Layout maxWidth="md">
            <Stack spacing={3}>
                <Stack spacing={1.5}>
                    <Typography variant="h1">
                        {userData?.firstName ? `Hi, ${userData.firstName}` : "Welcome"}
                    </Typography>
                    <EventFacts />
                </Stack>

                {/* organizers first: this page used to build nothing for them */}
                {isAdmin && <AdminHome />}

                {/* The countdown is the page's one large moment: the date is the
                    thing everyone opening this wants to know first. */}
                <Card sx={{ borderRadius: 4 }}>
                    <CardContent sx={{ py: { xs: 3.5, sm: 5 }, "&:last-child": { pb: { xs: 3.5, sm: 5 } } }}>
                        {time ? (
                            <>
                                <Typography variant="h3" component="p" align="center" sx={{ mb: 2 }}>
                                    {EVENT.name} starts in
                                </Typography>
                                <Stack
                                    direction="row"
                                    spacing={{ xs: 1, sm: 3 }}
                                    justifyContent="center"
                                >
                                    <Unit value={time.days} label="days" />
                                    <Unit value={time.hours} label="hours" />
                                    <Unit value={time.minutes} label="min" />
                                    <Unit value={time.seconds} label="sec" />
                                </Stack>
                            </>
                        ) : (
                            <Stack spacing={0.75} alignItems="center">
                                {/* The badge is a claim, so it is only made while it is
                                    true. The countdown reaching zero used to be the only
                                    condition, which meant the site said the event was
                                    happening every day after it for the rest of the year. */}
                                {phase === "during" && <Chip label="In progress" color="success" size="small" />}
                                <Typography variant="h2">{EVENT.name} {EVENT.year}</Typography>
                                <Typography variant="body2">
                                    {phase === "during" ? `Until ${EVENT.hours.split(" - ")[1]} in ${EVENT.venue}` : `${EVENT.dateLabel}, ${EVENT.venue}`}
                                </Typography>
                            </Stack>
                        )}
                    </CardContent>
                </Card>

                {steps.length > 0 && (
                    <Box>
                        <Typography variant="h3" component="h2" sx={{ mb: 1.5 }}>
                            What to do next
                        </Typography>
                        <Card>
                            {steps.map((step, index) => (
                                <Box key={step.key}>
                                    {index > 0 && <Divider sx={{ mx: 2.5 }} />}
                                    <NextStep {...step} />
                                </Box>
                            ))}
                        </Card>
                    </Box>
                )}
            </Stack>
        </Layout>
    );
}

export default Home;
