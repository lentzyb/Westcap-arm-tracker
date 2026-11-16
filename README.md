# WestCap ARM Tracker

Internal site for West Capital Lending Business Development. It tracks:

- **Listings** — past WestCap borrowers whose homes are listed now or likely to list (Model Match), split into current LOs and former LOs.
- **Realtors** — every realtor WestCap LOs have closed with, with contact info and which LOs they work with.
- **Loan officers** — active roster, past-borrower counts, and alert settings.
- **ARMs** — Agent Relationship Managers, which LOs they're deployed to, credited loans, captured volume, and variable comp.
- **Status** — Model Match refresh schedule, realtor directory build progress, run log, approved logins.

## How it works

- Static site (HTML/CSS/JS, no build step), hosted on Netlify.
- Data lives in the **WestCap ARM Tracker** Supabase project (separate from West Cap Life).
- Sign-in is a one-time email link (Supabase Auth). Row-level security only returns data to emails listed in `public.arm_admins`.
- Supabase edge functions refresh Model Match data twice daily (`arm-sync`) and build the realtor directory (`arm-realtor-sync`).
- Notifications are queued in `arm_notifications` but **never sent**: no email/text provider is connected and `arm_config.notifications_enabled` is `false`.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure |
| `styles.css` | WestCap brand styling |
| `app.js` | App logic and Supabase queries |
| `config.js` | Supabase URL and publishable key (safe in the browser; data is protected by row-level security) |
| `netlify.toml` | Netlify publish settings and security headers |

## Adding someone

Add their email to `public.arm_admins` in Supabase. They sign in with that email.
