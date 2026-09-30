# Ducktown presentation rehearsal

## What can be demonstrated today

The Vercel site is a visual preview. Show Pepper's closed-mouth resting pose,
hover or hold to open the jaw, choose a viewing angle, and change shell color.
Workshop cards hold a still pose until hovered or focused; opening a behavior
shows its authored motion phrase. These are presentation animations, not recorded
SDK movement or measured robot capabilities.

For the working community journey, run `npm start` locally and open
`http://127.0.0.1:8787` in two separate browser profiles. Register two accounts,
save their recovery codes, and name their ducks. In the first browser, share a
Pond update. Refresh the second browser, open the update's replies, and reply.
Refresh the first browser and open the conversation to show the saved response.
The feed currently refreshes on navigation/reload; it does not stream updates.

`npm run demo:rehearse` runs this two-person journey against a disposable database
in desktop and phone contexts. It also checks shell selection, viewing controls,
motion pause, and reduced-motion preferences. It does not create public accounts
or touch the working database.

## Public launch dependency

The Vercel project currently has no database connection or deployed API. To make
the same journey work on the public site, select and provision a durable database,
migrate `server/store.js`, adapt the HTTP API to the chosen runtime, and validate
sessions, ownership, write limits, backups, and this rehearsal on that deployment.
Only then remove `VITE_DUCKTOWN_STATIC_PREVIEW=1` from the Vercel build command.
The frontend already addresses `/api/v1` on its own origin, so the deployed API
must be served or proxied at that path. Database credentials belong on the API
server, never in `VITE_` variables. No public database migration has been made.

Keep Pollen's SDK observer and operator evidence workflow on the trusted simulator
machine. A recorded simulator demonstration is a separate segment with its own
captured evidence; the decorative character does not substitute for that segment.

## Presentation review

Check the actual presentation laptop, a physical phone, keyboard navigation, and
reduced motion before the meeting. Browser emulation catches layout and functional
problems, but its frame timings are not a physical-device performance benchmark.
