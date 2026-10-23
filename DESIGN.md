# Design guidelines

These rules apply to every UI change in this repo. They exist because the
dashboard is a fast, keyboard-driven tool that has to work for people who zoom
their browser, use a screen reader, prefer high contrast, or navigate without a
mouse.

When a rule here conflicts with a one-off visual idea, the rule wins. If a real
exception is needed, keep it local and comment why.

## 1. Units: `rem` and `em` by default

Browsers scale `rem` and `em` with the user's text settings. Pixels do not scale
with text-only zoom, so they are the wrong default for a UI that must remain
usable at 200% text size.

### Use `rem` for

- font sizes
- padding, margins and gaps
- widths, min/max widths, heights and min-heights
- border radii
- icon boxes and layout spacing

### Use `em` for

- component-relative spacing that should follow the component's own font size
  (for example the padding inside a pill or the gap between an icon and its
  label)
- media queries and container queries, where `em` is based on the browser's
  initial font size and therefore follows zoom
- `letter-spacing`, already expressed in `em`

### `px` is allowed only for

- hairline borders: `border: 1px solid var(--border)`
- shadows, glows and their offsets/blur/spread
- focus-ring strokes and offsets, when a hairline visual stroke is intended

Everything that participates in layout or text scaling uses `rem` or `em`.

### Conversion reference

`1rem` equals the browser's default font size (normally `16px`), but never
assume that in code or comments.

| Instead of | Use |
| --- | --- |
| `font-size: 14px` | `font-size: 0.875rem` |
| `padding: 12px 22px` | `padding: 0.75rem 1.375rem` |
| `gap: 24px` | `gap: 1.5rem` |
| `max-width: 1180px` | `max-width: 73.75rem` |
| `@media (min-width: 1100px)` | `@media (min-width: 68.75em)` |
| `@container (max-width: 640px)` | `@container (max-width: 40em)` |
| `border-radius: 9px` | `border-radius: 0.5625rem` |
| `border: 1px solid` | unchanged |
| `box-shadow: 0 24px 80px` | unchanged |

### Rules

- Never set a pixel root font size (`html { font-size: 10px }`) or use
  `font-size: 62.5%` to make `rem` math easier. That breaks user font settings.
- Do not use `vw` or `vh` for text sizing. Viewport units fight zoom and reflow.
- Prefer logical properties (`margin-inline`, `padding-block`, `inset-inline`)
  so the layout can support right-to-left languages.
- New code must not add pixel sizing. When editing an existing rule, convert
  that rule to `rem`/`em` if it is low risk. Do not mass-rewrite unrelated CSS in
  the same change.

## 2. Accessibility is part of the design

Accessibility is not a later pass. It is part of the component's definition of
done.

### Semantics and names

- Use native elements first: `button`, `a`, `nav`, `main`, `section`, `ul`,
  `li`, and heading levels in order.
- Every interactive control has an accessible name. Prefer a visible label. An
  icon-only button needs `aria-label`; a decorative icon needs
  `aria-hidden="true"`.
- `data-testid` is a test hook, never an accessible name.
- Use the right state attribute: `aria-current` for the active view,
  `aria-pressed` for toggles, `aria-expanded` for disclosures, `aria-busy` for
  loading regions.
- Use landmarks and headings so screen-reader users can jump between the queue,
  filters and settings.
- Status, warning and error text belongs in a live region
  (`role="status"` or `role="alert"`) when it appears without a page change.
  Do not announce every poll; announce changes that need action.

### Keyboard

- Everything that works with a mouse works with a keyboard.
- Never remove focus indication without a replacement. Use `:focus-visible`
  with a ring that has at least 3:1 contrast against its adjacent colors.
- DOM order must match visual order. On the wide two-column layout, the review
  queue comes before the authored PRs; do not use CSS to reorder them.
- Global shortcuts must not fire while the user is typing in an `input`,
  `textarea`, `select` or `contenteditable` element.
- Scope shortcuts to the active column. When two lists are visible, `j`/`k`
  moves one list, not both.
- Provide a visible focus/active state for the column that owns the shortcuts.
- `Escape` closes overlays. `Enter`/`Space` activate buttons. Arrow keys are
  used only where the interaction implies them.
- No keyboard traps. When a modal or drawer closes, return focus to the control
  that opened it.

### Color and contrast

- Meet WCAG 2.2 AA: at least 4.5:1 for normal text, 3:1 for large text
  (24px/1.5rem, or 18.66px/1.166rem bold), and 3:1 for UI component boundaries
  and meaningful graphics.
- Use the theme tokens, not hard-coded colors. Check both the dark theme
  (`:root`) and the light theme (`[data-theme="light"]`).
- Never use color alone to communicate state. Approval, CI, conflicts, stale
  data and errors need a label, icon or pattern as well as a color.
