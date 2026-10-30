import { captureTransport } from "../api";

// The connection-settings control: a small badge for the effective destination,
// [S] for the server or [L] for local files (including fallback). Rendered
// in two layout slots — the desktop title row and the mobile bottom nav — so the mode-badge rule,
// the label, and the click target live here once; the two slots are addressed by their containers
// in CSS (.settings-btn / .bottom-nav .settings-btn), so the component needs no per-slot prop.
export default function SettingsButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="settings-btn" aria-label="Connection settings" onClick={onOpen}>
      {captureTransport().url ? "[S]" : "[L]"}
    </button>
  );
}
