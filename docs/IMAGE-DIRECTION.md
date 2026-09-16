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

## Current replacement priorities

The live September 15 deployment visibly uses the selected blue-green zebrafish
artwork in both hero and footer areas, but it is painted through remote CSS
background URLs. The local footer file remains the older yellow Purkinje-cell
image and is hidden with zero opacity. The visual selection is no longer the
problem; delivery, naming, accessibility, and mobile verification are.

### Homepage hero
Localize the selected visible zebrafish artwork and render it through
`next/image` rather than a third-party CSS background. Preserve the current crop
and overlay only after validating 390 px, 430 px, tablet, and desktop layouts.

### Global footer
Replace the obsolete hidden `footer-purkinje-cells.webp` file with an accurately
named local zebrafish asset. Render that asset normally, remove the zero-opacity
fallback and remote background, and make the alt text and credits describe the
actual visible image.

### Homepage mission panel
Reassess `mission-histology.webp`. Histology is scientifically relevant but should only stay if the crop has a clear visual rhythm and sufficient contrast next to the gold editorial panel.

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
