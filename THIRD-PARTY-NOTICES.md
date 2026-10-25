# Third-party notices

Tee Studio bundles the following, unmodified except where noted, so it can run offline from `file://`.

| File | Project | Version | Licence |
|---|---|---|---|
| `lib/fabric.min.js` | [Fabric.js](https://github.com/fabricjs/fabric.js) | 5.3.1 (cdnjs build) | MIT. *Modified:* one `textBaseline="alphabetical"` corrected to `"alphabetic"` to stop a console warning. |
| `lib/ag-psd.js` | [ag-psd](https://github.com/Agamnentzar/ag-psd) | 33.0.0 | MIT |
| `lib/jspdf.umd.min.js` | [jsPDF](https://github.com/parallax/jsPDF) | 4.2.1 | MIT |
| `lib/paper-core.min.js` | [Paper.js](https://github.com/paperjs/paper.js) | 0.12.18 | MIT |
| `lib/opentype.min.js` | [opentype.js](https://github.com/opentypejs/opentype.js) | 1.3.4 | MIT |
| `lib/clipper.js` | [Clipper (JS port)](https://sourceforge.net/projects/jsclipper/) by Angus Johnson / Timo | 6.4.2 | Boost Software License 1.0 |

## Fonts

`fonts/fonts.js` (WOFF2, latin subset) and `fonts/outlines.js` (TTF, for converting text to curves) embed these families from [Google Fonts](https://fonts.google.com), all under the [SIL Open Font License 1.1](https://openfontlicense.org):

Anton, Bebas Neue, Bungee, Caveat, Inter, Lobster, Montserrat, Oswald, Pacifico, Permanent Marker, Playfair Display, Rubik Mono One.

## Behaviour reference

Tool behaviour (formulas, defaults and interaction rules) follows the documentation of [TraceDraw](https://github.com/igtoth/tracedraw) (MIT or Apache-2.0). No TraceDraw source code is included; Tee Studio is a separate JavaScript implementation.
