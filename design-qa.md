# Design QA

**Comparison Target**

- Source visual truth: `/var/folders/94/d79ngbf17ds3c5f7zz34dt2r0000gq/T/TemporaryItems/NSIRD_screencaptureui_5ptPS9/스크린샷 2026-07-27 10.02.49.png`
- Implementation URL: `http://127.0.0.1:8901/`
- Default closed screenshot: `output/playwright/weekday-collapse/default-closed-viewport.png`
- Open viewport screenshot: `output/playwright/weekday-collapse/open-viewport.png`
- Open panel screenshot: `output/playwright/weekday-collapse/open-panel.png`
- Combined comparison: `output/playwright/weekday-collapse/comparison-open.png`
- Main browser viewport: 1758 x 900 CSS px
- Focused comparison viewport: 1384 x 900 CSS px
- State: the weekday table is closed by default and opens from its title row

**Density Normalization**

- Source: 2690 x 664 px at Retina density, normalized to 1345 x 332 CSS-equivalent px.
- Implementation panel: 1329 x 322 px at Playwright `scale: css`.
- Implementation comparison frame: padded to 1345 x 332 px without scaling.
- Combined comparison: 2690 x 332 px, source on the left and implementation on the right.

**Full-view Comparison Evidence**

- `default-closed-viewport.png` shows only the compact `요일별 성과` title row between the performance table and chart.
- `open-viewport.png` shows the expanded table without overlap, clipping, or horizontal overflow.
- The new header text is visible as `Brand New Music - 유튜브뮤직 음원 모니터링`.

**Focused Region Comparison Evidence**

- `comparison-open.png` places the source and open implementation in one normalized image.
- Table columns, row order, numeric alignment, panel radius, typography, dividers, and spacing remain faithful to the source.
- The native blue disclosure marker is the intentional addition that communicates open and closed state.

**Required Fidelity Surfaces**

- Fonts and typography: existing SF Pro/system stack, weights, sizes, line heights, and numeric alignment match the source.
- Spacing and layout rhythm: open table dimensions remain within 16 px of the normalized source height and preserve the existing panel rhythm.
- Colors and visual tokens: existing white panel, gray dividers, muted secondary text, and blue accent are unchanged.
- Image quality and asset fidelity: this component contains no image assets; no placeholders or generated assets were introduced.
- Copy and content: weekday table copy is unchanged, and both the visible header and browser title use the approved new brand text.

**Findings**

- No actionable P0, P1, or P2 findings.
- No residual P3 polish item was required.

**Comparison History**

- Initial comparison: source and implementation matched after density normalization; no visual fix iteration was required.
- Intentional difference: the native disclosure marker was added to expose the requested open and closed behavior.
- Post-implementation evidence: `comparison-open.png`, `default-closed-viewport.png`, and `open-viewport.png`.

**Primary Interactions Tested**

- Initial load: `details.open` is `false` and the weekday table is not visible.
- Mouse click: the title row opens the table and exposes all seven weekday rows.
- Sorting: `수집 건수` changes to descending order and keeps the existing `aria-sort` behavior.
- Mouse close: clicking the title row again closes the table.
- Keyboard: pressing Enter while the summary is focused opens the table.
- Reload: the panel returns to the default closed state.
- Branding: browser title and visible header both match the approved text.

**Console Errors Checked**

- Playwright console result: 0 errors and 0 warnings.

final result: passed
