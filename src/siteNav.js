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
    ListSubheader,
    Menu,
    MenuItem,
    Stack,
    Toolbar,
    Typography,
} from "@mui/material";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { PiCaretDown, PiList, PiX } from "react-icons/pi";
import { AuthContext, NavDrawerContext } from "./App";
import { auth } from "./firebase";
import { tokens } from "./theme";
import { hasRole } from "./roles";

/**
 * The one bar for the whole site. It used to live under user/ and serve only
 * the signed-in pages, while the two registration forms carried a second bar of
 * their own; they drifted, and someone arriving from the marketing site met a
 * different header depending on which page they landed on.
 *
 * `variant="public"` is the signed-out form: wordmark and a way in, nothing
 * else. Everything below is shared.
 *
 * Primary links stay as plain text. Admin pages collapse into one menu, and the
 * account sits on the far right behind an avatar. The previous version put all
 * ten destinations in a single flat row, each with an icon from a different icon
 * set at the same weight as its label, which read as noise rather than
 * navigation.
 */

// The bar is white, so this is the ink cut of the logo: the original is crimson
// and white on transparency, and on white its bulb and "thon" disappear.
export const LOGO_SRC = `${process.env.PUBLIC_URL ?? ""}/ideathon-logo-ink.png`;
const LOGO_RATIO = 768 / 227;

const PRIMARY = [
    { to: "/user/home", label: "Home" },
    { to: "/user/judging", label: "Judging", roles: ["judge", "admin"] },
    { to: "/user/team", label: "Team", roles: ["competitor"] },
    { to: "/user/checkin", label: "Check in", roles: ["competitor", "judge"] },
];

/**
 * Grouped by what an organizer is doing, not listed alphabetically.
 *
 * A flat list of seven destinations gave no clue that rooms come before a
 * schedule, or that a schedule comes before judges see anything at all. The
 * order of the day is now on the dashboard; these groups are the same idea in
 * the place people actually navigate from.
 *
 * There is deliberately no Schedule entry: the Judging page's own button and
 * the control panel both lead there, and a third door earns nothing.
 */
