# Agent Notes

## Cloudflare credentials (siim, 2026-10-20)

- A Cloudflare **User API Token lives at `/root/.cloudflare-token`** (mode 600, one line).
- `/root/.bashrc` exports it automatically for interactive shells as
  `CLOUDFLARE_API_TOKEN`. Non-interactive shells (CI-style tool runs, agent
  sandboxes) must load it explicitly:

  ```bash
  export CLOUDFLARE_API_TOKEN="$(cat /root/.cloudflare-token)"
  ```

- Verified working with `npx wrangler whoami` (account of siim.liimand@gmail.com;
  D1 databases `cockpit-local`/`cockpit-staging`/`cockpit-production` are reachable
  with it).
- Never echo or commit the token value; reference the file path instead.
  This repo deploys with `npm run deploy:staging` / `deploy:production` and
  migrates with `npm run db:migrate:staging` / `db:migrate:production`.
