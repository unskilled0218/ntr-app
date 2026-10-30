import { useId, useMemo, useState } from "react";
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
  const descriptionId = useId();
  return <section aria-label="Remote change preview">
    <div className="preview-navigation" aria-label="Preview view">
      {(["diff", "accepted", "incoming"] as const).map((choice) => <button type="button" key={choice} aria-pressed={mode === choice} onClick={() => { setView({ offer, mode: choice }); setNavigation({ offer, mode: choice, cursors: [START] }); }}>{choice === "diff" ? "Diff" : choice === "accepted" ? "Accepted" : "Incoming"}</button>)}
    </div>
    <span className="sr-only" id={descriptionId}>
      Saved accepted content versus incoming content, not unsaved edits. − Removed; + Added; = Unchanged.
      {document.fallback && " Large change shown as accepted/incoming blocks."}
      {page.remaining} characters remaining; {page.next ? "continued on next page; long lines may be split" : "end of preview"}.
    </span>
    <div className="remote-preview" tabIndex={0} aria-label="Change details" aria-describedby={descriptionId}>
      {page.fragments.map((fragment, index) => <div key={index} className={`diff-${fragment.kind}`} role={fragment.kind === "meta" ? "note" : undefined} aria-label={fragment.label}>
        {fragment.kind !== "meta" && <span aria-label={fragment.kind}>{fragment.kind === "added" ? "+ " : fragment.kind === "removed" ? "− " : "= "}</span>}{fragment.text}
      </div>)}
      {!page.characters && <span role="img" aria-label={mode === "diff" ? "No content changes" : "Empty content"}>∅</span>}
    </div>
    {(page.next || cursors.length > 1) && <div className="preview-navigation" aria-label="Preview pages">
      <button type="button" disabled={cursors.length === 1} onClick={() => setNavigation({ offer, mode, cursors: cursors.slice(0, -1) })}>Previous</button>
      <span role="status" aria-label={`Page ${cursors.length}`}>{cursors.length}</span>
      <button type="button" disabled={!page.next} onClick={() => { if (page.next) setNavigation({ offer, mode, cursors: [...cursors, page.next] }); }}>Next</button>
    </div>}
  </section>;
}
