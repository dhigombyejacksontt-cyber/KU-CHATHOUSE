import sqlite3
import os
import shutil
import time
from werkzeug.security import generate_password_hash, check_password_hash

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'database.db')
SCHEMA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'schema.sql')

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def _needs_migration():
    """Detect an old-style database (missing columns/tables introduced by a
    newer schema.sql) so we can safely rebuild it with the current schema."""
    if not os.path.exists(DB_PATH):
        return False
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(users)")
        columns = {row[1] for row in cursor.fetchall()}
        conn.close()
        if columns and ('profile_photo' not in columns or 'bio' not in columns):
            return True
        return False
    except Exception:
        return False

def init_db():
    if not os.path.exists(SCHEMA_PATH):
        raise FileNotFoundError(f"Schema file not found at {SCHEMA_PATH}")

    if _needs_migration():
        backup_path = os.path.join(
            os.path.dirname(DB_PATH), f"database.old.{int(time.time())}.db"
        )
        shutil.move(DB_PATH, backup_path)
        print(f"[MIGRATION] Old database schema detected. Backed up to {backup_path}. "
              f"A fresh database will be created (existing accounts must re-register).")

    with open(SCHEMA_PATH, 'r') as f:
        schema_sql = f.read()

    conn = get_db_connection()
    try:
        conn.executescript(schema_sql)
        conn.execute("""CREATE TABLE IF NOT EXISTS approved_staff (
            staff_id TEXT PRIMARY KEY, full_name TEXT NOT NULL, official_email TEXT UNIQUE NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('Lecturer', 'Administrator')), faculty TEXT NOT NULL,
            is_registered INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""")
        conn.commit()
        print("Database initialized successfully.")
    except Exception as e:
        print(f"Error initializing database: {e}")
        conn.rollback()
    finally:
        conn.close()

# ==========================================================================
# User Operations
# ==========================================================================

def get_approved_staff(staff_id=None):
    conn = get_db_connection(); cursor = conn.cursor()
    try:
        if staff_id:
            cursor.execute("SELECT * FROM approved_staff WHERE staff_id = ?", (staff_id,)); row = cursor.fetchone(); return dict(row) if row else None
        cursor.execute("SELECT staff_id, full_name, official_email, role, faculty, is_registered, created_at FROM approved_staff ORDER BY created_at DESC")
        return [dict(row) for row in cursor.fetchall()]
    finally: conn.close()

def approve_staff(staff_id, full_name, official_email, role, faculty):
    conn = get_db_connection(); cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO approved_staff (staff_id, full_name, official_email, role, faculty) VALUES (?, ?, ?, ?, ?)", (staff_id, full_name, official_email, role, faculty))
        conn.commit(); return {"success": True, "staff_id": staff_id}
    except sqlite3.IntegrityError:
        conn.rollback(); return {"error": "Staff ID or official email is already in the staff directory."}
    finally: conn.close()

def create_user(username, university_id, category, email, contact, dob, faculty, password, verification_code):
    conn = get_db_connection()
    cursor = conn.cursor()
    password_hash = generate_password_hash(password)
    try:
        cursor.execute(
            """
            INSERT INTO users (university_id, username, category, email, contact, dob, faculty, password_hash, verification_code, is_verified)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
            """,
            (university_id, username, category, email, contact, dob, faculty, password_hash, verification_code)
        )
        if category in ('Lecturer', 'Administrator'):
            cursor.execute("UPDATE approved_staff SET is_registered = 1 WHERE staff_id = ?", (university_id,))
        conn.commit()
        return {"university_id": university_id, "username": username}
    except sqlite3.IntegrityError as e:
        conn.rollback()
        err_msg = str(e)
        if 'username' in err_msg:
            return {"error": "Username already exists."}
        elif 'university_id' in err_msg:
            return {"error": "University ID already registered."}
        elif 'email' in err_msg:
            return {"error": "Email address already registered."}
        else:
            return {"error": f"Registration failed: {err_msg}"}
    finally:
        conn.close()

