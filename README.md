<p align="center">
  <img src="icons/icon128.png" width="72" height="72" alt="">
</p>

<h1 align="center">Arc House Progress Tracker</h1>

<p align="center">
  A Chrome extension that marks the <a href="https://community.arc.io/home">Arc House</a> content you've already read, watched or commented on, so you always know what's left.
</p>

---

## Why

Arc House tracks every post you read and video you watch on **My Contributions** (`/home/contributors/my-contributions`), but the home feed doesn't show any of that. This extension connects the two: it reads your contribution history and puts a badge on every card you've already finished.

## Features

- ✅ **Badges on finished content:** green **Read**, blue **Watched** and purple **Commented**. Hover a badge to see the date.
- 🔄 **Automatic background sync:** quietly reads your My Contributions page while you browse. No need to visit it yourself.
- 🎚️ **Three display modes:** badge only, dim finished cards, or hide them completely.
- 🔍 **Popup dashboard:** totals, a breakdown by type, and a searchable list of everything you've finished.
- 🔒 **Private:** everything stays in your own browser (`chrome.storage.local`). No servers, no tracking, and the only site it touches is `community.arc.io`.

---

## Installation (step by step)

The extension isn't on the Chrome Web Store, so you load it manually. It takes about a minute.

### 1. Download the code

**Option A: ZIP (easiest)**
1. On this GitHub page, click the green **Code** button.
2. Click **Download ZIP**.
3. Unzip it somewhere you'll keep it, e.g. `Documents/arc-extension`.

> ⚠️ Don't delete or move this folder after installing. Chrome loads the extension from it.

**Option B: git**
```bash
git clone https://github.com/mikemoulder/arc-extension.git
```

### 2. Open Chrome's extensions page

Type this in the address bar and press Enter:
```
chrome://extensions
```
(Works the same in Brave, Edge (`edge://extensions`), Arc, Opera and other Chromium browsers.)

### 3. Turn on Developer mode

Flip the **Developer mode** switch in the **top-right corner** of the page.

### 4. Load the extension

1. Click **Load unpacked** (top-left).
2. Select the folder you unzipped or cloned: the one that contains `manifest.json`.
   - If you downloaded the ZIP, this is usually the inner `arc-extension-main` folder.
3. **Arc House Progress Tracker** now appears in your list of extensions.

### 5. Pin it to the toolbar (optional, recommended)

Click the 🧩 puzzle icon in Chrome's toolbar, then click the 📌 pin next to **Arc House Progress Tracker**.

### 6. Use it

1. Go to [community.arc.io/home](https://community.arc.io/home) and **sign in**. If you already had the tab open, refresh it.
2. A small pill appears in the bottom-right corner. The first sync starts automatically (it takes a few seconds while it reads your full history).
3. Cards you've completed now have a **Read / Watched / Commented** badge in their top-right corner. 🎉

If the badges don't appear, click **Sync** on the pill or in the extension popup.

---

## Updating

- **ZIP:** download the new ZIP, replace the old folder's contents, then click the ↻ reload icon on the extension card in `chrome://extensions`.
- **git:** run `git pull` in the folder, then click ↻ in `chrome://extensions`.

After reloading, refresh any open Arc House tabs.

## Using the popup

Click the extension icon in the toolbar:

| Control | What it does |
| --- | --- |
| **Sync** | Re-reads your full contribution history right away |
| **Badge / Dim / Hide** | How completed cards look on the feed |
| **Auto-sync** | Keeps your history up to date in the background |
| **Status pill** | Shows or hides the progress pill in the page corner |
| **Search** | Find anything in your tracked history |
| **Reset data** | Clears everything saved (it comes back on the next sync) |

## How it works

1. **Sync:** when you're on Arc House, the extension loads your My Contributions page in a hidden frame, scrolls through it, and saves each entry (Read Content, Watch a Video, Comment / Reply, …).
   - The first sync reads your whole history. Later syncs stop as soon as they reach entries already saved.
   - It re-syncs automatically when you open the site (if the last sync was more than 10 minutes ago) and as you move between pages (if it was more than 2 minutes ago).
2. **Marking:** each card on the feed is matched to your history by title and link, and gets a badge if you've completed it.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| No badges at all | Make sure you're signed in to Arc House, then press **Sync**. Refresh the tab if you installed the extension while it was open. |
| Popup says *0 tracked* | Open **My Contributions** from the popup and press **Scan full history** on the pill. |
| A finished item isn't marked | Its title on the feed may differ from the title in your history. Please [open an issue](https://github.com/mikemoulder/arc-extension/issues) with both titles. |
| The pill is in the way | Click its **×**, or turn off **Status pill** in the popup. |

## Project structure

```
manifest.json   Extension manifest (Manifest V3)
content.js      Scrapes My Contributions, syncs in the background, badges cards
content.css     Badge and display-mode styles
popup.html/css/js  Toolbar popup (stats, settings, history search)
icons/          Extension icons
```

## Disclaimer

This is an unofficial, community-made tool. It isn't affiliated with or endorsed by Arc, Circle or Gradual. It only reads pages you can already see while signed in.
