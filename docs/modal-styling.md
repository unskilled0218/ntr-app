# Modal styling

- [Shared appearance](#shared-appearance)
- [Content and sizing](#content-and-sizing)
- [Behavior and verification](#behavior-and-verification)

## Shared appearance

Every app-owned HTML dialog uses `app-modal` in `src/style.css`. Settings is the reference: white surface, 1px border, 8px radius, 1.25rem padding, 1.1rem headings, 0.75rem content/form spacing, muted field labels, and consistent inputs/actions. Nested pickers retain the same base font rather than inheriting smaller label text.

Primary/submit buttons use the accent color; destructive picker actions keep their danger color and selected rows remain highlighted. Keyboard focus stays visible. The shared backdrop dims the underlying page.

## Content and sizing

All dialogs have viewport-bounded width/height, wrapping content/actions, and vertical overflow handling. Standard dialogs cap at 36rem; conflict comparisons can use 40rem and remote updates 48rem, always within viewport gutters. Picker lists and diff/version previews retain their own scrolling.

Remote Task/Note updates remain title-free, with their accessible names and approval controls unchanged. Their sticky action footer uses the same white surface. Settings checkboxes, comparison columns, recovery details, and other specialized content keep their own layout. Native folder choosers and platform dialogs are not restyled.

## Behavior and verification

The shared class changes appearance, not dialog ownership. Existing focus, nested-dialog handling, Escape/backdrop behavior, busy guards, confirmations, and explicit recovery choices remain in their current components. Only open dialogs receive flex layout; closed dialogs remain hidden.

`ModalAppearance.test.tsx` checks template coverage and rendered DOM/CSS appearance. Existing component/lifecycle tests cover interactions. These checks do not replace real-browser desktop/narrow-screen layout, native top-layer focus, or Android device verification; see [development](development.md#checks).
