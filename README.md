# Eboard HQ

A simple website for running an executive board — members, a monthly
to-do/events calendar, personal ideas & goals, and projects with assigned tasks.

## 👉 First time? Read [SETUP.md](SETUP.md)

It walks you (click-by-click) through two things:
1. **Getting your site online** so you have a link to share.
2. **Turning on live sharing** so everyone sees the same updates.

## How it works

- Open the site link and start using it — changes save automatically.
- Once live sharing is set up (SETUP.md), the whole board shares **one live
  copy** that updates every few seconds. The status at the bottom shows
  **“Live · shared with everyone.”**
- It still works offline: changes save on your device and sync when you're back.

## What's inside

- **Members** — add each eboard member with their name and role. Click a person
  to open their own space, which has two parts:
  - **Calendar** — every month of the school year (August → July), each with its
    own **to-do list** and **events** list, just for that person.
  - **Personal** — that person's own **ideas** and **goals**.
- **Projects** (shared) — create a project, add **to-do lists** inside it, and
  **assign** each task to a member.

## Your data

With live sharing on, everything lives in your free Supabase database and is
shared across everyone. The **Export backup** button at the bottom saves a copy
to a file anytime, and **Import backup** restores it.

## Files

- `index.html`, `styles.css`, `app.js` — the website itself.
- `config.js` — where you paste your Supabase URL + key (see SETUP.md).
- `.github/workflows/deploy.yml` — auto-publishes the site to GitHub Pages.
