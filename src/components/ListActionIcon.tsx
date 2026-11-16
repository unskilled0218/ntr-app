import type { ListAction } from "../lib/listActions";

export default function ListActionIcon({ action }: { action: ListAction }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {action === "rename" ? <><path d="m14 5 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14z" /></> : <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></>}
  </svg>;
}
