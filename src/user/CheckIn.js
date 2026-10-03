import Layout from "./Layout";
import { useAuth } from "../App";
import { QRCodeCanvas } from "qrcode.react";
import { Box, Card, CardContent, Stack, Typography } from "@mui/material";

// page title
import usePageTitle from "../usePageTitle";

function CheckIn() {
  const { userCredential, userData } = useAuth();
  const uid = userCredential?.user?.uid;

  usePageTitle("Check in");

  return (
    <Layout maxWidth="xs">
      <Stack spacing={2} alignItems="center">
        <Box sx={{ textAlign: "center" }}>
          <Typography variant="h1">Check in</Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            Show this code at the desk
          </Typography>
        </Box>

        <Card sx={{ width: "100%" }}>
          <CardContent
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 1.5,
              py: 3,
              "&:last-child": { pb: 3 },
            }}
          >
            {uid ? (
              <QRCodeCanvas
                value={uid}
                size={220}
                // a canvas is an image to assistive technology; this is what it shows
                role="img"
                aria-label={`Check-in code${userData?.firstName ? ` for ${userData.firstName} ${userData.lastName ?? ""}`.trimEnd() : ""}`}
              />
            ) : (
              <Typography variant="body2">No account found.</Typography>
            )}
            {userData?.firstName && (
              <Typography variant="h5">
                {userData.firstName} {userData.lastName}
              </Typography>
            )}
          </CardContent>
        </Card>
      </Stack>
    </Layout>
  );
}

export default CheckIn;
