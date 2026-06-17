# Eboard HQ

A simple, no-setup website for running an executive board. Everything is saved
right in your browser — no accounts, no server, no install.

## How to use it

**Just open `index.html` in any web browser.** That's it.

To put it online for free so your whole board can reach it, see *Hosting* below.

## What's inside

- **Members** — add each eboard member with their name and role.
- **Calendar** — every month of the school year (August → July). Each month has
  its own **to-do list** and **events** list.
- **Personal** — pick a person and jot down their personal **ideas** and **goals**.
- **Projects** — create a project, add **to-do lists** inside it, and **assign**
  each task to a member.

## Your data

All information is stored locally in the browser you use (via `localStorage`),
so it stays on your device. Use the **Export backup** link at the bottom to save
a copy, and **Import backup** to restore it or move it to another computer.

> Heads up: data is per-browser. If you want everyone editing the same shared
> copy in real time, that needs a hosted database — let me know and I can build
> that next.

## Hosting (free, optional)

The site is just static files, so it works great on **GitHub Pages**:

1. Push this repo to GitHub.
2. Go to **Settings → Pages**.
3. Under *Build and deployment*, set **Source: Deploy from a branch**, pick your
   branch and the `/ (root)` folder, then **Save**.
4. After a minute your site is live at `https://<username>.github.io/<repo>/`.