def verify_user(university_id, code):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT verification_code FROM users WHERE university_id = ?", (university_id,))
        user = cursor.fetchone()
        if not user:
            return {"error": "User not found."}

        if user['verification_code'] == code:
            cursor.execute("UPDATE users SET is_verified = 1, verification_code = NULL WHERE university_id = ?", (university_id,))
            conn.commit()
            return {"success": True}
        else:
            return {"error": "Invalid verification code."}
    finally:
        conn.close()

def get_user_by_university_id(university_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM users WHERE university_id = ?", (university_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def check_user_credentials(university_id, password):
    user = get_user_by_university_id(university_id)
    if not user:
        return {"error": "User does not exist."}

    if not user['is_verified']:
        return {"error": "Account not verified. Please verify your email.", "unverified": True, "university_id": user['university_id']}

    if check_password_hash(user['password_hash'], password):
        return {"success": True, "user": {
            "university_id": user['university_id'],
            "username": user['username'],
            "category": user['category'],
            "email": user['email'],
            "faculty": user['faculty'],
            "profile_photo": user['profile_photo'],
            "bio": user['bio']
        }}
    else:
        return {"error": "Invalid credentials."}

def get_user_by_id(university_id):
    """Public-safe user profile lookup (no password hash / verification code)."""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT university_id, username, category, email, contact, dob, faculty, profile_photo, bio, created_at "
            "FROM users WHERE university_id = ?",
            (university_id,)
        )
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def update_username(university_id, new_username):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT university_id FROM users WHERE username = ? AND university_id != ?", (new_username, university_id))
        if cursor.fetchone():
            return {"error": "That username is already taken."}

        cursor.execute("UPDATE users SET username = ? WHERE university_id = ?", (new_username, university_id))
        conn.commit()
        if cursor.rowcount == 0:
            return {"error": "User not found."}
        return {"success": True, "username": new_username}
    finally:
        conn.close()

def update_profile_photo(university_id, photo_path):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT profile_photo FROM users WHERE university_id = ?", (university_id,))
        row = cursor.fetchone()
        if not row:
            return {"error": "User not found."}
        old_photo = row['profile_photo']

        cursor.execute("UPDATE users SET profile_photo = ? WHERE university_id = ?", (photo_path, university_id))
        conn.commit()
        return {"success": True, "profile_photo": photo_path, "old_photo": old_photo}
    finally:
        conn.close()

def update_bio(university_id, bio):
    """Update the short self-description shown on the member's profile."""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        if len(bio) > 280:
            return {"error": "Bio must be 280 characters or fewer."}
        cursor.execute("UPDATE users SET bio = ? WHERE university_id = ?", (bio, university_id))
        conn.commit()
        if cursor.rowcount == 0:
            return {"error": "User not found."}
        return {"success": True, "bio": bio}
    finally:
        conn.close()


# ==========================================================================
# Post Operations
# ==========================================================================

def create_post(user_id, content, post_type='post', is_pinned=0, media_path=None, media_type=None):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT category FROM users WHERE university_id = ?", (user_id,))
        user = cursor.fetchone()
        if not user:
            return {"error": "User not found."}

        if post_type == 'announcement':
            if user['category'] != 'Administrator':
                return {"error": "Only Administrators can post announcements."}
            is_pinned = 1

        cursor.execute(
            "INSERT INTO posts (user_id, content, type, is_pinned, media_path, media_type) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, content, post_type, is_pinned, media_path, media_type)
        )
        conn.commit()
        post_id = cursor.lastrowid
        return {"id": post_id, "success": True}
    finally:
        conn.close()

def get_posts():
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT p.id, p.user_id, p.content, p.media_path, p.media_type, p.type, p.is_pinned, p.created_at,
                   u.username, u.category, u.faculty, u.profile_photo
            FROM posts p
            JOIN users u ON p.user_id = u.university_id
            ORDER BY p.is_pinned DESC, p.created_at DESC
            """
        )
        rows = cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()

def get_post_by_id(post_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT p.id, p.user_id, p.content, p.media_path, p.media_type, p.type, p.is_pinned, p.created_at,
                   u.username, u.category, u.faculty, u.profile_photo
            FROM posts p
            JOIN users u ON p.user_id = u.university_id
            WHERE p.id = ?
            """,
            (post_id,)
        )
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def update_post(post_id, user_id, content):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT user_id FROM posts WHERE id = ?", (post_id,))
        post = cursor.fetchone()
        if not post:
            return {"error": "Post not found."}
        if post['user_id'] != user_id:
            return {"error": "Unauthorized to edit this post."}

        cursor.execute("UPDATE posts SET content = ? WHERE id = ?", (content, post_id))
        conn.commit()
        return {"success": True}
    finally:
        conn.close()

