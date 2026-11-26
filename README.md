# SlotForge Community Library

Tracks, chassis, bodies, buildings, liveries, decal sheets and race-screen packs, shared by slotcar racers and builders for the free [SlotForge apps](https://thedutchmanjames.github.io/).

**[Browse the library →](https://thedutchmanjames.github.io/library/)**

Each item shows a picture, its scale, the app and oldest app version it opens in, and whether its maker printed and tested it.

## Share something

1. Open **[Share something in the library](https://github.com/theDutchmanJames/SlotForgeLibrary/issues/new?template=submit-item.yml)** (you need a free GitHub account).
2. Give it a name, fill in the form, drag in a picture and a **.zip** with your files (up to 25 MB), and submit.
3. Once it is approved, it appears in the library with you as its maker, and the issue is closed with a link to it.

Only share what you made or may share. Bought chassis, pods and bodies, and makers' logos and decals, belong to their makers.

## Change or remove an item

Open an [issue](https://github.com/theDutchmanJames/SlotForgeLibrary/issues/new) with the item's name and what should change. Makers can always have their own items removed.

## Licences

Every item has the licence its maker chose (CC BY, CC BY-NC, CC BY-SA or CC0), shown in the library and in its `item.json`. Download, print and change items within that licence, and credit the maker.

## How it works

- `items/<id>/` holds each item: `item.json`, a `preview` picture and the `.zip`.
- `library.json` is the index the website reads. `npm run index` rebuilds it, and so does the **Rebuild index** workflow after every change in `items/`.
- Putting the **approved** label on a submission (repository owner only) runs **Add approved item**: it reads the form, downloads only files uploaded to GitHub, checks that the picture is an image and the files a zip, adds the item and closes the issue. If something is missing it comments with what to fix.
- `npm test` checks how submissions are read.
