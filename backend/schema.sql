
-- Approved staff directory. Lecturers and administrators must be provisioned
-- here by an existing administrator before they can create an account.
CREATE TABLE IF NOT EXISTS approved_staff (
    staff_id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    official_email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('Lecturer', 'Administrator')),
    faculty TEXT NOT NULL,
    is_registered INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Users table: university_id is now the PRIMARY KEY. It is immutable and is
-- the value used to log in. Username is separate and can be changed freely.
CREATE TABLE IF NOT EXISTS users (
    university_id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    category TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    contact TEXT NOT NULL,
    dob TEXT NOT NULL,
    faculty TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    profile_photo TEXT,                 -- relative URL to uploaded avatar, NULL if none
    bio TEXT,                           -- short self-description, shown on profile/members list
    is_verified INTEGER DEFAULT 0,
    verification_code TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,              -- references users.university_id
    content TEXT,                       -- may be empty if a media file is attached
    media_path TEXT,                    -- relative URL to uploaded photo/audio, NULL if none
    media_type TEXT,                    -- 'image', 'audio', or NULL
    type TEXT DEFAULT 'post',           -- 'post' or 'announcement'
    is_pinned INTEGER DEFAULT 0,        -- 1 for pinned, 0 for not
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(university_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,              -- references users.university_id
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(university_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comment_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,              -- references users.university_id
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(comment_id) REFERENCES comments(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(university_id) ON DELETE CASCADE
);

-- One row per member who reacted (liked) a comment. Composite PK means a
-- member can only react once per comment -- reacting again just removes it.
CREATE TABLE IF NOT EXISTS comment_likes (
    comment_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (comment_id, user_id),
    FOREIGN KEY(comment_id) REFERENCES comments(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(university_id) ON DELETE CASCADE
);

-- A connection request between two members. Private messaging is only
-- allowed once status = 'accepted'.
CREATE TABLE IF NOT EXISTS connections (
    requester_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',   -- 'pending' or 'accepted'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    responded_at TIMESTAMP,
    PRIMARY KEY (requester_id, recipient_id),
    FOREIGN KEY(requester_id) REFERENCES users(university_id) ON DELETE CASCADE,
    FOREIGN KEY(recipient_id) REFERENCES users(university_id) ON DELETE CASCADE
);

-- Private 1:1 messages. Only exchanged between members with an accepted
-- connection. Can carry text and/or an attached photo/audio clip.
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    content TEXT,                       -- may be empty if a media file is attached
    media_path TEXT,
    media_type TEXT,                    -- 'image', 'audio', or NULL
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_read INTEGER DEFAULT 0,
    FOREIGN KEY(sender_id) REFERENCES users(university_id) ON DELETE CASCADE,
    FOREIGN KEY(recipient_id) REFERENCES users(university_id) ON DELETE CASCADE
);

-- Group chats. Any member can create one and add members they're connected with.
CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    group_photo TEXT,
    creator_id TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(creator_id) REFERENCES users(university_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS group_members (
    group_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(university_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS group_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    sender_id TEXT NOT NULL,
    content TEXT,                       -- may be empty if a media file is attached
    media_path TEXT,
    media_type TEXT,                    -- 'image', 'audio', or NULL
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY(sender_id) REFERENCES users(university_id) ON DELETE CASCADE
);
