import { useMemo, useState } from "react";
import type { Offer } from "../lib/remoteUpdates";
import { fullEvidence, previewPage, remoteDiff, START, type Cursor } from "../lib/remoteDiff";

export default function RemoteDiffPreview({ offer }: { offer: Offer }) {
  const document = useMemo(() => remoteDiff(offer), [offer]);
  const [view, setView] = useState<{ offer: Offer; mode: "diff" | "accepted" | "incoming" }>({ offer, mode: "diff" });
  const mode = view.offer === offer ? view.mode : "diff";
  const sections = useMemo(() => mode === "diff" ? document.sections : fullEvidence(offer, mode), [offer, mode, document]);
  const [navigation, setNavigation] = useState<{ offer: Offer; mode: string; cursors: Cursor[] }>({ offer, mode, cursors: [START] });
  const cursors = navigation.offer === offer && navigation.mode === mode ? navigation.cursors : [START];
  const page = previewPage(sections, cursors[cursors.length - 1]);
  return <section aria-label="Remote change preview">
    <p>Saved accepted content → Incoming content. Unsaved edits are not compared.</p>
    <p>{document.summary}</p>
    <p>− Removed from accepted; + Added from incoming; = Unchanged context.</p>
    <div className="preview-navigation" aria-label="Preview view">
      {(["diff", "accepted", "incoming"] as const).map((choice) => <button type="button" key={choice} aria-pressed={mode === choice} onClick={() => { setView({ offer, mode: choice }); setNavigation({ offer, mode: choice, cursors: [START] }); }}>{choice === "diff" ? "Diff" : choice === "accepted" ? "Accepted" : "Incoming"}</button>)}
    </div>
    <div className="remote-preview" tabIndex={0} aria-label="Change details">
      {page.fragments.map((fragment, index) => <div key={index} className={`diff-${fragment.kind}`}><span aria-label={fragment.kind}>{fragment.kind === "added" ? "+ " : fragment.kind === "removed" ? "− " : "= "}</span>{fragment.text}</div>)}
      {!sections.length && <p>No task content changes.</p>}
      {!!sections.length && !page.characters && <p>Empty content.</p>}
    </div>
    <div className="preview-navigation">
      <button type="button" disabled={cursors.length === 1} onClick={() => setNavigation({ offer, mode, cursors: cursors.slice(0, -1) })}>Previous changes</button>
      <span>Page {cursors.length}; {page.remaining} characters remaining{page.next ? "; continued on next page (long lines may be split)" : "; end of preview"}.</span>
      <button type="button" disabled={!page.next} onClick={() => { if (page.next) setNavigation({ offer, mode, cursors: [...cursors, page.next] }); }}>Next changes</button>
    </div>
  </section>;
}
