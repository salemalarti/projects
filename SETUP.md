# Setup Guide (no coding experience needed)

This guide takes you from zero to a live website with real Roblox data, step by step.
Plan for about **60–90 minutes** the first time. Everything used here is **free**.

Each instruction is labelled so you know where to do it:

* 🖥️ **RUN THIS IN TERMINAL**: type (or paste) the command into the Terminal and press Enter.
* 📝 **PASTE THIS INTO .env**: edit the file called `.env` in the project folder.
* 🖱️ **CLICK THIS IN …**: do it in a website (Supabase, GitHub, Vercel, Resend).

> **What's a terminal?** A window where you type commands.
> **Mac:** press `Cmd + Space`, type `Terminal`, press Enter.
> **Windows:** press the Start button, type `PowerShell`, press Enter.

---

## Step 1: Install Node.js (one time)

1. 🖱️ Go to https://nodejs.org and download the **LTS** version.
2. Open the downloaded file and click **Next** until it finishes.
3. Close and reopen your terminal.
4. 🖥️ **RUN THIS IN TERMINAL** to check it worked:
   ```
   node -v
   ```
   You should see something like `v22.x.x`. Any number **20 or higher** is fine.

## Step 2: Get the project and install it

1. 🖥️ **RUN THIS IN TERMINAL** to go into your project folder (change the path to wherever your folder is):
   ```
   cd path/to/your/project
   ```
   Tip: type `cd ` (with a space) and drag the project folder into the terminal window, then press Enter.
2. 🖥️ **RUN THIS IN TERMINAL** to download the building blocks the app needs (takes 1–2 minutes):
   ```
   npm install
   ```
3. 🖥️ **RUN THIS IN TERMINAL** to create your settings file from the template:
   * Mac: `cp .env.example .env`
   * Windows: `copy .env.example .env`

You now have a file named `.env` in the folder. Open it with any text editor (TextEdit, Notepad, VS Code).
**This file holds your secrets. Never share it or upload it anywhere.**

## Step 3: Create the database (Supabase)

1. 🖱️ **CLICK THIS IN SUPABASE**: go to https://supabase.com → **Start your project** → sign in with GitHub.
2. 🖱️ Click **New project**.
   * **Name:** `roblox-analytics`
   * **Database Password:** click **Generate a password**, then **copy it and save it somewhere safe**
     (a password manager or a note). You'll need it in a minute.
   * **Region:** the one closest to you.
   * Click **Create new project** and wait about 2 minutes.
3. 🖱️ At the top of your project page, click the **Connect** button.
4. 🖱️ Find the **Transaction pooler** section and copy the connection string (the **URI**). It looks like:
   ```
   postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
   ```
   Use the **Transaction pooler** one (port `6543`), not "Direct connection".
5. 📝 **PASTE THIS INTO .env**: put it after `DATABASE_URL=` and **replace `[YOUR-PASSWORD]`
   (including the square brackets)** with the password you saved:
   ```
   DATABASE_URL=postgresql://postgres.abcdefgh:MyRealPassword123@aws-0-us-east-1.pooler.supabase.com:6543/postgres
   ```
   If your password has special characters like `@`, `#`, `/` or `%`, it's easiest to reset it to one with
   only letters and numbers: 🖱️ Supabase → **Project Settings** → **Database** → **Reset database password**.
6. Save the `.env` file.
7. 🖥️ **RUN THIS IN TERMINAL** to check your settings:
   ```
   npm run check-env
   ```
   You want to see `✅ Database connection works.`
8. 🖥️ **RUN THIS IN TERMINAL** to create the tables:
   ```
   npm run db:migrate
   ```
   You should see `Applied: 001_initial_schema.sql`.

> **Supabase API keys:** Supabase also shows an "anon" key and a "service_role" key. **This app doesn't need
> either one.** It talks to the database directly from the server. Don't put them in your website.

## Step 4: Collect real Roblox data

