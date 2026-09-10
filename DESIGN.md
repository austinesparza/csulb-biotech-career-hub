---
name: CSULB Biotechnology Club — Career Hub
concept: The annotated record
surfaces:
  public: [/, /internships, /calendar, /eligibility, /companies, /about, /submit, /privacy]
  instrument: [/admin, /admin/review, /admin/import, /admin/duplicates, /admin/add]
status: Derived from the shipped static hub design system. Token contrast and
  dimension separation are automated; responsive reflow still requires visual QA.
---

# DESIGN.md

## North star

This is a **research instrument maintained by students**, not a product landing
page and not a job board. Two references, held together:

- the clarity of a carefully edited scientific publication
- the utility of a modern research instrument

The interface should feel **composed, not populated**. Hierarchy, spacing, rules,
alignment, typography and restrained colour do the work. If a section could be
a card or a ruled band, make it a ruled band.

A visitor must understand within ten seconds that this covers **graduate-level
and graduate-accessible** roles in genomics, cancer research, bioinformatics and
diagnostics. Never broaden it visually or verbally into a general undergraduate
board.

## The idea that organises everything

The product's intelligence is that it refuses to collapse three questions:

1. Is the opportunity **open**?
2. Is it **scientifically relevant**?
3. Is this particular graduate student **eligible**?

Every layout decision serves that separation. Each record places the same three
annotations in the same positions, so the eye learns them once.

## Colour

Colour is **assigned by dimension and never shared across dimensions**. This is
the rule that stops the interface from becoming decorative.

| Role | Token | Value | Used for |
|---|---|---|---|
| Surface | `--paper` | `#FDFBF6` | page background, warm ivory |
| Surface alt | `--paper-2` | `#F5F1E6` | inset panels, hover wash |
| Surface raised | `--white` | `#FFFFFF` | records, inputs, dialog |
| Structure | `--navy` | `#0A1628` | masthead, footer |
| Ink | `--ink` | `#1A2008` | primary text |
| Ink secondary | `--ink-soft` | `#464C3C` | supporting text |
| Ink tertiary | `--ink-faint` | `#6A7060` | metadata, labels |
| **Status** | `--teal` | `#075672` | posting status only |
| Status accent | `--teal-bright` | `#00C4A7` | live marks, top rule |
| **Eligible** | `--eligible` | `#3A6A1B` | explicit eligibility only |
| **Clarify** | `--clarify` | `#7E5310` | ambiguity, inference notices |
| **Restricted** | `--restricted` | `#A3283A` | structural gates only |
| **Timing** (fills, rules) | `--gold` | `#F5A623` | large fills, rules, dark-surface focus |
| **Timing** (marks) | `--gold-mark` | `#B8710A` | small marks on light surfaces, 3.76:1 |
| Rules | `--line` / `--line-strong` / `--line-dark` | `#E3DFD3` / `#CBC6B6` / `#8C8776` | hairlines, borders, controls |

`--lime #8DC63F` is club brand but fails text contrast on ivory. Reserve it for
non-text marks only; eligibility text uses `--eligible` instead.

`--gold #F5A623` is 1.96:1 on paper and cannot carry a small mark on a light
surface. Use `--gold-mark` there. Enforced by src/__tests__/design.

**Never** use colour alone to carry meaning. Every status pairs a colour with a
glyph and a word.

## Typography

Three voices, three jobs. Do not blur them.

| Voice | Family | Job |
|---|---|---|
| Editorial | DM Serif Display | headings, record titles, figures |
| Interface | IBM Plex Sans | body, controls, labels |
| Evidence | IBM Plex Mono | dates, counts, index numbers, release ids, verification stamps |

**Monospace is reserved for evidence.** A mono label on a section header is
decoration and is wrong here.

Scale (rem): 0.75 / 0.8125 / 0.9375 / 1.0625 / 1.25 / 1.5 / 1.875 / 2.5, with
statement text at `clamp(2.25rem, 1.4rem + 3vw, 3.5rem)`.

Line heights: 1.08 tight (display), 1.25 snug (titles), 1.55 body.
Body measure caps at ~62ch; record focus lines at ~64ch.

Use the resilient system font stacks in `globals.css`; the app must not depend on
a third-party font request to render.

## Spacing and layout

8-based with a 4 half-step: 4, 8, 12, 16, 24, 32, 48, 64, 96.

**Deliberately not the 4-8-12-16 default**, which is the most-represented scale
in training data and reads as templated.

- Wrapper max width 1200px, gutter 32px (24 at ≤900, 18 at ≤400)
- Editorial margin column 220px for section titles and caveats
- Breakpoints: 1180, 900, 760, 400, 360

Radii stay small: 3px and 6px. One dialog shadow. Nothing else casts a shadow.

## Component rules

**Records** (opportunity rows, review items) are ruled bands, not cards. Fixed
annotation positions. Employer and role dominate; the role title is the only
serif element in the list so it is found first.

**Restrictions are visible before details.** A restricted record gets a rust
rule in the margin, a rust status word with a slashed glyph, and the published
restriction printed in the record itself.

**The official source is the primary action everywhere.** Details and Save are
text buttons beside it, never competing.

**Evidence carries citations.** Where a value came from a source, show the quote.
Where it did not, say so plainly — an uncited assertion must look different from
a verified one, and "Unknown" must look different from both.

**Controls** are 44px minimum touch target, 1px `--line-dark` border, 6px radius,
white surface. Focus ring is 2px paper + 2px navy offset; on navy surfaces it is
2px navy + 2px gold.

## Public surfaces vs the instrument

`/admin/*` is a working instrument an officer uses for twenty minutes on a
Monday. Optimise for scanning density, keyboard use, and verification speed.

Public pages carry more editorial weight — a statement, a lede, breathing room —
but never become marketing. No hero video, no gradient wash, no testimonial
carousel.

## Do not

These are failure modes this project has already been briefed against:

- Every section inside a rounded card
- Repetitive icon-plus-heading blocks
- Generic three-column marketing sections
- All-caps tracked eyebrow labels above every heading
- Decorative DNA helices, molecule icons, microscope graphics, stock lab photos
- Neon gradients, glowing blobs, heavy glass effects
- Oversized pill controls, excessive shadows, ornamental animation
- Huge headlines followed by empty space
- Excessive badges
- Default Tailwind blue `#3b82f6`, Inter as the interface face, or a 4-8-12-16
  spacing scale — the three tells of an unconsidered AI frontend
- Fake university seals or official CSULB marks

## Motion

Only on state change: dialog, toast, disclosure, hover tint. 160ms ease-out.
Nothing animates on load or scroll. `prefers-reduced-motion` disables all
transitions.

## Accessibility

WCAG 2.2 AA is a requirement, not a goal.

- Core text pairs are measured at ≥4.5:1 by `src/__tests__/design/tokens.test.ts`.
- Status never communicated by colour alone
- Visible focus states on every interactive element
- Dialog moves focus to the title, restores to the trigger on close
- Reflow at 320px and 200% zoom without horizontal scroll
- Semantic HTML; tables reflow to records rather than scrolling sideways

## Agent prompt guide

When generating UI for this project:

> Follow DESIGN.md. Use the ruled-band record pattern, not cards. Colour is
> assigned by dimension: teal for posting status, green/amber/rust for
> eligibility, gold for timing. Monospace only for dates, counts and evidence.
> Every status needs a glyph and a word alongside its colour. Verify contrast
> ≥4.5:1 and check the layout at 320px before you finish.
