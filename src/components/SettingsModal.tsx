import { useEffect, useRef, useState } from "react";
import { getDataDir, setDataDir } from "../api";
import {
  getAllowInvalidCert,
  getConflictStrategy,
  getServerUrl,
  setAllowInvalidCert,
  setConflictStrategy,
  setServerUrl,
  type ConflictStrategy,
} from "../settings";
import SelectField, { type FieldOption } from "./SelectField";

// The conflict-resolution strategies, in display order. value is the stored ConflictStrategy.
const STRATEGY_OPTIONS: FieldOption[] = [
  { value: "ask", label: "Ask every time" },
  { value: "server", label: "Always use server" },
  { value: "local", label: "Always use local" },
];

interface Props {
  open: boolean;
  onClose(): void;
}

export default function SettingsModal({ open, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [dirInput, setDirInput] = useState("");
  const [dirError, setDirError] = useState("");
  const [strategy, setStrategy] = useState<ConflictStrategy>("ask");
  const [allowInvalidCert, setAllowInvalidCertState] = useState(false);
  const current = getServerUrl();

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open) {
      setInput(getServerUrl());
      setError("");
      setDirError("");
      setStrategy(getConflictStrategy());
      setAllowInvalidCertState(getAllowInvalidCert());
      getDataDir().then(setDirInput).catch(() => {});
      el.showModal();
    } else {
      el.close();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on native dialog cancel (Escape key).
  function onCancel(e: React.SyntheticEvent) {
    e.preventDefault();
    onClose();
  }

  function onConnect() {
    const url = input.trim();
    if (!url.startsWith("http")) {
      setError("URL must start with http:// or https://");
      return;
    }
    setServerUrl(url);
    onClose();
  }

  function onUseLocal() {
    setServerUrl("");
    onClose();
  }

  async function applyDir(dir: string) {
    try {
      await setDataDir(dir);
      onClose();
    } catch (e) {
      setDirError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <dialog id="settings-modal" ref={dialogRef} onCancel={onCancel}>
      <form id="settings-form" method="dialog" onSubmit={(e) => e.preventDefault()}>
        <h2>Connection</h2>
        <p className="settings-current">
          {current ? `Server: ${current}` : "Local (files)"}
        </p>
        <label>
          Server URL
          <input
            type="text"
            value={input}
            placeholder="http://127.0.0.1:8080"
            onChange={(e) => {
              setInput(e.target.value);
              setError("");
            }}
          />
        </label>
        {error && <p className="modal-error">{error}</p>}
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={allowInvalidCert}
            onChange={(e) => {
              setAllowInvalidCertState(e.target.checked);
              setAllowInvalidCert(e.target.checked);
            }}
          />
          Allow self-signed certificates
        </label>
        <p className="settings-hint">
          Only for a private HTTPS server such as https://ntr.lan. Leave off otherwise.
        </p>
        <div className="modal-actions">
          <button type="button" onClick={onUseLocal}>
            Use local files
          </button>
          <button type="button" className="primary" onClick={onConnect}>
            Connect
          </button>
        </div>


        <h2>Data directory</h2>
        <p className="settings-hint">
          Directory where todo.txt and Note.md are stored locally.
        </p>
        <label>
          Path
          <input
            type="text"
            value={dirInput}
            placeholder="/path/to/your/notes"
            onChange={(e) => {
              setDirInput(e.target.value);
              setDirError("");
            }}
          />
        </label>
        {dirError && <p className="modal-error">{dirError}</p>}
        <div className="modal-actions">
          <button type="button" onClick={() => applyDir("")}>
            Reset to default
          </button>
          <button type="button" className="primary" onClick={() => applyDir(dirInput.trim())}>
            Save path
          </button>
        </div>


        <h2>Conflict resolution</h2>
        <p className="settings-hint">
          When the local files differ from the server on connect.
        </p>
        <label>
          On conflict
          <SelectField
            ariaLabel="On conflict"
            value={strategy}
            options={STRATEGY_OPTIONS}
            onChange={(v) => {
              const s = v as ConflictStrategy;
              setStrategy(s);
              setConflictStrategy(s);
            }}
          />
        </label>
      </form>
    </dialog>
  );
}
