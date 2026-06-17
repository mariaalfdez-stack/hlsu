# Setup guide (follow once) ✅

Two short parts:
- **Part A** puts your site online so you have a link to share.
- **Part B** turns on live sharing so everyone sees the same updates.

You only do this once. Total time: about 15 minutes.

---

## Part A — Get your website online (a clickable link)

1. Go to your repository on GitHub: **github.com/mariaalfdez-stack/hlsu**
2. Click the **Settings** tab (top right of the repo).
3. In the left menu, click **Pages**.
4. Under **Build and deployment → Source**, choose **GitHub Actions**.
5. That's it. Wait ~1 minute, then refresh the Pages screen — it will show your
   live link, something like:

   **`https://mariaalfdez-stack.github.io/hlsu/`**

That link is your website. Open it, bookmark it, share it. 🎉

> The site rebuilds automatically every time changes are pushed, so you never
> have to do this again.

---

## Part B — Turn on live sharing (the cloud database)

Right now each person's changes only save on their own computer. These steps
connect a free database so everyone shares one live copy.

### 1. Create a free Supabase account
1. Go to **https://supabase.com** and click **Start your project**.
2. Sign in (the "Continue with GitHub" button is easiest).
3. Click **New project**.
   - **Name:** anything, e.g. `eboard`
   - **Database password:** pick anything and save it somewhere (you won't need
     it for this app, but Supabase requires one).
   - **Region:** pick the one closest to you.
   - Click **Create new project** and wait ~2 minutes for it to finish.

### 2. Create the data table
1. In the left menu click **SQL Editor**.
2. Click **+ New query**, paste in everything below, then click **Run**:

   ```sql
   create table if not exists board (
     id text primary key,
     data jsonb,
     client_id text,
     updated_at timestamptz default now()
   );

   alter table board enable row level security;

   create policy "open access" on board
     for all using (true) with check (true);
   ```
3. You should see **Success. No rows returned.** Good.

### 3. Copy your two values
1. In the left menu, click **Settings** (gear icon) → **Data API**.
2. Find **Project URL** — copy it.
3. Find **Project API Keys** and copy the **`anon` `public`** key (the long one).

### 4. Paste them into the app
1. In your GitHub repo, open the file **`config.js`**.
2. Click the **pencil icon** (Edit).
3. Put your values between the quotes so it looks like this (your values will be
   much longer):

   ```js
   window.SUPABASE_URL = "https://abcdefg.supabase.co";
   window.SUPABASE_ANON_KEY = "eyJhbGciOi...your-long-key...";
   ```
4. Click **Commit changes** (green button).

Within a minute the site redeploys. Open your link and check the bottom of the
page — it should say **“Live · shared with everyone”** with a green dot. Now
everyone using the link sees the same data, updating every few seconds. 🎉

---

## Good to know
- **Open link = open access.** Anyone who has the link can view and edit. That's
  fine for a trusted board. Don't post the link publicly.
- **It still works offline.** If the internet drops, your changes save on your
  device and sync up when you're back.
- **Cost:** Supabase's free tier is plenty for a board like this.
- **Backups:** the **Export backup** button at the bottom saves a copy of
  everything to a file, just in case.

Stuck on any step? Tell me which number and I'll help.