- Focus rings, selected rows and borders must remain visible in both themes and
  in forced-colors mode.

### Touch, zoom and reflow

- Touch targets are at least `1.5rem` (24px) minimum; aim for `2.75rem` (44px)
  for primary actions on touch screens.
- Use padding, not a fixed height, so controls grow with larger text.
- Support 200% browser zoom and 200% text-only zoom without losing content or
  function.
- Reflow to a 320 CSS px wide viewport without horizontal scrolling, except for
  intentionally scrollable data tables or code blocks.
- Do not put fixed heights on text containers. Use `min-height`.
- Long PR titles, URLs, labels and branch names must wrap or truncate with an
  accessible full value. Use `overflow-wrap: anywhere` rather than clipping.
- Never disable pinch zoom or add `user-scalable=no`.

### Motion

- Respect `prefers-reduced-motion: reduce`: remove non-essential transitions,
  animations, parallax and auto-playing movement.
- Keep UI feedback transitions short (about 200ms or less). Never flash more
  than three times per second.
- Loading indicators need text or an accessible label. A skeleton alone is not
  an accessible loading state.

## 3. Layout and responsive behavior

- Build mobile-first and add breakpoints where the content needs them, not at
  device names.
- Write breakpoints in `em`, for example
  `@media (min-width: 68.75em)` for the two-column layout.
- Use CSS grid or flexbox with `gap` for spacing. Do not use margins as a layout
  system.
- Put `min-width: 0` on grid/flex children that contain long text, and use
  `minmax(0, 1fr)` so long content cannot force overflow.
- Use container queries for component-level responsiveness. Name the container
  (`container-name`) and use `em` for its threshold.
- The dashboard has one DOM order: review queue, then authored PRs. On narrow
  screens show one at a time with tabs; at `68.75em` and above show both columns
  with headings. Keep the tab semantics and the column headings accessible.
- Sticky headers must not cover focused content. Add `scroll-margin-top` in
  `rem` where needed.
- Avoid absolute positioning for layout. Use it only for decoration or overlays
  that do not affect reading order.

## 4. Components and tokens

- Reuse the CSS variables in `src/styles.css` for color, radius, shadow and
  fonts. Add a token when a value is repeated or needs theme variants.
- Spacing scale (in `rem`): `0.25`, `0.5`, `0.75`, `1`, `1.5`, `2`, `3`.
- Type scale (in `rem`): `0.6875`, `0.75`, `0.8125`, `0.875`, `1`, `1.25`.
- Radii are in `rem`; use `999rem` for a pill rather than a pixel value.
- Pills and badges use `em` padding so they grow with their label text.
- Icons use `width: 1em; height: 1em; flex: none` so they follow the text size.
- Buttons use `min-height` in `rem` and padding in `em`. Hover is an
  enhancement, never the only way to discover an action.
- Links must be distinguishable by more than color. Use an underline on hover
  and focus, and keep the contrast AA.
- Forms need visible labels, not placeholder-only labels. Connect hints and
  errors with `aria-describedby`, and put the error text next to the field.
- Empty states need a heading, an explanation and, where useful, an action. “No
  data” alone is not enough.
- Loading states preserve layout and use `aria-busy`. Errors are actionable and
  keep cached data on screen.
- Never add a new network destination or send the GitHub token anywhere except
  the configured GraphQL host. That is a security rule as well as a design rule.

## 5. Review checklist

Before opening a UI pull request:

- [ ] New or changed sizing uses `rem`/`em`. `px` is limited to hairlines,
      shadows and focus strokes.
- [ ] No pixel root font size and no `user-scalable=no`.
- [ ] Keyboard path works; focus is visible; shortcuts ignore form fields and
      are scoped to one list.
- [ ] Every control has an accessible name; headings and landmarks make sense.
- [ ] Contrast passes AA in both dark and light themes; state is not color-only.
- [ ] 200% zoom, 200% text-only zoom and 320px reflow were considered.
- [ ] Touch targets are at least `1.5rem`, with `2.75rem` for primary touch
      actions.
- [ ] `prefers-reduced-motion` is honored.
- [ ] Tests are updated and `npm run check` plus `npm run factory -- eval` pass.
- [ ] The token still lives only in `localStorage` and is sent only to the
      configured GitHub GraphQL host.

## 6. Exceptions and migration

- If `px` is genuinely required, keep the scope as small as possible and add a
  comment explaining why.
- Existing pixel debt is migrated incrementally: convert the rule you are
  already touching. Do not mix a mass unit rewrite into an unrelated feature.
- Shadows, `1px` borders and focus-ring strokes are the standing exceptions.
- When unsure, use `rem` for global layout and typography, and `em` for sizing
  that should follow a component's own text.