def delete_post(post_id, user_id):
    """Only the person who created the post may delete it."""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT user_id, media_path FROM posts WHERE id = ?", (post_id,))
        post = cursor.fetchone()
        if not post:
            return {"error": "Post not found."}

        if post['user_id'] != user_id:
            return {"error": "You can only delete posts that you posted."}

        cursor.execute("DELETE FROM posts WHERE id = ?", (post_id,))
        conn.commit()
        return {"success": True, "media_path": post['media_path']}
    finally:
        conn.close()


# ==========================================================================
# Comment Operations
# ==========================================================================

def create_comment(post_id, user_id, content):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT type FROM posts WHERE id = ?", (post_id,))
        post = cursor.fetchone()
        if not post:
            return {"error": "Post not found."}
        if post['type'] == 'announcement':
            return {"error": "Announcements do not support comments."}

        cursor.execute(
            "INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)",
            (post_id, user_id, content)
        )
        conn.commit()
        comment_id = cursor.lastrowid
        return {"id": comment_id, "success": True}
    finally:
        conn.close()

def get_comments(post_id, current_user_id=None):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT c.id, c.post_id, c.user_id, c.content, c.created_at,
                   u.username, u.category, u.faculty, u.profile_photo
            FROM comments c
            JOIN users u ON c.user_id = u.university_id
            WHERE c.post_id = ?
            ORDER BY c.created_at ASC
            """,
            (post_id,)
        )
        rows = [dict(row) for row in cursor.fetchall()]

        for row in rows:
            cursor.execute("SELECT COUNT(*) as cnt FROM comment_likes WHERE comment_id = ?", (row['id'],))
            row['like_count'] = cursor.fetchone()['cnt']
            if current_user_id:
                cursor.execute(
                    "SELECT 1 FROM comment_likes WHERE comment_id = ? AND user_id = ?",
                    (row['id'], current_user_id)
                )
                row['liked_by_me'] = cursor.fetchone() is not None
            else:
                row['liked_by_me'] = False

        return rows
    finally:
        conn.close()

def toggle_comment_like(comment_id, user_id):
    """Like a comment, or un-like it if the member already liked it."""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id FROM comments WHERE id = ?", (comment_id,))
        if not cursor.fetchone():
            return {"error": "Comment not found."}

        cursor.execute("SELECT 1 FROM comment_likes WHERE comment_id = ? AND user_id = ?", (comment_id, user_id))
        already_liked = cursor.fetchone() is not None

        if already_liked:
            cursor.execute("DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?", (comment_id, user_id))
            liked = False
        else:
            cursor.execute("INSERT INTO comment_likes (comment_id, user_id) VALUES (?, ?)", (comment_id, user_id))
            liked = True

        conn.commit()
        cursor.execute("SELECT COUNT(*) as cnt FROM comment_likes WHERE comment_id = ?", (comment_id,))
        count = cursor.fetchone()['cnt']
        return {"success": True, "liked": liked, "like_count": count}
    finally:
        conn.close()


# ==========================================================================
# Reply Operations
# ==========================================================================

def create_reply(comment_id, user_id, content):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT post_id FROM comments WHERE id = ?", (comment_id,))
        comment = cursor.fetchone()
        if not comment:
            return {"error": "Comment not found."}

        cursor.execute(
            "INSERT INTO replies (comment_id, user_id, content) VALUES (?, ?, ?)",
            (comment_id, user_id, content)
        )
        conn.commit()
        reply_id = cursor.lastrowid
        return {"id": reply_id, "success": True}
    finally:
        conn.close()

def get_replies(comment_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT r.id, r.comment_id, r.user_id, r.content, r.created_at,
                   u.username, u.category, u.faculty, u.profile_photo
            FROM replies r
            JOIN users u ON r.user_id = u.university_id
            WHERE r.comment_id = ?
            ORDER BY r.created_at ASC
            """
        )
        rows = cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


