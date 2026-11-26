# SlotForge Community Library

Tracks, chassis, bodies, buildings, liveries, decal sheets and race-screen packs, shared by slotcar racers and builders for the free [SlotForge apps](https://thedutchmanjames.github.io/).

**[Browse the library →](https://thedutchmanjames.github.io/library/)**

Each item shows a picture, its scale, the app and oldest app version it opens in, whether its maker printed and tested it, and a link to the original design it is based on.

## Share something

Choose **Share yours** on the [library page](https://thedutchmanjames.github.io/library/). No account is needed: fill in the form, add a picture and a **.zip** with your files (up to 25 MB), and send it. If your design is based on someone else's, paste the web address of the original so its maker gets the credit.

Every item is reviewed before it appears. Only share what you made or may share: bought chassis, pods and bodies, and makers' logos and decals, belong to their makers.

Have a GitHub account? You can also use the **[GitHub form](https://github.com/theDutchmanJames/SlotForgeLibrary/issues/new?template=submit-item.yml)**.

## Change or remove an item

Open an [issue](https://github.com/theDutchmanJames/SlotForgeLibrary/issues/new) with the item's name and what should change. Makers can always have their own items removed.

## Licences

Every item has the licence its maker chose (CC BY, CC BY-NC, CC BY-SA or CC0), shown in the library and in its `item.json`. Download, print and change items within that licence, and credit the maker.

## How it works

- `items/<id>/` holds each item's `item.json` and picture. The `.zip` files are in the **files** release, so the repository stays small.
- `library.json` is the index the website reads. The **Rebuild index** workflow writes it after every change in `items/`.
- **From the website:** a Cloudflare Worker (`worker/`) checks the form and the spam check, puts the item on a branch `submission/<id>`, streams the .zip into the draft release **Pending submissions** (only the owner can see it), and opens a pull request. The **Website submission** workflow lists what is inside the .zip and refuses programs.
  **Merge** the pull request to publish: the .zip moves to the public **files** release. **Close** it to decline: the .zip is deleted.
- **From the GitHub form:** putting the **approved** label on the issue (owner only) runs **Add approved item**.
- `npm test` runs the checks for both routes.

## Setting up the website form (once)

The website's **Share yours** button opens the GitHub form until these steps are done.

1. **Cloudflare account.** Sign up for free at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up).
2. **Spam check.** In Cloudflare, open **Turnstile → Add widget**. Name it *SlotForge library*, add the hostname `thedutchmanjames.github.io`, choose **Managed**, and create it. Keep the **site key** and the **secret key**.
3. **GitHub token.** On GitHub, open **Settings → Developer settings → Fine-grained tokens → Generate new token**. Repository access: **Only select repositories → SlotForgeLibrary**. Permissions: **Contents: Read and write** and **Pull requests: Read and write**. Copy the token.
4. **Deploy the Worker.** In a terminal in this folder:
   ```
   cd worker
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put GITHUB_TOKEN
   npx wrangler secret put TURNSTILE_SECRET
   npx wrangler secret put TICKET_KEY
   ```
   Paste the token, the Turnstile secret key and, for `TICKET_KEY`, any long random text when asked. `wrangler deploy` prints the Worker's address, like `https://slotforge-library.<you>.workers.dev`.
5. **Connect the website.** In the website's `content/library-config.json`, set `submitUrl` to the Worker's address and `turnstileSiteKey` to the Turnstile site key, then publish the website.

Free plans are enough: the Worker streams each .zip straight to GitHub without holding it.
