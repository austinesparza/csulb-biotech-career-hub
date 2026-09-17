# Career Hub image direction

## Principle

Use real scientific imagery that can function as art before it functions as explanation. The visual system should feel like a contemporary science museum or editorial journal, not a stock-photo career site and not an AI-generated biotech brand.

## Selection rules

1. Prefer microscopy, developmental biology, structural biology, and real laboratory photography with strong composition.
2. Images need a clear focal subject and enough negative space to survive responsive crops.
3. Avoid muddy yellow-green casts, low-contrast tissue fields, busy images with no visual hierarchy, generic pipette closeups, and imagery that reads as decorative AI.
4. Keep a varied palette across the site. Do not make every section green/red fluorescence microscopy.
5. Use human/lab photography sparingly and only when it feels documentary rather than staged.
6. Preserve provenance and licensing on the image-credits page.

## Current implementation

The homepage now keeps its two signature NIGMS images as named local assets.
The hero uses the selected epithelial-cell microscopy, while the blue-green
zebrafish vasculature returns as a homepage-only closing image. Both render
through `next/image`, include useful alternative text, and retain their source
and license details on the image-credits page.

### Homepage hero
Use `hero-epithelial-cells.webp` in the circular editorial crop. Preserve the
cyan, magenta, and yellow-green focal cells and keep the orbit lines quiet enough
that the real science remains the focus.

### Global footer
Keep `zebrafish-vasculature.webp` as a homepage coda rather than repeating it in
the global footer. Task pages should retain the compact navigation footer.

### Homepage mission panel
Keep `mission-histology.webp` beside the gold editorial statement. Its tissue
detail creates a useful shift in scale between the cellular hero and the career
pathway gallery.

### About and Prepare
Use one striking real-science image and one strong documentary lab/student image rather than repeating generic microscopy everywhere.

### Discipline cards
Treat these as a curated gallery. Each card should be visually distinct and scientifically specific to the discipline, with consistent contrast and crop quality.

## Strong source direction

Prioritize NIH/NIGMS, NCI, and public-domain Cell Image Library imagery, plus carefully licensed Wikimedia Commons scientific imagery. Favor images with explicit reusable licensing and institutional provenance.

Candidate visual families worth testing:

- zebrafish embryo vasculature, blue/green on black
- snowflake yeast, cyan/orange on black
- Torsten Wittmann colorful cells, yellow/violet/green
- developing nerve cells with high-contrast branching morphology
- NIH neuronal fluorescence imagery, magenta/gold/cyan
- radial optic-nerve or retinal imagery for a full-width statement image
- mitotic spindle or chromosome imagery for cancer/genomics cards

Before shipping replacements, test each candidate at desktop and phone crops, including text-overlay contrast where applicable.