const ADMIN_GROUPS = [
    {
        id: "people",
        label: "People and teams",
        links: [
            { to: "/user/admin/scan", label: "Scan check-in" },
            { to: "/user/admin/search", label: "Competitors" },
            { to: "/user/admin/judges", label: "Judges" },
            { to: "/user/admin/teams", label: "Teams" },
        ],
    },
    {
        id: "judging",
        label: "Judging",
        links: [
            { to: "/user/admin/judging", label: "Judging progress" },
            { to: "/user/admin/results", label: "Results" },
        ],
    },
    {
        id: "setup",
        label: "Setup and data",
        links: [
            { to: "/user/admin/control", label: "Control panel" },
            { to: "/user/admin/metrics", label: "Registration metrics" },
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

export function Wordmark({ height = 30, to = "/user/home", href }) {
    const image = (
        <Box
            component="img"
            src={LOGO_SRC}
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

/** The underline is pinned to the bottom of the bar, so it reads as a tab. */
function TopLink({ to, label, active }) {
    return (
        <Box
            component={Link}
            to={to}
            sx={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                height: 64,
                px: 1.5,
                fontSize: "1rem",
                fontWeight: 600,
                textDecoration: "none",
                color: active ? tokens.INK : tokens.MUTED,
                "&:hover": { color: tokens.INK },
                "&::after": active
                    ? {
                          content: '""',
                          position: "absolute",
                          left: 12,
                          right: 12,
                          bottom: 0,
                          height: 3,
                          borderRadius: 3,
                          bgcolor: "primary.main",
                      }
                    : undefined,
            }}
        >
            {label}
        </Box>
    );
}

// PaperProps, not slotProps: MUI only taught Menu and Drawer about slotProps
// in 5.15 and this project is on 5.10, so the whole object was being dropped --
// which is why the menus had no outline and the drawer no width.
const menuPaper = { sx: { minWidth: 220, mt: 0.75, py: 0.5 } };

function Nav({ variant = "app" }) {
    const isPublic = variant === "public";
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const context = useContext(AuthContext);
    const userTypes = context?.userTypes ?? [];
    const userData = context?.userData;

    const [adminAnchor, setAdminAnchor] = useState(null);
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
    const adminActive = pathname.startsWith("/user/admin");

    const go = (to) => {
        setAdminAnchor(null);
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
            <AppBar position="sticky">
                <Container maxWidth="lg">
                    <Toolbar disableGutters sx={{ minHeight: { xs: 56, sm: 64 }, gap: 1 }}>
                        <Wordmark height={30} href="https://ideathon.hoohacks.io" />
                        <Box sx={{ flexGrow: 1 }} />
                        {/* both doors, the red one for signing up -- leaving out
                            whichever one the person is already standing in */}
                        {!pathname.startsWith("/login") && (
                            <Button component={Link} to="/login" variant="outlined">
                                Sign in
                            </Button>
                        )}
                        {!onRegistrationPage && (
                            <Button component={Link} to="/ideathon-registration" variant="contained">
                                Register
                            </Button>
                        )}
                    </Toolbar>
                </Container>
            </AppBar>
        );
    }

    return (
        <AppBar position="sticky">
            <Container maxWidth="lg">
                <Toolbar disableGutters sx={{ minHeight: { xs: 56, sm: 64 }, gap: 1 }}>
                    <IconButton
                        onClick={() => setDrawerOpen(true)}
                        sx={{
                            display: { xs: "inline-flex", md: "none" },
                            ml: -1,
                            color: tokens.INK,
                        }}
                        aria-label="Open menu"
                    >
                        <PiList />
                    </IconButton>

                    <Wordmark height={30} />

                    <Box sx={{ display: { xs: "none", md: "flex" }, alignItems: "center", ml: 2 }}>
                        {primary.map((link) => (
                            <TopLink key={link.to} {...link} active={isActive(link.to)} />
                        ))}
                    </Box>

                    <Box sx={{ flexGrow: 1 }} />

                    {isAdmin && (
                        <Button
                            onClick={(e) => setAdminAnchor(e.currentTarget)}
                            endIcon={<PiCaretDown size={14} />}
                            disableRipple
                            sx={{
                                position: "relative",
                                display: { xs: "none", md: "inline-flex" },
                                height: 64,
                                minHeight: 64,
                                borderRadius: 0,
                                px: 1.5,
                                color: adminActive ? tokens.INK : tokens.MUTED,
                                fontWeight: 600,
                                fontSize: "1rem",
                                "&:hover": { bgcolor: "transparent", color: tokens.INK },
                                "&::after": adminActive
                                    ? {
                                          content: '""',
                                          position: "absolute",
                                          left: 12,
                                          right: 12,
                                          bottom: 0,
                                          height: 3,
                                          borderRadius: 3,
                                          bgcolor: "primary.main",
                                      }
                                    : undefined,
                            }}
                        >
                            Admin
                        </Button>
                    )}

                    <IconButton
                        onClick={(e) => setAccountAnchor(e.currentTarget)}
                        sx={{ p: 0.5 }}
                        aria-label="Account"
                    >
                        <Avatar
                            sx={{
                                width: 36,
                                height: 36,
                                fontSize: "0.875rem",
                                fontWeight: 700,
                                bgcolor: tokens.SECONDARY_BG,
                                color: tokens.INK,
                            }}
                        >
                            {initialsOf(userData)}
                        </Avatar>
                    </IconButton>
                </Toolbar>
            </Container>

            {/* Admin pages, collapsed out of the main row */}
            <Menu
                anchorEl={adminAnchor}
                open={Boolean(adminAnchor)}
                onClose={() => setAdminAnchor(null)}
                anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                transformOrigin={{ vertical: "top", horizontal: "right" }}
                PaperProps={menuPaper}
            >
                {ADMIN_GROUPS.flatMap((group, index) => [
                    index > 0 ? <Divider key={`${group.id}-rule`} sx={{ my: 0.5 }} /> : null,
                    <ListSubheader
                        key={group.id}
                        disableSticky
                        sx={{
                            bgcolor: "transparent",
                            lineHeight: 2.25,
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            color: tokens.MUTED,
                        }}
                    >
                        {group.label}
                    </ListSubheader>,
                    ...group.links.map((link) => (
                        <MenuItem
                            key={link.to}
                            selected={pathname.startsWith(link.to)}
                            onClick={() => go(link.to)}
                        >
                            {link.label}
                        </MenuItem>
                    )),
                ])}
            </Menu>

            <Menu
                anchorEl={accountAnchor}
                open={Boolean(accountAnchor)}
                onClose={() => setAccountAnchor(null)}
                anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                transformOrigin={{ vertical: "top", horizontal: "right" }}
                PaperProps={{ ...menuPaper, sx: { ...menuPaper.sx, minWidth: 220 } }}
            >
                <Box sx={{ px: 2, py: 1 }}>
                    <Typography sx={{ fontWeight: 600 }}>{fullName || "Signed in"}</Typography>
                    {userData?.email && (
                        <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
                            {userData.email}
                        </Typography>
                    )}
                </Box>
                <Divider />
                <MenuItem onClick={() => go("/user/profile")}>Profile</MenuItem>
                <MenuItem onClick={logOut}>Log out</MenuItem>
            </Menu>

            {/* Mobile. White, the same as the bar it opens from. */}
            <Drawer
                anchor="left"
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                PaperProps={{
                    sx: { width: 280, bgcolor: tokens.SURFACE, color: tokens.INK },
                }}
            >
                <Stack direction="row" alignItems="center" sx={{ p: 2, pb: 1.5 }}>
                    <Box sx={{ flex: 1 }}>
                        <Wordmark height={28} />
                    </Box>
                    <IconButton
                        onClick={() => setDrawerOpen(false)}
                        aria-label="Close menu"
                        sx={{ color: tokens.INK }}
                    >
                        <PiX />
                    </IconButton>
                </Stack>

                <Box sx={{ px: 1, pb: 1 }}>
                    {primary.map((link) => (
                        <DrawerLink
                            key={link.to}
                            label={link.label}
                            active={isActive(link.to)}
                            onClick={() => go(link.to)}
                        />
                    ))}
                </Box>

                {isAdmin && (
                    <>
                        <Divider />
                        <Box sx={{ px: 1, pb: 1 }}>
                            {ADMIN_GROUPS.map((group) => (
                                <Box key={group.id} sx={{ mb: 0.5 }}>
                                    <Typography
                                        variant="overline"
                                        sx={{ display: "block", px: 1.5, pt: 1.5, pb: 0.5, color: tokens.MUTED, fontWeight: 600, fontSize: "0.8125rem" }}
                                    >
                                        {group.label}
                                    </Typography>
                                    {group.links.map((link) => (
                                        <DrawerLink
                                            key={link.to}
                                            label={link.label}
                                            active={pathname.startsWith(link.to)}
                                            onClick={() => go(link.to)}
                                        />
                                    ))}
                                </Box>
                            ))}
                        </Box>
                    </>
                )}

                <Box sx={{ flexGrow: 1 }} />
                <Divider />
                <Box sx={{ px: 1, py: 1 }}>
                    <DrawerLink label="Profile" onClick={() => go("/user/profile")} />
                    <DrawerLink label="Log out" onClick={logOut} />
                </Box>
            </Drawer>
        </AppBar>
    );
}

function DrawerLink({ label, active = false, onClick }) {
    return (
        <ListItemButton
            onClick={onClick}
            sx={{
                borderRadius: 2,
                color: tokens.INK,
                fontWeight: active ? 700 : 500,
                bgcolor: active ? tokens.SURFACE_CARD : "transparent",
                "&:hover": { bgcolor: tokens.SURFACE_CARD },
            }}
        >
            {label}
        </ListItemButton>
    );
}

export default Nav;