# ==========================================================================
# Search Operations
# ==========================================================================

def search_posts(query):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        like = f"%{query}%"
        cursor.execute(
            """
            SELECT p.id, p.user_id, p.content, p.media_path, p.media_type, p.type, p.is_pinned, p.created_at,
                   u.username, u.category, u.faculty, u.profile_photo
            FROM posts p
            JOIN users u ON p.user_id = u.university_id
            WHERE p.content LIKE ? OR u.username LIKE ?
            ORDER BY p.created_at DESC
            LIMIT 25
            """,
            (like, like)
        )
        rows = cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


# ==========================================================================
# Member Directory + Connection (friend request) Operations
# ==========================================================================

def get_all_members(current_user_id, search=None):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        if search:
            like = f"%{search}%"
            cursor.execute(
                """
                SELECT university_id, username, category, faculty, profile_photo, bio
                FROM users
                WHERE university_id != ? AND (username LIKE ? OR university_id LIKE ?)
                ORDER BY username COLLATE NOCASE ASC
                """,
                (current_user_id, like, like)
            )
        else:
            cursor.execute(
                """
                SELECT university_id, username, category, faculty, profile_photo, bio
                FROM users
                WHERE university_id != ?
                ORDER BY username COLLATE NOCASE ASC
                """,
                (current_user_id,)
            )
        members = [dict(row) for row in cursor.fetchall()]

        cursor.execute(
            "SELECT requester_id, recipient_id, status FROM connections WHERE requester_id = ? OR recipient_id = ?",
            (current_user_id, current_user_id)
        )
        conn_rows = cursor.fetchall()
        status_map = {}
        for row in conn_rows:
            other = row['recipient_id'] if row['requester_id'] == current_user_id else row['requester_id']
            if row['status'] == 'accepted':
                status_map[other] = 'accepted'
            elif row['status'] == 'pending':
                status_map[other] = 'pending_sent' if row['requester_id'] == current_user_id else 'pending_received'

        for m in members:
            m['connection_status'] = status_map.get(m['university_id'], 'none')

        return members
    finally:
        conn.close()

def get_connection_row(user_a, user_b):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT * FROM connections WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)",
            (user_a, user_b, user_b, user_a)
        )
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def send_connection_request(requester_id, recipient_id):
    if requester_id == recipient_id:
        return {"error": "You can't send a request to yourself."}

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT university_id FROM users WHERE university_id = ?", (recipient_id,))
        if not cursor.fetchone():
            return {"error": "Member not found."}

        existing = get_connection_row(requester_id, recipient_id)
        if existing:
            if existing['status'] == 'accepted':
                return {"error": "You're already connected with this member."}
            if existing['requester_id'] == requester_id:
                return {"error": "Request already sent."}
            else:
                cursor.execute(
                    "UPDATE connections SET status = 'accepted', responded_at = CURRENT_TIMESTAMP "
                    "WHERE requester_id = ? AND recipient_id = ?",
                    (existing['requester_id'], existing['recipient_id'])
                )
                conn.commit()
                return {"success": True, "status": "accepted"}

        cursor.execute(
            "INSERT INTO connections (requester_id, recipient_id, status) VALUES (?, ?, 'pending')",
            (requester_id, recipient_id)
        )
        conn.commit()
        return {"success": True, "status": "pending"}
    finally:
        conn.close()

def respond_connection_request(user_id, requester_id, action):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT * FROM connections WHERE requester_id = ? AND recipient_id = ? AND status = 'pending'",
            (requester_id, user_id)
        )
        row = cursor.fetchone()
        if not row:
            return {"error": "Request not found."}

        if action == 'accept':
            cursor.execute(
                "UPDATE connections SET status = 'accepted', responded_at = CURRENT_TIMESTAMP "
                "WHERE requester_id = ? AND recipient_id = ?",
                (requester_id, user_id)
            )
        elif action == 'decline':
            cursor.execute(
                "DELETE FROM connections WHERE requester_id = ? AND recipient_id = ?",
                (requester_id, user_id)
            )
        else:
            return {"error": "Invalid action."}

        conn.commit()
        return {"success": True}
    finally:
        conn.close()

