from flask import Flask, request, jsonify, session, send_from_directory
import os
import re
import random
import sys
import uuid
from werkzeug.utils import secure_filename
import database

database.init_db()

app = Flask(__name__, static_folder='../frontend', static_url_path='')
app.secret_key = 'kampala_university_chat_house_secret_key_987654321'

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_ROOT = os.path.join(BASE_DIR, 'uploads')
AVATAR_DIR = os.path.join(UPLOAD_ROOT, 'avatars')
POST_MEDIA_DIR = os.path.join(UPLOAD_ROOT, 'posts')
CHAT_MEDIA_DIR = os.path.join(UPLOAD_ROOT, 'chat')
os.makedirs(AVATAR_DIR, exist_ok=True)
os.makedirs(POST_MEDIA_DIR, exist_ok=True)
os.makedirs(CHAT_MEDIA_DIR, exist_ok=True)

app.config['MAX_CONTENT_LENGTH'] = 25 * 1024 * 1024  # 25 MB upload cap

ALLOWED_IMAGE_EXT = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
ALLOWED_AUDIO_EXT = {'mp3', 'wav', 'ogg', 'm4a', 'webm', 'aac'}

def get_file_ext(filename):
    return filename.rsplit('.', 1)[1].lower() if '.' in filename else ''

def classify_media(filename):
    ext = get_file_ext(filename)
    if ext in ALLOWED_IMAGE_EXT:
        return 'image', ext
    if ext in ALLOWED_AUDIO_EXT:
        return 'audio', ext
    return None, ext

@app.route('/uploads/<path:subpath>')
def serve_upload(subpath):
    return send_from_directory(UPLOAD_ROOT, subpath)

def get_current_user_id():
    return session.get('user_id')

# ==========================================================================
# Frontend page routes
# ==========================================================================
@app.route('/')
def serve_index():
    return app.send_static_file('index.html')

@app.route('/feed')
def serve_feed():
    return app.send_static_file('feed.html')

@app.route('/members')
def serve_members():
    return app.send_static_file('members.html')

@app.route('/messages')
def serve_messages():
    return app.send_static_file('messages.html')

@app.route('/about')
def serve_about():
    return app.send_static_file('about.html')

@app.route('/profile')
def serve_profile():
    return app.send_static_file('profile.html')


# ==========================================================================
# Auth API Endpoints
# ==========================================================================
@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.get_json() or {}
    username = data.get('username', '').strip()
    university_id = data.get('university_id', '').strip()
    category = data.get('category', '').strip()
    email = data.get('email', '').strip()
    contact = data.get('contact', '').strip()
    dob = data.get('dob', '').strip()
    faculty = data.get('faculty', '').strip()
    password = data.get('password', '').strip()

    if not (username and university_id and category and email and contact and dob and faculty and password):
        return jsonify({"error": "All fields are required."}), 400

    if category not in ['Student', 'Lecturer', 'Administrator']:
        return jsonify({"error": "Invalid user category."}), 400

    if not re.match(r'^KU\d+$', university_id, re.IGNORECASE):
        return jsonify({"error": "Institution ID must start with KU followed by digits only (e.g. KU0132442924)."}), 400

    if category in ('Lecturer', 'Administrator'):
        approved = database.get_approved_staff(university_id.upper())
        if not approved:
            return jsonify({"error": "This staff ID has not been approved by an administrator."}), 403
        if approved['role'] != category:
            return jsonify({"error": "The staff ID is registered for a different role."}), 403
        if approved['official_email'].lower() != email.lower():
            return jsonify({"error": "Use the official email assigned to this staff ID."}), 403
        if approved['is_registered']:
            return jsonify({"error": "This staff ID already has an account."}), 400

    verification_code = f"{random.randint(100000, 999999)}"

    print(f"\n[GMAIL SIMULATION] Sent verification email to {email}")
    print(f"[GMAIL SIMULATION] Verification Code for {username} ({university_id}): {verification_code}\n", file=sys.stderr)

    res = database.create_user(
        username=username, university_id=university_id, category=category,
        email=email, contact=contact, dob=dob, faculty=faculty,
        password=password, verification_code=verification_code
    )

    if "error" in res:
        return jsonify(res), 400

    return jsonify({
        "success": True,
        "message": "Account created. Verification code sent to simulated Gmail.",
        "university_id": university_id,
        "simulation_code": verification_code
    }), 201

