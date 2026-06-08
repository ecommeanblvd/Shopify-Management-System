# Settings nav hub — Design

**Date:** 2026-06-08 · **Status:** approved (verbal), pending spec review

## Goal

Declutter the sidebar by keeping only the five frequently-used modules at the top
level and moving the eight "set up once / check occasionally" modules behind a single
**Settings** entry that opens a dedicated `/settings` hub page listing them as cards.

## Background

The sidebar (`components/shell/Sidebar.tsx`) renders a flat list from `NAV`
(`lib/nav.ts`) — 13 items, each `{ href, label, icon, requires }`, filtered by the
viewer's role permission. The operator finds the rarely-used items noise.

## Requirements (agreed with user)

1. **Top-level (stay flat):** Dashboard, Orders, Carrier rates, Products, Functions.
2. **Move into a Settings hub:** Stores (Link Store), Settings Viewer, Settings Sync,
   Settings Sync History, Markets, Markets history, Users, Feature flags.
3. Sidebar gets one **Settings** entry (→ `/settings`); clicking opens the hub page.
4. The hub lists the eight modules as **permission-filtered cards** (icon, name,
   description, link), grouped into sub-sections: Stores, Settings Sync, Markets, Admin.
5. **No routes move** — each module keeps its existing path; only navigation changes.

## Non-goals (YAGNI)

- Accordion-in-sidebar (user chose the hub page).
- Renaming or merging the underlying module pages.
- Any permission/RBAC change — visibility uses the existing `requires` permissions.

## Architecture

### `lib/nav.ts` (restructure)

- Extend `NavItem` with an optional `description: string` (used by hub cards).
- Keep `NAV` as the **top-level** list: the five core items **plus** a new
  `{ href: '/settings', label: 'Settings', icon: Settings, requires: null }` entry.
- Add `SETTINGS_ITEMS: SettingsNavItem[]` — the eight moved items, each with
  `description` and a `group: 'Stores' | 'Settings Sync' | 'Markets' | 'Admin'`.
- Add `canSeeSettings(role: Role): boolean` → true if the role satisfies at least one
  `SETTINGS_ITEMS[i].requires` (so the Settings entry hides for users with no access to
  any sub-module).

`SettingsNavItem` = `NavItem & { description: string; group: SettingsGroup }`.

### `components/shell/Sidebar.tsx`

- Filter `NAV` by permission as today, but additionally drop the `/settings` entry when
  `!canSeeSettings(role)`. Everything else unchanged (still a server component).

### `app/(dashboard)/settings/page.tsx` (new hub)

- Server component. Resolves session + role (same pattern as other dashboard pages:
  `auth.api.getSession`, `getRole`; redirect to `/sign-in` if no session).
- Renders `SETTINGS_ITEMS` filtered by `hasPermission(role, item.requires)`, grouped by
  `group`, as a card grid. Each card: icon, label, description, links to `item.href`.
- Reuses the existing card/link visual style from the dashboard's `QuickLink`
  (`app/(dashboard)/page.tsx`) so it matches the rest of the app.
- If the viewer can see no items (shouldn't happen because the nav entry is gated), show
  a short "Nothing here you can access" message.

## Module descriptions (for the hub cards)

- **Stores** — Connect a Shopify store and grant the scopes Settings Sync & Markets need.
- **Settings Viewer** — Read-only view of a store's current settings/templates.
- **Settings Sync** — Push settings/templates out to connected stores.
- **History** — Past Settings Sync runs.
- **Markets** — Per-market shipping configuration.
- **Markets history** — Changes to market configuration over time.
- **Users** — Manage users and their roles.
- **Feature flags** — Toggle features on or off.

## Data flow

```
Sidebar (server): NAV.filter(perm) minus '/settings' when !canSeeSettings(role)
  → user clicks "Settings"
  → /settings page (server): SETTINGS_ITEMS.filter(perm), grouped → card grid
  → card link → existing module route (unchanged)
```

## Error handling

- No session on `/settings` → redirect `/sign-in` (matches sibling pages).
- Empty visible set → friendly empty state (defensive; gated nav makes it unlikely).

## Testing

- `lib/nav.test.ts`: `canSeeSettings` returns true for a role with at least one settings
  permission (e.g. admin) and false for a role with none (e.g. a viewer limited to
  `view_orders` only). Asserts the top-level `NAV` contains the `/settings` entry and the
  five core hrefs, and that none of the eight moved hrefs remain in `NAV`.
- The hub page is a thin server component; covered by the data-level `lib/nav` test plus
  manual check.

## Build order (for the plan)

1. `lib/nav.ts` restructure + `lib/nav.test.ts`.
2. `Sidebar.tsx` — gate the Settings entry on `canSeeSettings`.
3. `app/(dashboard)/settings/page.tsx` — the hub.
4. Manual verification (sidebar shows 5 core + Settings; hub lists the 8 grouped cards,
   permission-filtered; links work).
