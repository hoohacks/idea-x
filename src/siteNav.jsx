import { useContext, useState } from "react";
import {
    AppBar,
    Avatar,
    Box,
    Button,
    Container,
    Divider,
    Drawer,
    IconButton,
    ListItemButton,
    Menu,
    MenuItem,
    Stack,
    Toolbar,
    Typography,
} from "@mui/material";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
    PiChalkboardTeacher,
    PiChalkboardTeacherFill,
    PiChartLineUp,
    PiChartLineUpFill,
    PiClipboardText,
    PiClipboardTextFill,
    PiHouse,
    PiHouseFill,
    PiIdentificationBadge,
    PiIdentificationBadgeFill,
    PiList,
    PiListChecks,
    PiListChecksFill,
    PiQrCode,
    PiQrCodeFill,
    PiScan,
    PiScanFill,
    PiSignOut,
    PiSlidersHorizontal,
    PiSlidersHorizontalFill,
    PiStudent,
    PiStudentFill,
    PiTrophy,
    PiTrophyFill,
    PiUser,
    PiUsersThree,
    PiUsersThreeFill,
} from "react-icons/pi";
import { AuthContext, NavDrawerContext } from "./App";
import { auth } from "./firebase";
import { tokens } from "./theme";
import { hasRole } from "./roles";

/**
 * Navigation for the whole site.
 *
 * `variant="public"` is the signed-out bar across the top: wordmark and a way
 * in, nothing else.
 *
 * Signed in, there is no top bar. On a laptop the app has a slim rail down the
 * left edge, and on a phone a tab bar along the bottom, in thumb reach. The
 * top bar it replaced hid the organizer's pages, the ones used most on the
 * day, inside an "Admin" dropdown; in the rail each has its own place, grouped
 * by what an organizer is doing.
 *
 * Both halves render inside one `<header>`, so the page has exactly one banner
 * landmark whichever of them is showing.
 */

// The bar is white, so this is the ink cut of the logo: the original is crimson
// and white on transparency, and on white its bulb and "thon" disappear.
export const LOGO_SRC = `${process.env.PUBLIC_URL ?? ""}/ideathon-logo-ink.png`;
// the original cut, crimson and white, for the one place the bar sits on a
// dark photo rather than on white
const LOGO_ON_DARK_SRC = `${process.env.PUBLIC_URL ?? ""}/ideathon-logo.png`;
const BULB_SRC = `${process.env.PUBLIC_URL ?? ""}/ideathon-bulb.png`;
const LOGO_RATIO = 768 / 227;

/** Width of the desktop rail; `Layout` pads the page by the same amount. */
export const RAIL_WIDTH = 88;
/** Height of the phone tab bar, before the home-indicator inset. */
export const TAB_BAR_HEIGHT = 64;

const PRIMARY = [
    { to: "/user/home", label: "Home", icon: PiHouse, activeIcon: PiHouseFill },
    { to: "/user/judging", label: "Judging", icon: PiClipboardText, activeIcon: PiClipboardTextFill, roles: ["judge", "admin"] },
    { to: "/user/team", label: "Team", icon: PiUsersThree, activeIcon: PiUsersThreeFill, roles: ["competitor"] },
    { to: "/user/checkin", label: "Check in", icon: PiQrCode, activeIcon: PiQrCodeFill, roles: ["competitor", "judge"] },
];

/**
 * Grouped by what an organizer is doing, not listed alphabetically: people
 * arrive, then they are judged, and the setup sits underneath it all.
 *
 * There is deliberately no Schedule entry: the Judging page's own button and
 * the control panel both lead there, and a third door earns nothing.
 * `short` is the label under the rail icon, where there is room for one word.
 */
const ADMIN_GROUPS = [
    {
        id: "people",
        label: "People and teams",
        links: [
            { to: "/user/admin/scan", label: "Scan check-in", short: "Scan", icon: PiScan, activeIcon: PiScanFill },
            { to: "/user/admin/search", label: "Competitors", short: "Competitors", icon: PiStudent, activeIcon: PiStudentFill },
            { to: "/user/admin/judges", label: "Judges", short: "Judges", icon: PiIdentificationBadge, activeIcon: PiIdentificationBadgeFill },
            { to: "/user/admin/mentors", label: "Mentors", short: "Mentors", icon: PiChalkboardTeacher, activeIcon: PiChalkboardTeacherFill },
            { to: "/user/admin/teams", label: "Teams", short: "Teams", icon: PiUsersThree, activeIcon: PiUsersThreeFill },
        ],
    },
    {
        id: "judging",
        label: "Judging",
        links: [
            { to: "/user/admin/judging", label: "Judging progress", short: "Progress", icon: PiListChecks, activeIcon: PiListChecksFill },
            { to: "/user/admin/results", label: "Results", short: "Results", icon: PiTrophy, activeIcon: PiTrophyFill },
        ],
    },
    {
        id: "setup",
        label: "Setup and data",
        links: [
            { to: "/user/admin/control", label: "Control panel", short: "Control", icon: PiSlidersHorizontal, activeIcon: PiSlidersHorizontalFill },
            { to: "/user/admin/metrics", label: "Registration metrics", short: "Metrics", icon: PiChartLineUp, activeIcon: PiChartLineUpFill },
        ],
    },
];

