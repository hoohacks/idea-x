import { Alert, Box, Button, Drawer, Stack, Typography } from "@mui/material";

/**
 * The shell every edit drawer and section dialog shares: a title, a scrolling
 * body, an error line and a save that is disabled until something has actually
 * changed. The dirty check is the point -- an admin who opens a drawer, reads
 * it, and closes it should not produce a log entry.
 */
export default function EditDrawer({
  open,
  title,
  subtitle,
  onClose,
  onSave,
  saving = false,
  error = null,
  dirty = false,
  saveLabel = "Save",
  children,
}) {
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={saving ? undefined : onClose}
      PaperProps={{ sx: { width: { xs: "100%", sm: 420 }, p: 3 } }}
    >
      <Stack spacing={2} sx={{ height: "100%" }}>
        <Box>
          <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>{title}</Typography>
          {subtitle && <Typography variant="body2">{subtitle}</Typography>}
        </Box>

        {error && <Alert severity="error">{error}</Alert>}

        <Stack spacing={2} sx={{ flex: 1, overflowY: "auto" }}>
          {children}
        </Stack>

        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button onClick={onClose} disabled={saving} variant="outlined">
            Cancel
          </Button>
          <Button onClick={onSave} disabled={saving || !dirty} variant="contained">
            {saving ? "Saving…" : saveLabel}
          </Button>
        </Stack>
      </Stack>
    </Drawer>
  );
}