def get_incoming_requests(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT c.requester_id, c.created_at,
                   u.username, u.category, u.faculty, u.profile_photo
            FROM connections c
            JOIN users u ON c.requester_id = u.university_id
            WHERE c.recipient_id = ? AND c.status = 'pending'
            ORDER BY c.created_at DESC
            """,
            (user_id,)
        )
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()

def get_accepted_connections(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT requester_id, recipient_id FROM connections WHERE (requester_id = ? OR recipient_id = ?) AND status = 'accepted'",
            (user_id, user_id)
        )
        rows = cursor.fetchall()
        results = []
        for row in rows:
            other_id = row['recipient_id'] if row['requester_id'] == user_id else row['requester_id']
            cursor.execute(
                "SELECT university_id, username, category, faculty, profile_photo FROM users WHERE university_id = ?",
                (other_id,)
            )
            other = cursor.fetchone()
            if not other:
                continue
            cursor.execute(
                "SELECT content, media_type, created_at, sender_id FROM messages "
                "WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?) "
                "ORDER BY created_at DESC LIMIT 1",
                (user_id, other_id, other_id, user_id)
            )
            last_msg = cursor.fetchone()
            cursor.execute(
                "SELECT COUNT(*) as cnt FROM messages WHERE sender_id = ? AND recipient_id = ? AND is_read = 0",
                (other_id, user_id)
            )
            unread = cursor.fetchone()['cnt']

            entry = dict(other)
            entry['last_message'] = last_msg['content'] if last_msg else None
            entry['last_message_media_type'] = last_msg['media_type'] if last_msg else None
            entry['last_message_at'] = last_msg['created_at'] if last_msg else None
            entry['unread_count'] = unread
            results.append(entry)

        results.sort(key=lambda e: e['last_message_at'] or '', reverse=True)
        return results
    finally:
        conn.close()


# ==========================================================================
# Private Message Operations (only between accepted connections)
# ==========================================================================

def send_message(sender_id, recipient_id, content, media_path=None, media_type=None):
    connection = get_connection_row(sender_id, recipient_id)
    if not connection or connection['status'] != 'accepted':
        return {"error": "You can only message members who have accepted your connection request."}

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO messages (sender_id, recipient_id, content, media_path, media_type) VALUES (?, ?, ?, ?, ?)",
            (sender_id, recipient_id, content, media_path, media_type)
        )
        conn.commit()
        return {"success": True, "id": cursor.lastrowid}
    finally:
        conn.close()

def get_conversation(user_id, other_id):
    connection = get_connection_row(user_id, other_id)
    if not connection or connection['status'] != 'accepted':
        return {"error": "You are not connected with this member."}

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT id, sender_id, recipient_id, content, media_path, media_type, created_at, is_read FROM messages "
            "WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?) "
            "ORDER BY created_at ASC",
            (user_id, other_id, other_id, user_id)
        )
        messages = [dict(row) for row in cursor.fetchall()]

        cursor.execute(
            "UPDATE messages SET is_read = 1 WHERE sender_id = ? AND recipient_id = ? AND is_read = 0",
            (other_id, user_id)
        )
        conn.commit()
        return {"success": True, "messages": messages}
    finally:
        conn.close()


# ==========================================================================
# Group Chat Operations
# ==========================================================================

def create_group(creator_id, name, member_ids, description=None):
    if not name or not name.strip():
        return {"error": "Group name is required."}

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO groups (name, description, creator_id) VALUES (?, ?, ?)",
            (name.strip(), description, creator_id)
        )
        group_id = cursor.lastrowid

        cursor.execute("INSERT INTO group_members (group_id, user_id) VALUES (?, ?)", (group_id, creator_id))

        added = 0
        for member_id in set(member_ids):
            if member_id == creator_id:
                continue
            connection = get_connection_row(creator_id, member_id)
            if connection and connection['status'] == 'accepted':
                cursor.execute(
                    "INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)",
                    (group_id, member_id)
                )
                added += 1

        conn.commit()
        return {"success": True, "id": group_id, "members_added": added}
    finally:
        conn.close()

def is_group_member(group_id, user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?", (group_id, user_id))
        return cursor.fetchone() is not None
    finally:
        conn.close()

def get_user_groups(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT g.id, g.name, g.description, g.group_photo, g.creator_id, g.created_at
            FROM groups g
            JOIN group_members gm ON gm.group_id = g.id
            WHERE gm.user_id = ?
            ORDER BY g.created_at DESC
            """,
            (user_id,)
        )
        groups = [dict(row) for row in cursor.fetchall()]

        for g in groups:
            cursor.execute("SELECT COUNT(*) as cnt FROM group_members WHERE group_id = ?", (g['id'],))
            g['member_count'] = cursor.fetchone()['cnt']

            cursor.execute(
                "SELECT gm.content, gm.media_type, gm.created_at, u.username FROM group_messages gm "
                "JOIN users u ON gm.sender_id = u.university_id "
                "WHERE gm.group_id = ? ORDER BY gm.created_at DESC LIMIT 1",
                (g['id'],)
            )
            last_msg = cursor.fetchone()
            g['last_message'] = last_msg['content'] if last_msg else None
            g['last_message_media_type'] = last_msg['media_type'] if last_msg else None
            g['last_message_at'] = last_msg['created_at'] if last_msg else None
            g['last_message_from'] = last_msg['username'] if last_msg else None

        groups.sort(key=lambda g: g['last_message_at'] or g['created_at'] or '', reverse=True)
        return groups
    finally:
        conn.close()