function initialsOf(userData) {
    const first = userData?.firstName?.[0] ?? "";
    const last = userData?.lastName?.[0] ?? "";
    // an account with no name on it still has an email to go by
    const email = userData?.email || auth.currentUser?.email;
    return (first + last || email?.[0] || "?").toUpperCase();
}

export function Wordmark({ height = 30, to = "/user/home", href, onDark = false }) {
    const image = (
        <Box
            component="img"
            src={onDark ? LOGO_ON_DARK_SRC : LOGO_SRC}
            alt="Ideathon"
            sx={{ display: "block", height, width: height * LOGO_RATIO }}
        />
    );
    const sx = { display: "flex", alignItems: "center", lineHeight: 0, flexShrink: 0 };
    return href ? (
        <Box component="a" href={href} sx={sx}>
            {image}
        </Box>
    ) : (
        <Box component={Link} to={to} sx={sx}>
            {image}
        </Box>
    );
}

// PaperProps, not slotProps: MUI only taught Menu and Drawer about slotProps
// in 5.15 and this project is on 5.10, so the whole object would be dropped.
const menuPaper = { sx: { minWidth: 220, py: 0.5 } };

/**
 * One destination: the icon over a one-word label. The current page's icon is
 * the filled version on a cream tile; the rest are outlines in the muted ink,
 * so where you are reads before any word does.
 */
function NavItem({ to, label, icon: Icon, activeIcon: ActiveIcon, active, compact = false }) {
    const Glyph = active ? ActiveIcon : Icon;
    return (
        <Box
            component={Link}
            to={to}
            aria-current={active ? "page" : undefined}
            sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 0.25,
                width: compact ? "100%" : 72,
                height: compact ? "100%" : 56,
                borderRadius: 2,
                textDecoration: "none",
                color: active ? tokens.INK : tokens.MUTED,
                bgcolor: active && !compact ? tokens.SURFACE_CARD : "transparent",
                transition: "background-color 150ms ease, color 150ms ease",
                "&:hover": { color: tokens.INK, bgcolor: compact ? "transparent" : tokens.SURFACE_CARD },
            }}
        >
            <Glyph size={compact ? 24 : 22} aria-hidden />
            <Typography
                component="span"
                sx={{
                    fontSize: "0.6875rem",
                    fontWeight: active ? 700 : 600,
                    lineHeight: 1.2,
                    color: "inherit",
                    whiteSpace: "nowrap",
                }}
            >
                {label}
            </Typography>
        </Box>
    );
}

