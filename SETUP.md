# Setup guide (first-timer friendly)

Total time: about 45 minutes, once. After that it runs by itself.

What you get every day (on average):
- A new app in `apps/YYYY-MM-DD/` (index.html, style.css, script.js)
- A README for it: The problem, Who it's for, The solution, How it works, Features,
  Under the hood, Try it yourself, plus a screenshot and a live demo link
- An updated gallery website at `https://<your-username>.github.io/one-app-a-day/`
- A LinkedIn post with the problem, the solution, the demo link and the screenshot

Categories rotate: problem-solving / AI → design → utility → repeat.

---

## Step 1 - Get an Anthropic API key (10 min)

1. Go to https://console.anthropic.com and sign up.
2. Settings → Billing → add credit ($10 is plenty to start; one app costs roughly $0.20-0.50).
3. Settings → API Keys → Create Key → name it `daily-app` → copy it (starts with `sk-ant-`).
   Paste it somewhere temporary; you'll need it in Step 4.

## Step 2 - Put the project on GitHub (5 min)

In a terminal:

    cd ~/daily-app-generator
    git init -b main
    git add .
    git commit -m "feat: daily app generator"
    gh repo create one-app-a-day --public --source=. --push

The repo must be **public** for free GitHub Pages.

## Step 3 - Create the GitHub token (PAT_TOKEN) (5 min)

1. Open https://github.com/settings/personal-access-tokens/new
2. Token name: `daily-app`. Expiration: 1 year (set a calendar reminder).
3. Repository access: **Only select repositories** → `one-app-a-day`.
4. Permissions → Repository permissions → **Contents: Read and write**.
5. Generate token → copy it (starts with `github_pat_`).

## Step 4 - Save the secrets in the repo (3 min)

Run each command, paste the value when asked, press Enter (nothing shows while you paste):

    gh secret set ANTHROPIC_API_KEY --repo <your-username>/one-app-a-day
    gh secret set PAT_TOKEN --repo <your-username>/one-app-a-day

(Web alternative: repo → Settings → Secrets and variables → Actions → New repository secret.)

## Step 5 - Turn on the live website (GitHub Pages) (1 min)

Repo → Settings → Pages → Source: **Deploy from a branch** → Branch: **main**, folder **/ (root)** → Save.

## Step 6 - First test run, without LinkedIn (5 min)

1. Repo → **Actions** tab → if asked, click "I understand my workflows, enable them".
2. Click **Daily App Generator** (left) → **Run workflow** (right).
3. Leave "force" ticked, category "auto", tick **skip_linkedin** → Run workflow.
4. Click the run to watch the logs. It takes 3-8 minutes. Green check = success.
5. Check the results:
   - Code tab → `apps/<today>/README.md` (the write-up)
   - `https://<your-username>.github.io/one-app-a-day/` (gallery; can take 1-2 min to appear)

If it fails, open the red step; the last lines say exactly what's wrong (e.g. "PAT_TOKEN is not set").

## Step 7 - Connect LinkedIn (15 min)

LinkedIn only allows posting through a developer "app", and every app must belong to a
LinkedIn Company Page.

1. Create a page (skip if you already admin one): LinkedIn → **For Business** (top right) →
   **Create a Company Page** → Company → name it e.g. "One App a Day" → create.
2. Open https://www.linkedin.com/developers/apps → **Create app**.
   - App name: `One App a Day`; LinkedIn Page: the page from step 1; upload any square logo;
     tick the legal agreement → Create app.
3. **Products** tab → Request access for **Share on LinkedIn** and
   **Sign In with LinkedIn using OpenID Connect** (both are instant).
4. **Auth** tab → OAuth 2.0 settings → Authorized redirect URLs → add
   `https://www.linkedin.com/developers/tools/oauth/redirect` → Update.
5. Open https://www.linkedin.com/developers/tools/oauth/token-generator
   - Select your app, tick **openid**, **profile**, **w_member_social** → Request access token
   - Sign in / Allow → copy the access token.
6. Save it:

       gh secret set LINKEDIN_ACCESS_TOKEN --repo <your-username>/one-app-a-day

From the next app on, every app is posted to your LinkedIn automatically.

**The LinkedIn token expires after 60 days.** When it does, the Actions run turns red with
"token is invalid or expired" (GitHub emails you). Repeat step 7.5-7.6 to renew. Put a
reminder in your calendar for day 55.

## Step 8 - Make it visible on your profile (2 min, one-time)

- LinkedIn profile → **Add section → Featured → Add a link** → paste your gallery URL.
- GitHub profile → **Customize your pins** → pin `one-app-a-day`.

---

## Everyday use

- Nothing to do. It checks every hour and builds about one app per day.
- Want one right now? Actions → Daily App Generator → Run workflow (pick a category if you like).
- Only one app per date: to redo today's, delete the `apps/<today>` folder and run again.
- Want to review before LinkedIn sees it? Delete the `LINKEDIN_ACCESS_TOKEN` secret and post manually.

## Good to know

- About 1 day in 3 gets no app (the hourly 1-in-24 dice doesn't always land). That's by design.
- GitHub pauses scheduled workflows after 60 days with no commits; the daily commits prevent that.
- Optional repo **variables** (Settings → Secrets and variables → Actions → Variables):
  `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`), `LINKEDIN_VISIBILITY` (`PUBLIC` or `CONNECTIONS`).
- Run the tests locally: `.venv/bin/python -m pytest`
