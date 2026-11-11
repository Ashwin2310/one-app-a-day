# How this runs (free)

No API keys and no paid services. A daily **scheduled task in the Claude desktop app**
(on your existing Claude plan) follows `DAILY_TASK.md`:

1. `publish.py plan` pulls the repo and picks today's category
   (problem-solving / AI → design → utility, rotating).
2. Claude brainstorms 5 ideas, picks the best, writes `idea.json`.
3. Claude writes `STORYBOARD.md`: story, frame-by-frame flow, wireframe, visual direction,
   logic, edge cases, definition of done.
4. Claude builds `index.html`, `style.css`, `script.js`.
5. `publish.py check` opens it in headless Chromium; Claude fixes errors until clean.
6. `publish.py publish` writes the README + screenshot, updates the gallery, commits and pushes
   with your machine's GitHub login. GitHub Pages serves it for free.

Gallery: https://ashwin2310.github.io/one-app-a-day/

## Requirements

- The Claude desktop app is open when the task is due. If it's closed, the task runs the
  next time you open it.
- One-time setup (already done on this Mac):

      python3 -m venv .venv
      .venv/bin/pip install -r requirements.txt
      .venv/bin/python -m playwright install chromium

## Run it by hand

Claude app → Scheduled tasks → "One App a Day" → Run now. Or, for any step:

    .venv/bin/python publish.py plan
    .venv/bin/python publish.py check apps/YYYY-MM-DD
    .venv/bin/python publish.py publish apps/YYYY-MM-DD

## Optional: LinkedIn auto-post (also free)

1. Create a LinkedIn Company Page (For Business → Create a Company Page).
2. https://www.linkedin.com/developers/apps → Create app, attached to that page.
3. Products tab: add **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect**.
4. Auth tab: add redirect URL `https://www.linkedin.com/developers/tools/oauth/redirect`.
5. https://www.linkedin.com/developers/tools/oauth/token-generator → tick openid, profile,
   w_member_social → copy the token.
6. Create a file named `.env` in this folder containing:

       LINKEDIN_ACCESS_TOKEN=paste-token-here

   `.env` is git-ignored, so it never reaches GitHub. Tokens last 60 days; repeat step 5 to renew.

## Tests

    .venv/bin/python -m pytest
