# Latesto Drycleaners – Management App (installable app, cloud sync)

Works on Android, iPhone/iPad, Windows, Mac and Linux. Once installed it runs **offline**.

## Step 1 – Put the folder online once (free, ~2 minutes)
An app can only be installed from a secure (https) link. Pick one:
- **Netlify Drop** (easiest): go to https://app.netlify.com/drop and drag this whole folder in. You get a link like `https://something.netlify.app`.
- **Cloudflare Pages** or **GitHub Pages** also work (upload the same files).

## Step 2 – Install it
Open the link, then:
- **Android (Chrome):** menu ⋮ → *Install app* (or the "Install app" button inside Latesto)
- **iPhone / iPad (Safari):** Share → *Add to Home Screen*
- **Windows / Mac (Chrome or Edge):** click the install icon in the address bar (or "Install app" inside Latesto)

After this the app has its own icon and works without internet.

## Desktop only, no internet hosting
1. Install Python (python.org), open a terminal in this folder.
2. Run: `python -m http.server 8080`
3. Open http://localhost:8080 in Chrome/Edge and click *Install app*.
(You can also simply double-click `index.html`; it works, but cannot be installed.)

## WhatsApp pickup reminders
- When you change an order's status to **Ready**, a popup shows the message and a **Send on WhatsApp** button. Tap it, WhatsApp opens with the message written, press Send.
- The **Reminders** page lists every Ready order, how many days it has been waiting, and how many reminders were sent. Use **Remind again** any time.
- Change the message and the country code (default 91 for India) in **Settings**.
- WhatsApp needs you to press Send yourself. Fully automatic sending needs the paid WhatsApp Business API and a server.

## Cloud sync (same data on phone, laptop and desktop)
The app signs in with your shop login (Firebase) and keeps all devices in step.
- Open the app, sign in with the email and password created in Firebase, and you are done. The top bar shows **Synced**.
- Works offline: orders made without internet upload automatically when the internet returns.
- First sign-in on a device **merges** that device's old local data into the cloud (nothing is deleted). Services and inventory items with the same name are not duplicated.
- **Order numbers:** each device continues from the highest number it has seen. Two devices creating an order at the exact same moment while BOTH are offline can get the same number. Keep devices online when billing to avoid this.
- **Erase all data** in Settings now erases it on every device.
- Firebase settings live in `firebase-config.js`. Security rules are in `firestore.rules` (paste into Firebase → Firestore → Rules → Publish).

## Important – your data
- Data is kept on each device AND in your cloud database. Still download a backup now and then.
- Settings → **Download backup** regularly; use **Restore backup** to move data to another device.
- **Export to Excel** (Customers/Orders/Settings) gives a spreadsheet with both Customers and Orders.
- Do not clear "site data / storage" for the app in the browser: that deletes your records.

## Updating the app later
If you edit any file, change `VERSION` at the top of `sw.js` (e.g. `latesto-v6`) and re-upload the folder.
