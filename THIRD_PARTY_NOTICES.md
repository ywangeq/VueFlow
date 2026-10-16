# Third-party software

## scaffold-master graph stage

- Upstream: https://github.com/wbr664393425-lgtm/scaffold-master
- Source commit: `577079e9a347555fadddd3865fc0bbcdb00d9fb4`
- Source subtree: `scaffold-vue/src`
- Copyright (c) 2026 wbr664393425-lgtm
- License: MIT; preserved verbatim in `src/vendor/scaffold/LICENSE`.

The following original files are vendored under `src/vendor/scaffold/`:

- `components/charts/RelationGraph.vue`
- `components/Icon.vue`
- `composables/motion.ts`
- `composables/viewport.ts`
- `composables/neural.ts`
- `data/icons.ts`

`graph.css` is the graph-only excerpt (lines 714–923) of upstream
`src/styles/instruments.css`. It is loaded as scoped CSS by RelationGraph.
Adaptations: relative imports replace the upstream `@/` alias; component-local
CSS host tokens and label width limits match this application. `motion.ts`
retains only the original reduced-motion, spring, Bézier and frame-loop functions
used by RelationGraph; unrelated application animations and global side effects
are omitted. The local dark graph theme adds an angular instrument rendering branch to
`neural.ts` via the graph-local `--graph-mode` token. It preserves the original
light rendering path and scaffold geometry, focus, and animation behavior.
No upstream copyright or license is replaced by the application's non-commercial terms.

`src/components/ChapterGraph.vue` is this application's domain adapter. It
computes positions from chapter order and renders the original Canvas graph
stage. Canvas positions are never used as persisted chapter order.

## Other dependencies

Vue is licensed under MIT. Vite, TypeScript and vue-tsc retain their respective
upstream licenses. GSAP 3.15.0 is used by the original scaffold motion implementation. Its source
header states: Copyright 2008–2026, GreenSock. All rights reserved. Its package
uses the [GSAP standard license](https://gsap.com/standard-license), rather than
MIT. Those upstream terms remain applicable. See installed package
license files for the complete notices; the application license does not
relicense these dependencies.