function Nav({ variant = "app", overlay = false }) {
    const isPublic = variant === "public";
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const context = useContext(AuthContext);
    const userTypes = context?.userTypes ?? [];
    const userData = context?.userData;

    const [accountAnchor, setAccountAnchor] = useState(null);

    // Above the route, so a tap that lands while the page is still resolving a
    // role is not thrown away with the nav that received it. See the note on
    // NavDrawerContext. The local fallback is for render tests, which mount the
    // nav on its own.
    const hoisted = useContext(NavDrawerContext);
    const [localDrawerOpen, setLocalDrawerOpen] = useState(false);
    const drawerOpen = hoisted ? hoisted.open : localDrawerOpen;
    const setDrawerOpen = hoisted ? hoisted.setOpen : setLocalDrawerOpen;

    const isAdmin = hasRole(userTypes, "admin");
    const primary = PRIMARY.filter(
        (link) => !link.roles || link.roles.some((role) => hasRole(userTypes, role))
    );

    const isActive = (to) =>
        to === "/user/home" ? pathname === to : pathname.startsWith(to);

    const go = (to) => {
        setAccountAnchor(null);
        setDrawerOpen(false);
        navigate(to);
    };

    const logOut = async () => {
        setAccountAnchor(null);
        setDrawerOpen(false);
        try {
            await auth.signOut();
            navigate("/login", { replace: true });
        } catch (error) {
            console.error("Error during logout:", error);
        }
    };

    const fullName = [userData?.firstName, userData?.lastName].filter(Boolean).join(" ");

    const onRegistrationPage =
        pathname === "/" ||
        pathname.startsWith("/ideathon-registration") ||
        pathname.startsWith("/judge-registration");

    if (isPublic) {
        return (
            <AppBar
                position={overlay ? "absolute" : "sticky"}
                // over the sign-in photos the bar has no ground of its own:
                // the photos run up behind it rather than stopping at a white strip
                sx={overlay ? { bgcolor: "transparent", borderBottom: "none" } : undefined}
            >
                {/* Over the photos nothing else uses the page's content column,
                    so the wordmark sits in the window's own corner instead of
                    floating a column's width in from it. */}
                <Container
                    maxWidth={overlay ? false : "lg"}
                    sx={overlay ? { px: { xs: 2.5, sm: 4 } } : undefined}
                >
                    <Toolbar
                        disableGutters
                        sx={{ minHeight: { xs: 56, sm: 64 }, gap: 1, ...(overlay && { pt: { sm: 1 } }) }}
                    >
                        {/* Over the sign-in photos the bar is only the way back
                            to the event site: the card below already carries
                            the mark and its own link to the other door, and a
                            second red button up here pulled against Sign in. */}
                        <Wordmark
                            height={overlay ? 24 : 30}
                            href="https://ideathon.hoohacks.io"
                            onDark={overlay}
                        />
                        <Box sx={{ flexGrow: 1 }} />
                        {/* both doors, the red one for signing up -- leaving out
                            whichever one the person is already standing in */}
                        {!overlay && !pathname.startsWith("/login") && (
                            <Button component={Link} to="/login" variant="outlined">
                                Sign in
                            </Button>
                        )}
                        {!overlay && !onRegistrationPage && (
                            <Button component={Link} to="/ideathon-registration" variant="contained">
                                Register
                            </Button>
                        )}
                    </Toolbar>
                </Container>
            </AppBar>
        );
    }

    // On a phone the tab bar has room for four: the person's own pages, and
    // for an organizer the scanner they will be holding at the door. Everything
    // else, and the account, is one tap away under Menu.
    const tabs = isAdmin
        ? [...primary, ADMIN_GROUPS[0].links[0]].slice(0, 3)
        : primary.slice(0, 3);

    const avatar = (size) => (
        <Avatar
            sx={{
                width: size,
                height: size,
                fontSize: size > 34 ? "0.875rem" : "0.8125rem",
                fontWeight: 700,
                bgcolor: tokens.SECONDARY_BG,
                color: tokens.INK,
            }}
        >
            {initialsOf(userData)}
        </Avatar>
    );

    return (
        <Box component="header">
            {/* ---- desktop: the rail ---- */}
            <Box
                component="nav"
                aria-label="Main"
                sx={{
                    display: { xs: "none", md: "flex" },
                    position: "fixed",
                    top: 0,
                    bottom: 0,
                    left: 0,
                    zIndex: (theme) => theme.zIndex.appBar,
                    width: RAIL_WIDTH,
                    flexDirection: "column",
                    alignItems: "center",
                    bgcolor: tokens.SURFACE,
                    borderRight: `1px solid ${tokens.LINE}`,
                    py: 2,
                }}
            >
                <Box
                    component={Link}
                    to="/user/home"
                    aria-label="Ideathon home"
                    sx={{ display: "grid", placeItems: "center", width: 48, height: 48, mb: 1.5, borderRadius: 2 }}
                >
                    <Box component="img" src={BULB_SRC} alt="" sx={{ height: 34, width: "auto", display: "block" }} />
                </Box>

                {/* scrolls on a short window rather than pushing the account
                    button off the bottom */}
                <Stack
                    alignItems="center"
                    sx={{ flex: 1, gap: 0.5, overflowY: "auto", overflowX: "hidden", width: "100%", px: 1 }}
                >
                    {primary.map((link) => (
                        <NavItem key={link.to} {...link} active={isActive(link.to)} />
                    ))}

                    {isAdmin &&
                        ADMIN_GROUPS.map((group) => (
                            <Stack key={group.id} alignItems="center" sx={{ gap: 0.5 }} role="group" aria-label={group.label}>
                                <Box aria-hidden sx={{ width: 32, height: "1px", bgcolor: tokens.LINE, my: 0.75 }} />
                                {group.links.map((link) => (
                                    <NavItem
                                        key={link.to}
                                        {...link}
                                        label={link.short}
                                        active={pathname.startsWith(link.to)}
                                    />
                                ))}
                            </Stack>
                        ))}
                </Stack>

                <IconButton
                    onClick={(e) => setAccountAnchor(e.currentTarget)}
                    aria-label="Account"
                    sx={{ mt: 1, p: 0.5 }}
                >
                    {avatar(40)}
                </IconButton>
            </Box>

            <Menu
                anchorEl={accountAnchor}
                open={Boolean(accountAnchor)}
                onClose={() => setAccountAnchor(null)}
                anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                transformOrigin={{ vertical: "bottom", horizontal: "left" }}
                PaperProps={{ ...menuPaper, sx: { ...menuPaper.sx, ml: 1.5 } }}
            >
                <Box sx={{ px: 2, py: 1 }}>
                    <Typography sx={{ fontWeight: 700, color: tokens.INK }}>{fullName || "Signed in"}</Typography>
                    {userData?.email && (
                        <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
                            {userData.email}
                        </Typography>
                    )}
                </Box>
                <Divider sx={{ my: 0.5 }} />
                <MenuItem onClick={() => go("/user/profile")}>Profile</MenuItem>
                <MenuItem onClick={logOut}>Log out</MenuItem>
            </Menu>

            {/* ---- phone: the tab bar ---- */}
            <Box
                component="nav"
                aria-label="Tabs"
                sx={{
                    display: { xs: "grid", md: "none" },
                    gridTemplateColumns: `repeat(${tabs.length + 1}, 1fr)`,
                    position: "fixed",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    zIndex: (theme) => theme.zIndex.appBar,
                    height: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom, 0px))`,
                    pb: "env(safe-area-inset-bottom, 0px)",
                    bgcolor: tokens.SURFACE,
                    borderTop: `1px solid ${tokens.LINE}`,
                }}
            >
                {tabs.map((link) => (
                    <NavItem
                        key={link.to}
                        {...link}
                        label={link.short ?? link.label}
                        active={isActive(link.to)}
                        compact
                    />
                ))}
                <Box
                    component="button"
                    type="button"
                    onClick={() => setDrawerOpen(true)}
                    aria-label="Open menu"
                    sx={{
                        all: "unset",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 0.25,
                        color: drawerOpen ? tokens.INK : tokens.MUTED,
                        "&:focus-visible": { outline: `2px solid ${tokens.FOCUS}`, outlineOffset: -4, borderRadius: 2 },
                    }}
                >
                    <PiList size={24} aria-hidden />
                    <Typography component="span" sx={{ fontSize: "0.6875rem", fontWeight: 600, color: "inherit" }}>
                        Menu
                    </Typography>
                </Box>
            </Box>

            {/* The menu sheet: account, and for an organizer every page the tab
                bar has no room for. Rises from the tab bar that opened it. */}
            <Drawer
                anchor="bottom"
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                PaperProps={{
                    sx: {
                        borderTopLeftRadius: 32,
                        borderTopRightRadius: 32,
                        maxHeight: "85dvh",
                        pb: "env(safe-area-inset-bottom, 0px)",
                    },
                }}
            >
                <Box aria-hidden sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: tokens.SECONDARY_BG, mx: "auto", mt: 1.25 }} />
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 2.5, pt: 2, pb: 1.5 }}>
                    {avatar(44)}
                    <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 700, color: tokens.INK }}>{fullName || "Signed in"}</Typography>
                        {userData?.email && (
                            <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
                                {userData.email}
                            </Typography>
                        )}
                    </Box>
                </Stack>

                <Box sx={{ px: 1.5, pb: 1, overflowY: "auto" }}>
                    {isAdmin &&
                        ADMIN_GROUPS.map((group) => (
                            <Box key={group.id} sx={{ mb: 0.5 }}>
                                <Typography
                                    variant="body2"
                                    sx={{ display: "block", px: 1, pt: 1.5, pb: 0.5, fontWeight: 600, fontSize: "0.8125rem" }}
                                >
                                    {group.label}
                                </Typography>
                                {group.links.map((link) => (
                                    <SheetLink
                                        key={link.to}
                                        label={link.label}
                                        icon={pathname.startsWith(link.to) ? link.activeIcon : link.icon}
                                        active={pathname.startsWith(link.to)}
                                        onClick={() => go(link.to)}
                                    />
                                ))}
                            </Box>
                        ))}

                    <Divider sx={{ my: 1 }} />
                    <SheetLink label="Profile" icon={PiUser} onClick={() => go("/user/profile")} />
                    <SheetLink label="Log out" icon={PiSignOut} onClick={logOut} />
                </Box>
            </Drawer>
        </Box>
    );
}

function SheetLink({ label, icon: Icon, active = false, onClick }) {
    return (
        <ListItemButton
            onClick={onClick}
            sx={{
                borderRadius: 2,
                gap: 1.5,
                py: 1.25,
                color: tokens.INK,
                fontWeight: active ? 700 : 500,
                bgcolor: active ? tokens.SURFACE_CARD : "transparent",
                "&:hover": { bgcolor: tokens.SURFACE_CARD },
            }}
        >
            {Icon && <Icon size={22} aria-hidden />}
            {label}
        </ListItemButton>
    );
}

export default Nav;
