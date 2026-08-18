---
name: selfgrow-minimal-ui
description: Design, simplify, implement, or review SelfGrow Obsidian plugin interfaces with a quiet, content-first, mobile-first visual system. Use for SelfGrow collection, Raw review, settings, status, navigation, card, form, responsive-layout, accessibility, or UI consistency work.
---

# SelfGrow Minimal UI

Build the smallest interface that keeps the workflow obvious. Preserve existing behavior and user data unless the request explicitly changes them.

## Visual rules

- Reuse Obsidian native elements, icons, and CSS variables.
- Use one accent color for the current view and primary action.
- Use no gradients and no decorative animation.
- Prefer thin borders over shadows; use at most one subtle shadow for a temporary menu.
- Use one consistent radius tier for fields and cards.
- Keep body content within 720-800 px on desktop.
- Keep every mobile target at least 44 px.
- Support Obsidian light and dark themes without fixed page colors.

## Information hierarchy

- Put `SelfGrow` and the Collect/Review switch at the top.
- Show one page title and one short supporting sentence.
- Keep only one high-emphasis action per view or action group.
- Display a Raw card as title, two-line preview, status/source/time, and its primary action.
- Put Open and Delete in a native overflow menu.
- Hide empty groups and batch controls with no selected cards.
- Keep technical routing or processing details secondary and concise.

## Workflow

1. Inspect the existing DOM, Obsidian APIs, and CSS before editing.
2. Reuse existing classes and behavior where practical; do not add a UI framework.
3. Make the smallest markup change needed for hierarchy or accessibility.
4. Implement appearance with scoped CSS and Obsidian variables.
5. Verify keyboard labels, 44 px targets, light/dark compatibility, and widths near 390 px and 760 px.
6. Run formatting, lint, tests, typechecking, and the production build.
7. Inspect every changed file and report any visual behavior not directly exercised by automation.

## Boundaries

- Do not redesign the Obsidian file explorer or replace native navigation.
- Do not hide destructive actions without leaving an accessible labeled path.
- Do not introduce custom fonts, icon libraries, component libraries, or design-token layers.
- Do not trade clarity or accessibility for fewer visible elements.
