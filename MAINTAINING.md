# Maintaining the library

Notes for running the library. Users only need the [README](README.md).

## Reviewing submissions

- **From the website:** each submission becomes a pull request labelled **submission**. The **Website submission** check lists what is inside the .zip and refuses programs. Look at the picture and the file list, then:
  - **Merge** to publish. The .zip moves to the public **files** release, and the item shows on the website within about 5 minutes.
  - **Close** to decline. The .zip and the branch are deleted.
- **From the GitHub form:** each submission is an issue. Put the **approved** label on it (owner only) to run **Add approved item**.

## How it works

- `items/<id>/` holds each item's `item.json` and picture. The `.zip` files are in the **files** release, so the repository stays small.
- `library.json` is the index the website reads. The **Rebuild index** workflow writes it after every change in `items/`.
- **Website submissions** go through a Cloudflare Worker (`worker/`). It checks the form and the Turnstile spam check, puts the item on a branch `submission/<id>`, streams the .zip into the draft release **Pending submissions** (only the owner can see it), and opens a pull request.
- `npm test` runs the checks for both routes.

## Setting up the website form

Already done; these steps are for setting it up again from scratch. The website's **Share yours** button opens the GitHub form until they are done.

1. **Cloudflare account.** Sign up for free at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up).
2. **Spam check.** In Cloudflare, open **Turnstile → Add widget**. Name it *SlotForge Library*, add the hostname `thedutchmanjames.github.io`, choose **Managed**, and create it. Keep the **site key** and the **secret key**.
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

The GitHub token expires on the date you chose when you made it. When it does, website submissions fail: make a new token (step 3) and run `npx wrangler secret put GITHUB_TOKEN` again.