@app.route('/api/admin/staff', methods=['GET', 'POST'])
def manage_staff():
    user_id = session.get('user_id')
    if not user_id: return jsonify({"error": "Authentication required."}), 401
    current = database.get_user_by_university_id(user_id)
    if not current or current['category'] != 'Administrator': return jsonify({"error": "Administrator access required."}), 403
    if request.method == 'GET': return jsonify({"staff": database.get_approved_staff()})
    data = request.get_json() or {}
    staff_id = data.get('staff_id', '').strip().upper(); full_name = data.get('full_name', '').strip()
    official_email = data.get('official_email', '').strip().lower(); role = data.get('role', '').strip(); faculty = data.get('faculty', '').strip()
    if not all([staff_id, full_name, official_email, role, faculty]): return jsonify({"error": "All staff directory fields are required."}), 400
    if not re.match(r'^KU\d+$', staff_id, re.IGNORECASE): return jsonify({"error": "Staff ID must start with KU followed by digits only (e.g. KU0047)."}), 400
    result = database.approve_staff(staff_id, full_name, official_email, role, faculty)
    return jsonify(result), 201 if result.get('success') else 400


@app.route('/api/auth/verify', methods=['POST'])
def verify():
    data = request.get_json() or {}
    university_id = data.get('university_id', '').strip()
    code = data.get('code', '').strip()

    if not (university_id and code):
        return jsonify({"error": "University ID and code are required."}), 400

    res = database.verify_user(university_id, code)
    if "error" in res:
        return jsonify(res), 400

    return jsonify({"success": True, "message": "Email verified successfully. You can now log in."}), 200

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    university_id = data.get('university_id', '').strip()
    password = data.get('password', '').strip()

    if not (university_id and password):
        return jsonify({"error": "University ID and password are required."}), 400

    res = database.check_user_credentials(university_id, password)
    if "error" in res:
        response_data = {"error": res["error"]}
        if res.get("unverified"):
            response_data["unverified"] = True
            response_data["university_id"] = res["university_id"]
        return jsonify(response_data), 401

    user_info = res["user"]
    session['user_id'] = user_info['university_id']
    session['username'] = user_info['username']
    session['category'] = user_info['category']
    session['faculty'] = user_info['faculty']

    return jsonify({"success": True, "user": user_info}), 200

