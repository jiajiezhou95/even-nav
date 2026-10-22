# Bounded reuse audit — 2026-10-20

| Repository | Inspected commit | License | Decision |
|---|---|---|---|
| [official templates](https://github.com/even-realities/evenhub-templates) | 8cb01354f5ee914c5fab97d06e6d13b28eeb5815 | MIT | Inspected minimal package configuration; use official Vite/SDK/CLI pattern, no source file copied |
| [Even Transit](https://github.com/langerhans/even-transit) | c2d5553b320fc1b6a771eab8e1dc455f3880e7d6 | MIT | Inspected `src/motis.ts`; stop-based lookup/logging and `detailedTransfers:false` unsuitable for private door-to-door flow; no code copied |
| [Train JP](https://github.com/ymkthr/train-jp) | 4059408ecc11e1c5e7237c58f86d235aa16f5f73 | MIT | Inspected package/API dependencies; voice/ASR not in scope; no code copied |
| [Wander](https://github.com/laolao91/wander) | 09cb906300fdb213a97ecca3004196d6afcff0f9 | No repository license identified | Inspected location API usage only; no source copied or adapted |

Official installed SDK 0.0.16 is MIT. Official CLI 0.2.0 is proprietary: its LICENSE explicitly permits installing the published package to build and submit EvenHub apps. CLI source/binary is not redistributed in this repository or application package. New application source is MIT; provider service/data terms remain separate.
