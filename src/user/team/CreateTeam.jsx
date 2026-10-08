import { useState, useContext, useEffect } from "react";
import Layout from "../Layout.jsx";
import { useNavigate, Link as RouterLink } from "react-router-dom";
import { AuthContext } from "../../App";
import { createTeam as createTeamRecord } from "./teamMembership.js";
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

// page title
import usePageTitle from "../../usePageTitle";

function CreateTeam() {
  const navigate = useNavigate();
  const { refreshUserData, userData } = useContext(AuthContext);
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  usePageTitle("Create a team");

  // If user data already has a teamId, redirect to team page
  useEffect(() => {
    if (userData && userData.teamId) navigate("/user/team");
  }, [userData, navigate]);

  

  const createTeam = async (teamName) => {
    // one multi-path update, so the team and the competitor's teamId cannot
    // land separately and leave the person on a team the app will not route to
    const result = await createTeamRecord(teamName);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await refreshUserData();
    return navigate("/user/team");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy || !inputValue.trim()) return;
    setBusy(true);
    setError("");
    try {
      await createTeam(inputValue.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout maxWidth="xs">
      <Typography variant="h1" gutterBottom>
        Create a team
      </Typography>

      <Card>
        <CardContent sx={{ p: 3, "&:last-child": { pb: 3 } }}>
          <Box component="form" onSubmit={handleSubmit}>
            <Stack spacing={2}>
              <TextField
                label="Team name"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                helperText="Your teammates join with the ID you get next."
                autoFocus
                fullWidth
              />
              {error && <Alert severity="error">{error}</Alert>}
              <Button type="submit" variant="contained" disabled={busy || !inputValue.trim()}>
                {busy ? "Creating…" : "Create team"}
              </Button>
              <Link
                component={RouterLink}
                to="/user/team/join"
                variant="body2"
                sx={{ textAlign: "center" }}
              >
                Join an existing team instead
              </Link>
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Layout>
  );
}

export default CreateTeam;