def get_group_details(group_id, user_id):
    if not is_group_member(group_id, user_id):
        return {"error": "You are not a member of this group."}

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id, name, description, group_photo, creator_id, created_at FROM groups WHERE id = ?", (group_id,))
        group = cursor.fetchone()
        if not group:
            return {"error": "Group not found."}
        group = dict(group)

        cursor.execute(
            """
            SELECT u.university_id, u.username, u.category, u.profile_photo
            FROM group_members gm JOIN users u ON gm.user_id = u.university_id
            WHERE gm.group_id = ?
            ORDER BY u.username COLLATE NOCASE ASC
            """,
            (group_id,)
        )
        group['members'] = [dict(row) for row in cursor.fetchall()]
        return {"success": True, "group": group}
    finally:
        conn.close()

def add_group_member(group_id, requester_id, new_member_id):
    if not is_group_member(group_id, requester_id):
        return {"error": "You are not a member of this group."}

    connection = get_connection_row(requester_id, new_member_id)
    if not connection or connection['status'] != 'accepted':
        return {"error": "You can only add members you're connected with."}

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)", (group_id, new_member_id))
        conn.commit()
        return {"success": True}
    finally:
        conn.close()

def leave_group(group_id, user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM group_members WHERE group_id = ? AND user_id = ?", (group_id, user_id))
        conn.commit()
        if cursor.rowcount == 0:
            return {"error": "You are not a member of this group."}
        cursor.execute("SELECT COUNT(*) as cnt FROM group_members WHERE group_id = ?", (group_id,))
        if cursor.fetchone()['cnt'] == 0:
            cursor.execute("DELETE FROM groups WHERE id = ?", (group_id,))
            conn.commit()
        return {"success": True}
    finally:
        conn.close()

def send_group_message(group_id, sender_id, content, media_path=None, media_type=None):
    if not is_group_member(group_id, sender_id):
        return {"error": "You are not a member of this group."}

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO group_messages (group_id, sender_id, content, media_path, media_type) VALUES (?, ?, ?, ?, ?)",
            (group_id, sender_id, content, media_path, media_type)
        )
        conn.commit()
        return {"success": True, "id": cursor.lastrowid}
    finally:
        conn.close()

def get_group_messages(group_id, user_id):
    if not is_group_member(group_id, user_id):
        return {"error": "You are not a member of this group."}

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT gm.id, gm.group_id, gm.sender_id, gm.content, gm.media_path, gm.media_type, gm.created_at,
                   u.username, u.profile_photo
            FROM group_messages gm
            JOIN users u ON gm.sender_id = u.university_id
            WHERE gm.group_id = ?
            ORDER BY gm.created_at ASC
            """,
            (group_id,)
        )
        return {"success": True, "messages": [dict(row) for row in cursor.fetchall()]}
    finally:
        conn.close()