🖥️ **RUN THIS IN TERMINAL**:
```
npm run scrape
```
It takes under a minute. You'll see something like:
```
Starting Roblox data collection...
Chart "top-playing-now": 100 games
...
Found 250 games
Processing 25/250...
Successfully stored 248 games
Skipped 2 games
Collection completed in 31.4 seconds (status: partial)
```
"Skipped" games had missing or suspicious data and were left out on purpose. `partial` just means some were skipped.

Running it again on the same day **won't create duplicates**; it updates today's numbers.

## Step 5: Look at it on your computer

1. 🖥️ **RUN THIS IN TERMINAL**:
   ```
   npm run dev
   ```
2. Open http://localhost:5000 in your browser for the **landing page**, and
   http://localhost:5000/dashboard for the **dashboard**.
3. Try the signup form. Then 🖱️ in Supabase go to **Table Editor** → `beta_signups` and you'll see your signup.
4. To stop the website, click the terminal and press `Ctrl + C`.

> **About trends:** for the first 14 days, every game shows "Not enough history yet". That's expected:
> trends are calculated from your own daily history and we don't guess. The **daily job** (Step 8) builds that history.

## Step 6: Put the code on GitHub

If your project is already on GitHub, skip to Step 7.

1. 🖱️ **CLICK THIS IN GITHUB**: go to https://github.com/new, name it `roblox-analytics`, choose **Private**, click **Create repository**.
2. 🖥️ **RUN THIS IN TERMINAL** (replace `YOUR-USERNAME`):
   ```
   git init
   git add .
   git commit -m "Roblox analytics MVP"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/roblox-analytics.git
   git push -u origin main
   ```
   Your `.env` file is **not** uploaded (it's listed in `.gitignore`), which is what you want.

## Step 7 (optional, recommended): Send real emails with Resend

Without this, signups still work: people see their personal access link on screen instead of getting an email.
With it, people get a confirmation email, and you know their address is real.

Why Resend: free for 3,000 emails/month (100/day), simple setup, made for this kind of email.
(SendGrid no longer has a free plan.)

1. 🖱️ **CLICK THIS IN RESEND**: go to https://resend.com and sign up.
2. 🖱️ **Domains** → **Add Domain**, and enter a domain you own (e.g. `yourgame-analytics.com`).
   Resend shows a few DNS records. Add them where you bought the domain (Namecheap, GoDaddy, Cloudflare…)
   under "DNS settings". Wait until Resend says **Verified** (minutes to a few hours).
   *No domain yet?* You can test with `onboarding@resend.dev` as the sender, but it only delivers to **your own** email address.
3. 🖱️ **API Keys** → **Create API Key** → name it `roblox-analytics` → **Sending access** → copy the key (starts with `re_`).
4. 📝 **PASTE THIS INTO .env**:
   ```
   EMAIL_PROVIDER=resend
   EMAIL_API_KEY=re_your_key_here
   EMAIL_FROM=Roblox Analytics <hello@yourdomain.com>
   ```
5. 🖥️ **RUN THIS IN TERMINAL**: `npm run check-env`. You want `✅ Email is on (Resend)`.

## Step 8: Turn on the daily data collection (GitHub Actions)

1. 🖱️ **CLICK THIS IN GITHUB**: open your repository → **Settings** → **Secrets and variables** → **Actions**.
2. 🖱️ Click **New repository secret**.
   * **Name:** `DATABASE_URL`
   * **Secret:** the same value as `DATABASE_URL` in your `.env`
   * Click **Add secret**.
3. 🖱️ Click the **Variables** tab → **New repository variable**. Name `BASE_URL`, value your site address
   (you'll get it in Step 9; you can come back and add it later).
4. 🖱️ Go to the **Actions** tab. If asked, click **I understand my workflows, go ahead and enable them**.
5. 🖱️ Click **Daily Roblox data collection** → **Run workflow** → **Run workflow** to test it now.
   After about a minute, click the run to see the log. A green check means it worked.

From now on it runs **every day at 03:17 UTC** automatically. It only runs from your `main` branch.
If you don't change the repository for 60 days, GitHub may pause it (it emails you; one click turns it back on).

## Step 9: Put the website online (Vercel)

1. 🖱️ **CLICK THIS IN VERCEL**: go to https://vercel.com → **Sign Up** → **Continue with GitHub**.
2. 🖱️ Click **Add New…** → **Project** → find `roblox-analytics` → **Import**.
3. 🖱️ **Framework Preset** should say **Express** (Vercel detects it). If it doesn't, pick **Express** from the list.
   Leave Build and Output settings alone.
4. 🖱️ Open **Environment Variables** and add these one at a time (Name → Value → **Add**):

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | same as in your `.env` |
   | `NODE_ENV` | `production` |
   | `BASE_URL` | leave for now (see step 6 below) |
   | `EMAIL_PROVIDER` | `resend` (or `none`) |
   | `EMAIL_API_KEY` | your Resend key (if using email) |
   | `EMAIL_FROM` | your sender (if using email) |

5. 🖱️ Click **Deploy** and wait 1–2 minutes. Vercel gives you an address like `https://roblox-analytics-abc.vercel.app`.
6. 🖱️ Copy that address. In Vercel go to **Settings** → **Environment Variables**, add
   `BASE_URL` = `https://roblox-analytics-abc.vercel.app` (no slash at the end). Then **Deployments** →
   the top deployment's **⋯** menu → **Redeploy**. (BASE_URL makes email links point to your real site.)
7. Check it works:
   * `https://your-address.vercel.app/api/health` should show `"database":"connected"`.
   * `https://your-address.vercel.app/` shows the landing page with live numbers.
   * `https://your-address.vercel.app/dashboard` shows real games.
   * Sign up with your own email and check that the email arrives (or the on-screen link appears).

Every time you push changes to GitHub, Vercel updates the site automatically.

---

## Everyday tasks

| I want to… | Do this |
|---|---|
| See who signed up | 🖱️ Supabase → **Table Editor** → `beta_signups` (you can export to CSV with the **Export** button). |
| See how people use the site | 🖱️ Supabase → **SQL Editor**, paste: `select name, count(*) from events where created_at > now() - interval '7 days' group by name order by 2 desc;` → **Run** |
| Landing page → signup conversion | 🖱️ SQL Editor: `select count(*) filter (where name='landing_view') as views, count(*) filter (where name='signup_succeeded') as signups from events where created_at > now() - interval '7 days';` |
| Collect data right now | GitHub → **Actions** → **Daily Roblox data collection** → **Run workflow**, or 🖥️ `npm run scrape` |
| Check a collection run | GitHub → **Actions** → click the run. Or Supabase → Table Editor → `scrape_runs`. |
| Turn off someone's beta access | Supabase → Table Editor → `beta_signups` → set their `status` to `disabled`. |
| Run the automated tests | 🖥️ `npm test` (needs a local test database; see README) |

## Something went wrong?

See the **Troubleshooting** table in [README.md](README.md#troubleshooting). The most common ones:

* **`password authentication failed`**: the password in `DATABASE_URL` is wrong. Reset it in Supabase
  (Project Settings → Database) and update `.env`, the GitHub secret and Vercel.
* **`ENOTFOUND` or timeout**: you copied the "Direct connection" string. Use **Transaction pooler** (port 6543).
* **Dashboard says "No data has been collected yet"**: run `npm run scrape` or the GitHub workflow.
* **Emails don't arrive**: check spam; in Resend → **Emails** you'll see whether each one was delivered.
  Make sure your domain shows **Verified**.

---

## What's next (after the beta is live)

The roadmap in [roblox-analytics-plan.md](roblox-analytics-plan.md) continues with recruiting beta users
(templates in [MARKETING_TEMPLATES.md](MARKETING_TEMPLATES.md)), feedback interviews, and validating demand
before building paid features.
