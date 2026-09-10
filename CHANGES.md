# What changed

## 1. Profile accounts
- Every user now has a profile they can edit: click your avatar (top-right nav
  or sidebar) or the "Edit Profile" button to open the Edit Profile modal.
- **Username** can be changed freely (must stay unique).
- **University ID** can never be changed. It is now the actual database
  primary key, and it's also the *only* credential used to log in (the login
  page now asks for "University ID" instead of "Username or ID").
- Users can upload a profile photo ("dp"). It's stored on the server under
  `backend/uploads/avatars/` and shown everywhere their avatar appears
  (nav bar, sidebar, post cards). If no photo is uploaded, it falls back to
  the first letter of their username, same as before.

## 2. Media posts
- The "Share or Ask Something" box now has a **Photo / Audio** attach button.
- Allowed images: png, jpg, jpeg, gif, webp. Allowed audio: mp3, wav, ogg,
  m4a, webm, aac. Max upload size 25 MB.
- A post can have text only, media only, or both — it just can't be
  completely empty.
- Uploaded files are stored under `backend/uploads/posts/` and are deleted
  from disk automatically when the post is deleted.

## 3. Delete permissions
- Deleting a post is now strictly limited to the person who created it —
  the previous "admins can delete any post" behavior was removed, per your
  instruction that only the poster can delete their own posts.
- Editing a post was already owner-only and is unchanged.

## Database note
Because the University ID became the actual primary key (instead of an
internal auto-increment number), the old `database.db` is **not compatible**
with the new schema. On first run, the app automatically detects this,
renames your old database file to `database.old.<timestamp>.db` as a backup,
and creates a fresh one. This means **existing test accounts will need to
register again** — but no old data is silently deleted, it's just backed up
alongside the new file.

## 4. Sign up / login page redesign
- The Sign In / Sign Up page (`index.html`) was restyled to match the light
  "Student Registration" reference look you shared: white card, bold
  uppercase purple field labels, a green title and green submit buttons,
  on a soft light-gray page background.
- The Kampala University logo (`Logo.PNG`, also copied to
  `frontend/logo.png` so the browser can load it) is used as a faint
  watermark sitting behind the form fields inside the card.
- This restyle is scoped to the auth page only — the feed/dashboard page
  keeps its original dark theme, since that wasn't part of the request.

## 5. Sidebar menu, Members directory, private messaging & search
- **Sidebar menu**: the left sidebar now has a menu at the top — **Feed**,
  **Members**, **Messages** (with a red badge showing pending request
  count), and **About**.
- **About**: a modal explaining what KU Chat House is and how it works.
- **Members**: browse every registered user, searchable by username or
  University ID. Each member shows a **Connect** button.
- **Connection requests**: sending a request puts it in the other
  person's **Messages → Requests** tab, where they can **Accept** or
  **Decline**. If two people request each other at the same time, it's
  auto-accepted instead of creating a duplicate.
- **Private messaging**: you can only message someone once they've
  **accepted** your request — enforced on the backend too, not just hidden
  in the UI. Once accepted, open **Messages → Chats** to message them
  directly.
- **Search**: the nav bar search box looks up both **members** (by
  username/ID) and **posts** (by content or author) as you type. Clicking
  a member result opens the Members panel filtered to them; clicking a
  post result scrolls the feed to that post and briefly highlights it.
- **Logout button**: now shows the word **"Log Out"** next to the icon
  (previously icon-only), so it's unambiguous. On very small screens it
  collapses back to icon-only to save space.


Nothing changed about how you run the app — `run.bat` still works the same
way, or manually:
```
cd backend
pip install -r requirements.txt
python app.py
```
Then visit http://localhost:5000

## 6. Visual redesign -- "Campus at Dusk"
The dark feed theme was reworked from a generic indigo SaaS look into a
palette grounded in the university's own visual world:
- **Color**: crest green as the primary accent, brass/gold and maroon
  borrowed from academic regalia (gold = lecturer/PhD hood, maroon =
  administrator/doctoral authority, dusty denim blue = student ID), and a
  warm rust in place of stock red for delete/danger actions. Background
  deepened to a near-black with a green undertone rather than navy/slate.
- **Type**: headings now use Fraunces, a collegiate serif, paired with the
  existing Inter for body text and labels -- shared across both the dark
  feed page and the light auth page, so the two screens read as one product.
- **Signature detail**: pinned announcements are now styled like an actual
  index card tacked to a noticeboard -- a small brass pushpin, a faint tilt,
  and a lifted shadow -- instead of a plain colored sidebar stripe.
- **Ambient blobs, buttons, badges, chat bubbles, and modals** all now pull
  from the same token set, so the recolor is consistent everywhere rather
  than a few isolated screens.
- Auth page colors are untouched (they still match the registration form
  reference you shared); only its heading font now matches the feed page.

## 7. Standalone pages, visible comments with reactions, group chats & media, and profile bios

**Members, Messages, and About are now real pages, not modals**
- Visiting `/members`, `/messages`, or `/about` loads a standalone page with
  its own URL, browser history entry, and shareable link -- the sidebar
  links are plain `<a href>` tags now, not JavaScript popups.
- All four pages (`Feed`, `Members`, `Messages`, `About`) share the same
  nav bar and sidebar shell for a consistent look.

**Comments are visible immediately, and you can react to them**
- Comments used to be hidden behind a "Comments (N)" click; they now render
  directly under each post as soon as it loads. The button still lets you
  collapse a long thread if you want to.
- Each comment has a heart/like button with a live count
  (`POST /api/comments/:id/like` toggles it). Backed by a `comment_likes`
  table so a member can only like a given comment once.

**Private messaging: groups + media sharing**
- The Messages page now has three tabs: **Chats** (1:1), **Groups**, and
  **Requests**.
- **New Group**: pick any of your accepted connections and start a group
  chat. Only people you're connected with can be added -- the consent model
  extends to groups, not just 1:1 chats.
- Both direct messages and group messages can carry a photo or audio
  attachment, the same way posts do (paperclip icon in the chat input).
- New tables: `groups`, `group_members`, `group_messages`; the `messages`
  table gained `media_path`/`media_type` columns.

**Profile bio**
- Added a `bio` field (280 characters, editable in Edit Profile with a live
  counter). It's visible on your own sidebar profile card and on your row
  in the Members directory, so people can actually learn something about
  you before connecting.

### Note on this update
Because `messages` and `users` changed shape (new columns) and three new
tables were added, the auto-migration in `database.py` will back up any
existing `database.db` and start fresh the first time you run this version
-- same safety-net behavior as previous schema changes.