@app.route('/api/auth/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({"success": True, "message": "Logged out successfully."}), 200

@app.route('/api/auth/me', methods=['GET'])
def get_me():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    user = database.get_user_by_id(user_id)
    if not user:
        session.clear()
        return jsonify({"error": "User not found"}), 401

    return jsonify({"user": user}), 200


# ==========================================================================
# Profile API Endpoints
# ==========================================================================
@app.route('/api/profile/username', methods=['PUT'])
def update_username_route():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json() or {}
    new_username = data.get('username', '').strip()

    if not new_username:
        return jsonify({"error": "Username cannot be empty."}), 400
    if len(new_username) < 3:
        return jsonify({"error": "Username must be at least 3 characters."}), 400

    res = database.update_username(user_id, new_username)
    if "error" in res:
        return jsonify(res), 400

    session['username'] = new_username
    return jsonify({"success": True, "username": new_username}), 200

@app.route('/api/profile/bio', methods=['PUT'])
def update_bio_route():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json() or {}
    bio = (data.get('bio') or '').strip()

    res = database.update_bio(user_id, bio)
    if "error" in res:
        return jsonify(res), 400

    return jsonify({"success": True, "bio": bio}), 200

@app.route('/api/profile/avatar', methods=['POST'])
def upload_avatar_route():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    if 'avatar' not in request.files:
        return jsonify({"error": "No photo file was provided."}), 400

    file = request.files['avatar']
    if not file or file.filename == '':
        return jsonify({"error": "No photo file was selected."}), 400

    ext = get_file_ext(secure_filename(file.filename))
    if ext not in ALLOWED_IMAGE_EXT:
        return jsonify({"error": "Profile photo must be an image (png, jpg, jpeg, gif, or webp)."}), 400

    safe_id = secure_filename(user_id)
    filename = f"{safe_id}_{uuid.uuid4().hex[:8]}.{ext}"
    save_path = os.path.join(AVATAR_DIR, filename)
    file.save(save_path)

    photo_url = f"/uploads/avatars/{filename}"
    res = database.update_profile_photo(user_id, photo_url)
    if "error" in res:
        if os.path.exists(save_path):
            os.remove(save_path)
        return jsonify(res), 400

    old_photo = res.get("old_photo")
    if old_photo and old_photo.startswith('/uploads/avatars/'):
        old_path = os.path.join(UPLOAD_ROOT, old_photo.replace('/uploads/', '', 1))
        if os.path.exists(old_path) and old_path != save_path:
            try:
                os.remove(old_path)
            except OSError:
                pass

    return jsonify({"success": True, "profile_photo": photo_url}), 200


# ==========================================================================
# Posts API Endpoints
# ==========================================================================
@app.route('/api/posts', methods=['GET'])
def get_posts_route():
    posts = database.get_posts()
    return jsonify({"posts": posts}), 200

@app.route('/api/posts', methods=['POST'])
def create_post_route():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized. Please log in."}), 401

    content = (request.form.get('content') or '').strip()
    post_type = request.form.get('type', 'post')

    media_file = request.files.get('media')
    media_path = None
    media_type = None

    if media_file and media_file.filename:
        media_type, ext = classify_media(secure_filename(media_file.filename))
        if not media_type:
            return jsonify({"error": "Unsupported media file. Allowed: images (png, jpg, jpeg, gif, webp) or audio (mp3, wav, ogg, m4a, webm, aac)."}), 400

        safe_id = secure_filename(user_id)
        filename = f"{safe_id}_{uuid.uuid4().hex[:10]}.{ext}"
        save_path = os.path.join(POST_MEDIA_DIR, filename)
        media_file.save(save_path)
        media_path = f"/uploads/posts/{filename}"

    if not content and not media_path:
        return jsonify({"error": "A post needs text content, a photo, or an audio clip."}), 400

    res = database.create_post(user_id, content, post_type, media_path=media_path, media_type=media_type)
    if "error" in res:
        if media_path:
            saved_file_path = os.path.join(POST_MEDIA_DIR, os.path.basename(media_path))
            if os.path.exists(saved_file_path):
                os.remove(saved_file_path)
        return jsonify(res), 403

    return jsonify({"success": True, "post_id": res["id"]}), 201

@app.route('/api/posts/<int:post_id>', methods=['PUT'])
def update_post_route(post_id):
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json() or {}
    content = data.get('content', '').strip()

    if not content:
        return jsonify({"error": "Content cannot be empty."}), 400

    res = database.update_post(post_id, user_id, content)
    if "error" in res:
        return jsonify(res), 403

    return jsonify({"success": True}), 200

@app.route('/api/posts/<int:post_id>', methods=['DELETE'])
def delete_post_route(post_id):
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    res = database.delete_post(post_id, user_id)
    if "error" in res:
        return jsonify(res), 403

    media_path = res.get("media_path")
    if media_path and media_path.startswith('/uploads/posts/'):
        file_path = os.path.join(UPLOAD_ROOT, media_path.replace('/uploads/', '', 1))
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except OSError:
                pass

    return jsonify({"success": True}), 200


# ==========================================================================
# Comments API Endpoints
# ==========================================================================
@app.route('/api/posts/<int:post_id>/comments', methods=['GET'])
def get_comments_route(post_id):
    user_id = get_current_user_id()
    comments = database.get_comments(post_id, current_user_id=user_id)
    return jsonify({"comments": comments}), 200

@app.route('/api/posts/<int:post_id>/comments', methods=['POST'])
def create_comment_route(post_id):
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized. Please log in."}), 401

    data = request.get_json() or {}
    content = data.get('content', '').strip()

    if not content:
        return jsonify({"error": "Comment cannot be empty."}), 400

    res = database.create_comment(post_id, user_id, content)
    if "error" in res:
        return jsonify(res), 403

    return jsonify({"success": True, "comment_id": res["id"]}), 201

@app.route('/api/comments/<int:comment_id>/like', methods=['POST'])
def toggle_comment_like_route(comment_id):
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized. Please log in."}), 401

    res = database.toggle_comment_like(comment_id, user_id)
    if "error" in res:
        return jsonify(res), 404
    return jsonify(res), 200


# ==========================================================================
# Replies API Endpoints
# ==========================================================================
@app.route('/api/comments/<int:comment_id>/replies', methods=['GET'])
def get_replies_route(comment_id):
    replies = database.get_replies(comment_id)
    return jsonify({"replies": replies}), 200

@app.route('/api/comments/<int:comment_id>/replies', methods=['POST'])
def create_reply_route(comment_id):
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized. Please log in."}), 401

    data = request.get_json() or {}
    content = data.get('content', '').strip()

    if not content:
        return jsonify({"error": "Reply cannot be empty."}), 400

    res = database.create_reply(comment_id, user_id, content)
    if "error" in res:
        return jsonify(res), 403

    return jsonify({"success": True, "reply_id": res["id"]}), 201


# ==========================================================================
# Search API
# ==========================================================================
@app.route('/api/search/posts', methods=['GET'])
def search_posts_route():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    query = (request.args.get('q') or '').strip()
    if not query:
        return jsonify({"posts": []}), 200

    posts = database.search_posts(query)
    return jsonify({"posts": posts}), 200


# ==========================================================================
# Members Directory + Connection API
# ==========================================================================
@app.route('/api/members', methods=['GET'])
def get_members_route():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    search = (request.args.get('search') or '').strip() or None
    members = database.get_all_members(user_id, search)
    return jsonify({"members": members}), 200

@app.route('/api/connections/request', methods=['POST'])
def send_connection_request_route():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json() or {}
    recipient_id = (data.get('recipient_id') or '').strip()
    if not recipient_id:
        return jsonify({"error": "recipient_id is required."}), 400

    res = database.send_connection_request(user_id, recipient_id)
    if "error" in res:
        return jsonify(res), 400
    return jsonify(res), 201

@app.route('/api/connections/respond', methods=['POST'])
def respond_connection_request_route():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json() or {}
    requester_id = (data.get('requester_id') or '').strip()
    action = (data.get('action') or '').strip()
    if not requester_id or action not in ('accept', 'decline'):
        return jsonify({"error": "requester_id and a valid action are required."}), 400

    res = database.respond_connection_request(user_id, requester_id, action)
    if "error" in res:
        return jsonify(res), 400
    return jsonify(res), 200

@app.route('/api/connections/requests', methods=['GET'])
def get_incoming_requests_route():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    requests_list = database.get_incoming_requests(user_id)
    return jsonify({"requests": requests_list}), 200

@app.route('/api/connections', methods=['GET'])
def get_connections_route():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    connections = database.get_accepted_connections(user_id)
    return jsonify({"connections": connections}), 200


# ==========================================================================
# Private Messaging API (only between accepted connections)
# ==========================================================================
@app.route('/api/messages/<other_id>', methods=['GET'])
def get_conversation_route(other_id):
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    res = database.get_conversation(user_id, other_id)
    if "error" in res:
        return jsonify(res), 403
    return jsonify(res), 200

@app.route('/api/messages', methods=['POST'])
def send_message_route():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    recipient_id = (request.form.get('recipient_id') or '').strip()
    content = (request.form.get('content') or '').strip()

    if not recipient_id:
        return jsonify({"error": "recipient_id is required."}), 400

    media_file = request.files.get('media')
    media_path = None
    media_type = None
    if media_file and media_file.filename:
        media_type, ext = classify_media(secure_filename(media_file.filename))
        if not media_type:
            return jsonify({"error": "Unsupported media file. Allowed: images (png, jpg, jpeg, gif, webp) or audio (mp3, wav, ogg, m4a, webm, aac)."}), 400
        safe_id = secure_filename(user_id)
        filename = f"{safe_id}_{uuid.uuid4().hex[:10]}.{ext}"
        save_path = os.path.join(CHAT_MEDIA_DIR, filename)
        media_file.save(save_path)
        media_path = f"/uploads/chat/{filename}"

    if not content and not media_path:
        return jsonify({"error": "A message needs text, a photo, or an audio clip."}), 400

    res = database.send_message(user_id, recipient_id, content, media_path=media_path, media_type=media_type)
    if "error" in res:
        if media_path:
            saved_file_path = os.path.join(CHAT_MEDIA_DIR, os.path.basename(media_path))
            if os.path.exists(saved_file_path):
                os.remove(saved_file_path)
        return jsonify(res), 403
    return jsonify(res), 201


# ==========================================================================
# Group Chat API
# ==========================================================================
@app.route('/api/groups', methods=['GET'])
def get_groups_route():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    groups = database.get_user_groups(user_id)
    return jsonify({"groups": groups}), 200

@app.route('/api/groups', methods=['POST'])
def create_group_route():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    description = (data.get('description') or '').strip() or None
    member_ids = data.get('member_ids') or []

    if not name:
        return jsonify({"error": "Group name is required."}), 400
    if not isinstance(member_ids, list) or len(member_ids) < 1:
        return jsonify({"error": "Pick at least one connection to add to the group."}), 400

    res = database.create_group(user_id, name, member_ids, description)
    if "error" in res:
        return jsonify(res), 400
    return jsonify(res), 201

@app.route('/api/groups/<int:group_id>', methods=['GET'])
def get_group_details_route(group_id):
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    res = database.get_group_details(group_id, user_id)
    if "error" in res:
        return jsonify(res), 403
    return jsonify(res), 200

@app.route('/api/groups/<int:group_id>/members', methods=['POST'])
def add_group_member_route(group_id):
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json() or {}
    new_member_id = (data.get('user_id') or '').strip()
    if not new_member_id:
        return jsonify({"error": "user_id is required."}), 400

    res = database.add_group_member(group_id, user_id, new_member_id)
    if "error" in res:
        return jsonify(res), 403
    return jsonify(res), 200

@app.route('/api/groups/<int:group_id>/leave', methods=['POST'])
def leave_group_route(group_id):
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    res = database.leave_group(group_id, user_id)
    if "error" in res:
        return jsonify(res), 403
    return jsonify(res), 200

@app.route('/api/groups/<int:group_id>/messages', methods=['GET'])
def get_group_messages_route(group_id):
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    res = database.get_group_messages(group_id, user_id)
    if "error" in res:
        return jsonify(res), 403
    return jsonify(res), 200

@app.route('/api/groups/<int:group_id>/messages', methods=['POST'])
def send_group_message_route(group_id):
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    content = (request.form.get('content') or '').strip()
    media_file = request.files.get('media')
    media_path = None
    media_type = None
    if media_file and media_file.filename:
        media_type, ext = classify_media(secure_filename(media_file.filename))
        if not media_type:
            return jsonify({"error": "Unsupported media file. Allowed: images (png, jpg, jpeg, gif, webp) or audio (mp3, wav, ogg, m4a, webm, aac)."}), 400
        safe_id = secure_filename(user_id)
        filename = f"{safe_id}_{uuid.uuid4().hex[:10]}.{ext}"
        save_path = os.path.join(CHAT_MEDIA_DIR, filename)
        media_file.save(save_path)
        media_path = f"/uploads/chat/{filename}"

    if not content and not media_path:
        return jsonify({"error": "A message needs text, a photo, or an audio clip."}), 400

    res = database.send_group_message(group_id, user_id, content, media_path=media_path, media_type=media_type)
    if "error" in res:
        if media_path:
            saved_file_path = os.path.join(CHAT_MEDIA_DIR, os.path.basename(media_path))
            if os.path.exists(saved_file_path):
                os.remove(saved_file_path)
        return jsonify(res), 403
    return jsonify(res), 201


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
