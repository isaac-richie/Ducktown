# Ducktown frontend

For repeatable browser checks, run `npx playwright install chromium` once, then `npm run test:browser` from the project root. The browser suite builds the frontend, starts a separate Ducktown server with a disposable database on loopback port 8790, tests desktop/mobile navigation and account posting, and scans the Pond and sign-in dialog for serious automated WCAG A/AA issues. It does not touch the live Ducktown database or the official simulator. Automated checks cannot replace manual keyboard, screen-reader, and usability testing.

This is the source for Ducktown's browser app. It uses Vite for bundling, Motion's small browser animation engine for view entrances, and lazy-loaded Three.js for the original robot presentation model. The robot illustration is not SDK execution evidence. The launch ribbon and hardware-style accents take inspiration from Microduck's energetic product presentation. The interface and 3D geometry are original; the user-supplied head artwork is identified below.

From the project root:

1. `npm install`
2. `npm start` to build the frontend and serve it with the loopback API on port 8787.
3. `npm run dev:frontend` for the frontend on `http://127.0.0.1:5173/`. Vite forwards `/api/v1` to the local API; no API is sent to a third party.
4. `npm run build:frontend` to write a static bundle to `dist/frontend/`.

Edit `frontend/src/`, not `outputs/`. The old `outputs/` preview is kept for comparison while the frontend is migrated; the backend prefers the built bundle when it exists. The browser app remains a local prototype; a successful static build is not production deployment or hardware verification.

The header motion control pauses both CSS effects and view entrances. System reduced-motion preference takes priority. Build and test with `npm run build:frontend` and `npm test`; the opt-in live SDK check still requires a local simulator and is skipped by default.

The active UI loads real duck profiles, follows, saved posts and ideas, prompt saves, and follow/reply notifications from the local API. Registration shows a one-time recovery code before profile setup. The Arena is a set of creative prompts with no invented scoreboard. The Town Map navigates to actual app sections, while its Schoolhouse remains labeled as future work. The Pond uses real server posts while the API is available; sample stories appear only in the static fallback. Hidden profiles leave public Pond posts visible, as the profile editor explains. Reported posts go to a local operator review queue; a report alone does not remove content.

`src/microduck-head-mark-open.webp` is the Microduck head artwork supplied by the user, used in the sidebar and the non-WebGL fallback. It is distinct from Ducktown's original 3D presentation geometry. The geometry now follows that reference's flush housing rim, orange camera ring, and hinged tray with a lavender inset.
