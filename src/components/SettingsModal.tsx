import { useEffect, useRef, useState } from "react";
import { getDataDir, getStorageKind, pickDataDir, setDataDir, reconnectTransport, usingLocalFallback, type StorageKind } from "../api";
import {
  getAllowInvalidCert,
  getCompactUi,
  getConflictStrategy,
  getServerUrl,
  getStartupView,
  setAllowInvalidCert,
  setCompactUi,
  setConflictStrategy,
  setServerUrl,
  setStartupView,
  type ConflictStrategy,
  type StartupView,
} from "../settings";
import SelectField, { type FieldOption } from "./SelectField";
import { useBackdropClose } from "./useBackdropClose";
import { ownDialogEvent } from "./dialogEvents";

// The conflict-resolution strategies, in display order. value is the stored ConflictStrategy.
const STRATEGY_OPTIONS: FieldOption[] = [
  { value: "ask", label: "Ask every time" },
  { value: "server", label: "Always use server" },
  { value: "local", label: "Always use local" },
];

const STARTUP_VIEW_OPTIONS: FieldOption[] = [
  { value: "note", label: "Note" },
  { value: "todo", label: "Todo" },
  { value: "last", label: "Last opened" },
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
  const [storageKind, setStorageKind] = useState<StorageKind>("path");
  const [strategy, setStrategy] = useState<ConflictStrategy>("ask");
  const [allowInvalidCert, setAllowInvalidCertState] = useState(false);
  const [compact, setCompactState] = useState(false);
  const [startupView, setStartupViewState] = useState<StartupView>("note");
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
      setCompactState(getCompactUi());
      setStartupViewState(getStartupView());
      Promise.all([getDataDir(), getStorageKind()])
        .then(([dir, kind]) => {
          setDirInput(dir);
          setStorageKind(kind);
        })
        .catch(() => {});
      el.showModal();
    } else {
      el.close();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on native dialog cancel (Escape key).
  function onCancel(e: React.SyntheticEvent<HTMLDialogElement>) {
    if (!ownDialogEvent(e)) return;
    e.preventDefault();
    onClose();
  }

  // Click outside the box closes it via onClose (not a raw dialog.close()), so the parent's `open`
  // state — the source of truth here — stays in step, exactly as Escape does.
  useBackdropClose(dialogRef, onClose);

  function onConnect() {
    const url = input.trim();
    if (!url.startsWith("http")) {
      setError("URL must start with http:// or https://");
      return;
    }
    setServerUrl(url);
    reconnectTransport();
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

  async function onChooseDir() {
    try {
      setDirError("");
      const picked = await pickDataDir();
      if (picked == null) return;
      if (storageKind === "saf") {
        await applyDir(picked);
      } else {
        setDirInput(picked);
      }
    } catch (e) {
      setDirError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <dialog id="settings-modal" ref={dialogRef} onCancel={onCancel} onClose={ownDialogEvent}>
      <form id="settings-form" method="dialog" onSubmit={(e) => e.preventDefault()}>
        <h2>Connection</h2>
        <p className="settings-current">
          {usingLocalFallback() ? `Local files (server unavailable): ${current}` : current ? `Server: ${current}` : "Local (files)"}
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
        {storageKind === "saf" ? (
          <label>
            Folder
            <span className="settings-readonly-value">{dirInput}</span>
          </label>
        ) : (
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
        )}
        {dirError && <p className="modal-error">{dirError}</p>}
        <div className="modal-actions">
          <button type="button" onClick={() => applyDir("")}>
            Reset to default
          </button>
          <button type="button" onClick={onChooseDir}>
            Choose folder
          </button>
          {storageKind === "path" && (
            <button type="button" className="primary" onClick={() => applyDir(dirInput.trim())}>
              Save path
            </button>
          )}
        </div>


        <h2>Display</h2>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={compact}
            onChange={(e) => {
              setCompactState(e.target.checked);
              setCompactUi(e.target.checked);
            }}
          />
          Compact controls
        </label>
        <p className="settings-hint">
          Collapse the task fields and filters into "Options" buttons.
        </p>
        <label>
          Startup page
          <SelectField
            ariaLabel="Startup page"
            value={startupView}
            options={STARTUP_VIEW_OPTIONS}
            onChange={(v) => {
              const s = v as StartupView;
              setStartupViewState(s);
              setStartupView(s);
            }}
          />
        </label>
        <p className="settings-hint">
          Which pane opens first on mobile. Desktop always shows both.
        </p>


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
