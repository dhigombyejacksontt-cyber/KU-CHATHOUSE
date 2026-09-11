/* ==========================================================================
   KAMPALA UNIVERSITY CHAT HOUSE - FRONTEND LOGIC
   ========================================================================== */

let currentUser = null;

// On page load, determine which page we are on and run checks
document.addEventListener("DOMContentLoaded", () => {
    loadTheme();
    const isAuthPage = document.body.classList.contains("auth-page");
    const page = document.body.dataset.page;

    if (isAuthPage) {
        checkSessionAndRedirect();
        setupCodeInputBehavior();
    } else if (page) {
        initAuthenticatedPage(page);
    }
});

// ==========================================================================
// THEME
// ==========================================================================
function applyTheme(theme) {
    const selected = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', selected);
    localStorage.setItem('ku-chat-theme', selected);
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.innerHTML = selected === 'dark' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
}
function loadTheme() { applyTheme(localStorage.getItem('ku-chat-theme') || 'dark'); }
function toggleTheme() { applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); }

// ==========================================================================
// SESSION MANAGEMENT
// ==========================================================================

function checkSessionAndRedirect() {
    fetch('/api/auth/me')
        .then(res => {
            if (res.ok) {
                window.location.href = '/feed';
            }
        })
        .catch(err => console.error("Session check failed:", err));
}

function initAuthenticatedPage(page) {
    fetch('/api/auth/me')
        .then(res => {
            if (!res.ok) {
                showToast("Please log in to continue.", "error");
                setTimeout(() => { window.location.href = '/'; }, 1500);
                throw new Error("Unauthorized");
            }
            return res.json();
        })
        .then(data => {
            currentUser = data.user;
            populateProfileUI(currentUser);
            highlightActiveNavLink(page);
            refreshRequestsBadge();
            setInterval(refreshRequestsBadge, 20000); // poll every 20s for new connection requests

            if (page === 'feed') {
                loadPosts();
            } else if (page === 'members') {
                const params = new URLSearchParams(window.location.search);
                const presetSearch = params.get('search') || '';
                const searchInput = document.getElementById('members-search-input');
                if (searchInput && presetSearch) searchInput.value = presetSearch;
                loadMembers(presetSearch);
            } else if (page === 'messages') {
                initMessagesPage();
            } else if (page === 'profile') {
                initProfilePage();
            }
            // 'about' page is static -- nothing further to load
        })
        .catch(err => console.log(err.message));
}

function highlightActiveNavLink(page) {
    document.querySelectorAll(".nav-link").forEach(el => {
        el.classList.toggle("active", el.dataset.page === page);
    });
}

// ==========================================================================
// AVATAR / PROFILE PHOTO HELPERS
// ==========================================================================

// Sets the content of an avatar container element to either the user's
// uploaded photo ("dp") or a fallback letter avatar.
function setAvatarElement(el, username, photoUrl) {
    if (!el) return;
    if (photoUrl) {
        el.innerHTML = `<img src="${photoUrl}" alt="${escapeHTML(username || '')}">`;
        el.classList.add('has-photo');
    } else {
        el.textContent = (username || '?').charAt(0).toUpperCase();
        el.classList.remove('has-photo');
    }
}

// Returns an HTML string for use inside template literals (e.g. post cards)
function avatarInnerMarkup(username, photoUrl) {
    if (photoUrl) {
        return `<img src="${photoUrl}" alt="${escapeHTML(username || '')}">`;
    }
    return (username || '?').charAt(0).toUpperCase();
}

function populateProfileUI(user) {
    // ── Top nav avatar (small circle button) ──
    const navAvatar = document.getElementById("nav-avatar");
    setAvatarElement(navAvatar, user.username, user.profile_photo);

    // ── Dropdown: larger avatar, name, role badge, ID ──
    const navDropAvatar = document.getElementById("nav-drop-avatar");
    const navUsername   = document.getElementById("nav-username");
    const navRole       = document.getElementById("nav-role");
    const navDropId     = document.getElementById("nav-drop-id");

    setAvatarElement(navDropAvatar, user.username, user.profile_photo);
    if (navUsername) navUsername.textContent = user.username;
    if (navRole) {
        navRole.textContent = user.category;
        navRole.className = `user-role-badge badge-role role-${user.category.toLowerCase()}`;
    }
    if (navDropId) navDropId.textContent = user.university_id;

    // ── Create post box avatar (feed page) ──
    const cpAvatar = document.getElementById("create-post-avatar");
    setAvatarElement(cpAvatar, user.username, user.profile_photo);

    // ── Show/hide announcement toggle for administrators ──
    const adminToggle = document.getElementById("admin-announcement-toggle");
    if (adminToggle) {
        adminToggle.style.display = user.category === "Administrator" ? "flex" : "none";
    }

    // ── Inject Staff Directory link into nav dropdown for administrators ──
    if (user.category === 'Administrator' && !document.getElementById('staff-directory-nav-item')) {
        const dropdown = document.getElementById('nav-dropdown');
        if (dropdown) {
            const divider = document.createElement('div');
            divider.className = 'nav-dropdown-divider';

            const btn = document.createElement('button');
            btn.id = 'staff-directory-nav-item';
            btn.className = 'nav-dropdown-item';
            btn.type = 'button';
            btn.innerHTML = '<i class="fa-solid fa-id-badge"></i> Staff Directory';
            btn.onclick = () => { closeNavDropdown(); openStaffDirectory(); };

            // Insert before the logout button (last child)
            dropdown.insertBefore(divider, dropdown.lastElementChild);
            dropdown.insertBefore(btn, dropdown.lastElementChild);
        }
    }
}

// ==========================================================================
// NAV DROPDOWN (avatar menu)
// ==========================================================================

function toggleNavDropdown() {
    const dropdown = document.getElementById('nav-dropdown');
    if (!dropdown) return;
    const isOpen = dropdown.classList.contains('open');
    if (isOpen) {
        closeNavDropdown();
    } else {
        dropdown.classList.add('open');
        // Close when clicking anywhere outside the wrap
        setTimeout(() => {
            document.addEventListener('click', _navDropdownOutsideHandler);
        }, 0);
    }
}

function closeNavDropdown() {
    const dropdown = document.getElementById('nav-dropdown');
    if (dropdown) dropdown.classList.remove('open');
    document.removeEventListener('click', _navDropdownOutsideHandler);
}

function _navDropdownOutsideHandler(e) {
    const wrap = document.getElementById('nav-avatar-wrap');
    if (wrap && !wrap.contains(e.target)) {
        closeNavDropdown();
    }
}

// ==========================================================================
// PROFILE PAGE (/profile) -- own editable profile, or a read-only view of
// another member at /profile?id=KU-XXXX. This replaced the old "edit
// profile" modal so viewing/editing a profile is its own real page instead
// of an overlay on top of whatever page you were already on.
// University ID is permanent and is never editable here.
// ==========================================================================
let selectedAvatarFile = null;

function initProfilePage() {
    const params = new URLSearchParams(window.location.search);
    const targetId = params.get('id');
    const loading = document.getElementById('profile-page-loading');
    const ownSection = document.getElementById('own-profile-section');
    const memberSection = document.getElementById('member-profile-section');
    const notFound = document.getElementById('profile-page-not-found');

    // No ?id=, or it's your own ID -- show your own editable profile.
    if (!targetId || targetId === currentUser.university_id) {
        if (loading) loading.style.display = 'none';
        if (ownSection) ownSection.style.display = 'block';
        populateOwnProfileForm(currentUser);
        return;
    }

    // Otherwise, look up that member and show a read-only profile view.
    fetch(`/api/members?search=${encodeURIComponent(targetId)}`)
        .then(res => res.json())
        .then(data => {
            const member = (data.members || []).find(m => m.university_id === targetId);
            if (loading) loading.style.display = 'none';
            if (!member) {
                if (notFound) notFound.style.display = 'block';
                return;
            }
            if (memberSection) memberSection.style.display = 'block';
            renderMemberProfileHero(member);
        })
        .catch(() => {
            if (loading) loading.style.display = 'none';
            if (notFound) notFound.style.display = 'block';
        });
}

function populateOwnProfileForm(user) {
    selectedAvatarFile = null;

    // ── Hero card display elements ──
    const displayName     = document.getElementById("profile-display-name");
    const displayRole     = document.getElementById("profile-display-role");
    const displayId       = document.getElementById("profile-display-id");
    const displayCategory = document.getElementById("profile-display-category");
    const displayFaculty  = document.getElementById("profile-display-faculty");
    const bioDisplay      = document.getElementById("profile-bio-display");
    const preview         = document.getElementById("profile-photo-preview");
    const placeholder     = document.getElementById("profile-photo-placeholder");
    const avatarRing      = document.getElementById("profile-avatar-ring");

    if (displayName)     displayName.textContent = user.username;
    if (displayRole) {
        displayRole.textContent = user.category;
        displayRole.className = `user-role-badge badge-role role-${user.category.toLowerCase()}`;
    }
    if (displayId)       displayId.textContent = user.university_id;
    if (displayCategory) displayCategory.textContent = user.category;
    if (displayFaculty)  displayFaculty.textContent = user.faculty;

    if (bioDisplay) {
        if (user.bio) {
            bioDisplay.textContent = user.bio;
            bioDisplay.classList.remove("bio-empty");
        } else {
            bioDisplay.textContent = "No bio yet. Add one below!";
            bioDisplay.classList.add("bio-empty");
        }
    }

    // ── Avatar ──
    if (user.profile_photo) {
        if (preview) { preview.src = user.profile_photo; preview.style.display = "block"; }
        if (placeholder) placeholder.style.display = "none";
        if (avatarRing) avatarRing.classList.add("has-photo");
    } else {
        if (preview) preview.style.display = "none";
        if (placeholder) {
            placeholder.style.display = "flex";
            placeholder.textContent = user.username.charAt(0).toUpperCase();
        }
        if (avatarRing) avatarRing.classList.remove("has-photo");
    }

    // ── Edit form fields ──
    const usernameInput = document.getElementById("profile-username-input");
    const bioInput      = document.getElementById("profile-bio-input");
    const bioCount      = document.getElementById("profile-bio-count");

    if (usernameInput) usernameInput.value = user.username;
    if (bioInput) {
        bioInput.value = user.bio || "";
        if (bioCount) bioCount.textContent = `${bioInput.value.length}/280`;
    }

    // ── Connection count (async) ──
    fetch('/api/connections')
        .then(res => res.json())
        .then(data => {
            const count = (data.connections || []).length;
            const el = document.getElementById("profile-connections-count");
            if (el) el.textContent = count;
        })
        .catch(() => {
            const el = document.getElementById("profile-connections-count");
            if (el) el.textContent = "0";
        });
}

// Read-only hero card for someone else's profile, with a Connect/Message
// action depending on the current connection status -- same statuses used
// on the Members page.
function renderMemberProfileHero(member) {
    const hero = document.getElementById('member-profile-hero');
    if (!hero) return;

    const categoryClass = `badge-role role-${member.category.toLowerCase()}`;
    let actionHTML = '';

    if (member.connection_status === 'accepted') {
        actionHTML = `<a href="/messages?chat=${encodeURIComponent(member.university_id)}" class="member-action-btn message-btn"><i class="fa-solid fa-comment-dots"></i> Message</a>`;
    } else if (member.connection_status === 'pending_sent') {
        actionHTML = `<button class="member-action-btn pending-btn" disabled><i class="fa-solid fa-clock"></i> Pending</button>`;
    } else if (member.connection_status === 'pending_received') {
        actionHTML = `
            <div class="member-request-actions">
                <button class="member-action-btn accept-btn" onclick="respondToRequest('${member.university_id}','accept', this)"><i class="fa-solid fa-check"></i> Accept</button>
                <button class="member-action-btn decline-btn" onclick="respondToRequest('${member.university_id}','decline', this)"><i class="fa-solid fa-xmark"></i> Decline</button>
            </div>`;
    } else {
        actionHTML = `<button class="member-action-btn connect-btn" onclick="sendConnectionRequest('${member.university_id}', this)"><i class="fa-solid fa-user-plus"></i> Connect</button>`;
    }

    hero.innerHTML = `
        <div class="member-profile-avatar${member.profile_photo ? ' has-photo' : ''}">${avatarInnerMarkup(member.username, member.profile_photo)}</div>
        <h2 class="member-profile-name">${escapeHTML(member.username)}</h2>
        <span class="${categoryClass} member-profile-badge">${member.category}</span>
        <p class="member-profile-faculty"><i class="fa-solid fa-building-columns"></i> ${escapeHTML(member.faculty)}</p>
        <p class="member-profile-bio${member.bio ? '' : ' bio-empty'}">${member.bio ? escapeHTML(member.bio) : 'No bio yet.'}</p>
        <div class="member-profile-actions">${actionHTML}</div>
    `;
}

function handleAvatarFileSelected(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
        showToast("Profile photo must be an image file.", "error");
        return;
    }

    selectedAvatarFile = file;

    const reader = new FileReader();
    reader.onload = (ev) => {
        const preview     = document.getElementById("profile-photo-preview");
        const placeholder = document.getElementById("profile-photo-placeholder");
        const avatarRing  = document.getElementById("profile-avatar-ring");
        if (preview) {
            preview.src = ev.target.result;
            preview.style.display = "block";
        }
        if (placeholder) placeholder.style.display = "none";
        if (avatarRing) avatarRing.classList.add("has-photo");
    };
    reader.readAsDataURL(file);
}

function handleBioInput(e) {
    const count = document.getElementById("profile-bio-count");
    if (count) count.textContent = `${e.target.value.length}/280`;
}

function handleSaveProfilePage(e) {
    e.preventDefault();
    const newUsername = document.getElementById("profile-username-input").value.trim();
    const newBio = (document.getElementById("profile-bio-input")?.value || "").trim();
    const saveBtn = e.target.querySelector('button[type="submit"]');

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span>Saving...</span> <i class="fa-solid fa-spinner fa-spin"></i>';
    }

    const restoreBtn = () => {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = 'Save Changes <i class="fa-solid fa-floppy-disk"></i>';
        }
    };

    // Step 1: upload the new avatar photo, if one was selected
    const avatarUpload = selectedAvatarFile
        ? (() => {
            const fd = new FormData();
            fd.append('avatar', selectedAvatarFile);
            return fetch('/api/profile/avatar', { method: 'POST', body: fd })
                .then(async res => {
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || "Failed to upload photo.");
                    return data;
                });
        })()
        : Promise.resolve(null);

    avatarUpload
        .then(() => {
            // Step 2: update the username only if it actually changed
            if (newUsername && newUsername !== currentUser.username) {
                return fetch('/api/profile/username', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: newUsername })
                }).then(async res => {
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || "Failed to update username.");
                    return data;
                });
            }
            return null;
        })
        .then(() => {
            // Step 3: update the bio only if it actually changed
            if (newBio !== (currentUser.bio || "")) {
                return fetch('/api/profile/bio', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bio: newBio })
                }).then(async res => {
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || "Failed to update bio.");
                    return data;
                });
            }
            return null;
        })
        .then(() => fetch('/api/auth/me'))
        .then(res => res.json())
        .then(data => {
            currentUser = data.user;
            populateProfileUI(currentUser);
            populateOwnProfileForm(currentUser);
            showToast("Profile updated successfully.", "success");
        })
        .catch(err => {
            showToast(err.message, "error");
        })
        .finally(restoreBtn);
}


function handleLogout() {
    fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(res => res.json())
    .then(data => {
        showToast("Logged out successfully.", "success");
        setTimeout(() => { window.location.href = '/'; }, 1000);
    })
    .catch(err => {
        showToast("Logout failed. Try again.", "error");
        console.error(err);
    });
}


// ==========================================================================
// AUTH FLOWS (LOGIN, SIGN UP, VERIFICATION)
// ==========================================================================

function switchTab(tab) {
    const loginForm = document.getElementById("login-form");
    const registerForm = document.getElementById("register-form");
    const tabLogin = document.getElementById("tab-login");
    const tabRegister = document.getElementById("tab-register");

    if (tab === 'login') {
        loginForm.classList.add("active");
        registerForm.classList.remove("active");
        tabLogin.classList.add("active");
        tabRegister.classList.remove("active");
    } else {
        registerForm.classList.add("active");
        loginForm.classList.remove("active");
        tabRegister.classList.add("active");
        tabLogin.classList.remove("active");
    }
}

function togglePasswordVisibility(inputId) {
    const input = document.getElementById(inputId);
    const button = input.nextElementSibling;
    if (input.type === "password") {
        input.type = "text";
        button.innerHTML = '<i class="fa-regular fa-eye-slash"></i>';
    } else {
        input.type = "password";
        button.innerHTML = '<i class="fa-regular fa-eye"></i>';
    }
}

// Custom selector dependencies based on user category
function handleCategoryChange() {
    const category = document.getElementById("reg-category").value;
    const facultySelect = document.getElementById("reg-faculty");
    
    const idInput = document.getElementById('reg-id');
    if (idInput) idInput.placeholder = category === 'Student' ? 'e.g. KU0132442924' : category === 'Lecturer' ? 'e.g. KU0047 (approval required)' : category === 'Administrator' ? 'e.g. KU0012 (approval required)' : 'Select your role first';

    if (category === "Administrator") {
        // Force/Suggest administration faculty
        facultySelect.value = "General Administration";
    } else {
        if (facultySelect.value === "General Administration") {
            facultySelect.value = "";
        }
    }
}

function handleRegister(e) {
    e.preventDefault();
    const username = document.getElementById("reg-username").value.trim();
    const university_id = document.getElementById("reg-id").value.trim();
    const category = document.getElementById("reg-category").value;
    const faculty = document.getElementById("reg-faculty").value;
    const email = document.getElementById("reg-email").value.trim();
    const contact = document.getElementById("reg-contact").value.trim();
    const dob = document.getElementById("reg-dob").value;
    const password = document.getElementById("reg-password").value;
    // Institution ID must match: KU followed by digits only (e.g. KU0132442924)
    if (!/^KU\d+$/i.test(university_id)) { showToast('Institution ID must start with KU followed by digits only (e.g. KU0132442924)', 'error'); return; }

    // Password: any memorable password, at least 6 characters
    if (password.length < 6) { showToast('Password must be at least 6 characters.', 'error'); return; }

    const submitBtn = document.getElementById("register-submit-btn");
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Creating Account...</span> <i class="fa-solid fa-spinner fa-spin"></i>';

    fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, university_id, category, faculty, email, contact, dob, password })
    })
    .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Registration failed.");
        return data;
    })
    .then(data => {
        showToast("Account created! Verification code sent to simulated Gmail.", "success");
        
        // Populate Sandbox simulated mailbox
        addSimulatedEmail(username, email, data.simulation_code);
        
        // Show verification modal
        document.getElementById("verify-user-id").value = data.university_id;
        openVerifyModal();
        
        // Clear form
        document.getElementById("register-form").reset();
    })
    .catch(err => {
        showToast(err.message, "error");
    })
    .finally(() => {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Create Account</span> <i class="fa-solid fa-user-plus"></i>';
    });
}

function handleLogin(e) {
    e.preventDefault();
    const university_id = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value;

    const submitBtn = document.getElementById("login-submit-btn");
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Signing In...</span> <i class="fa-solid fa-spinner fa-spin"></i>';

    fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ university_id, password })
    })
    .then(async res => {
        const data = await res.json();
        if (!res.ok) {
            // Check if user is unverified, if so let them complete verification
            if (data.unverified) {
                showToast(data.error, "info");
                document.getElementById("verify-user-id").value = data.university_id;
                // Fetch simulated code from server logs simulation wrapper if we can or just tell them to look at logs
                openVerifyModal();
            } else {
                throw new Error(data.error || "Login failed.");
            }
            return;
        }
        return data;
    })
    .then(data => {
        if (data) {
            showToast("Welcome back!", "success");
            setTimeout(() => { window.location.href = '/feed'; }, 800);
        }
    })
    .catch(err => {
        showToast(err.message, "error");
    })
    .finally(() => {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Sign In</span> <i class="fa-solid fa-arrow-right-to-bracket"></i>';
    });
}

function handleVerification(e) {
    e.preventDefault();
    const university_id = document.getElementById("verify-user-id").value;
    
    // Gather code digits
    const inputs = document.querySelectorAll(".code-input");
    let code = "";
    inputs.forEach(input => code += input.value.trim());

    if (code.length < 6) {
        showToast("Please enter all 6 digits.", "error");
        return;
    }

    fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ university_id, code })
    })
    .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Verification failed.");
        return data;
    })
    .then(data => {
        showToast("Email verified successfully! You can now log in.", "success");
        closeVerifyModal();
        switchTab('login');
        
        // Preset login username field for easy access
        document.getElementById("login-username").value = university_id;
    })
    .catch(err => {
        showToast(err.message, "error");
        // Clear code inputs on error
        inputs.forEach(input => input.value = "");
        inputs[0].focus();
    });
}


// Verification Code Modal Focus Handlers
function setupCodeInputBehavior() {
    const inputs = document.querySelectorAll(".code-input");
    inputs.forEach((input, index) => {
        input.addEventListener("keydown", (e) => {
            if (e.key === "Backspace" && !input.value) {
                if (index > 0) {
                    inputs[index - 1].focus();
                }
            }
        });
    });
}

function moveNext(input, index) {
    if (input.value.length === 1 && index < 6) {
        document.querySelectorAll(".code-input")[index].focus();
    }
}

function moveBack(input, index) {
    // Backspace logic handled in keydown listener
}

function openVerifyModal() {
    document.getElementById("verify-modal").classList.add("active");
    // Focus first input
    const firstInput = document.querySelector(".code-input");
    if (firstInput) {
        firstInput.value = "";
        firstInput.focus();
    }
}

function closeVerifyModal() {
    document.getElementById("verify-modal").classList.remove("active");
    // Clear code inputs
    document.querySelectorAll(".code-input").forEach(input => input.value = "");
}


// ==========================================================================
// FEED OPERATIONS (LOAD, CREATE, EDIT, DELETE POSTS)
// ==========================================================================

// ==========================================================================
// POST MEDIA ATTACHMENT (photos & audio clips)
// ==========================================================================
let selectedPostMediaFile = null;

function handlePostMediaSelected(e) {
    const file = e.target.files[0];
    const preview = document.getElementById("post-media-preview");
    if (!file || !preview) return;

    selectedPostMediaFile = file;
    preview.style.display = "flex";

    const isAudio = file.type.startsWith("audio/");
    if (isAudio) {
        const url = URL.createObjectURL(file);
        preview.innerHTML = `
            <audio controls src="${url}" class="post-media-audio"></audio>
            <span class="media-file-name">${escapeHTML(file.name)}</span>
            <button type="button" class="clear-media-btn" onclick="clearPostMedia()" title="Remove attachment"><i class="fa-solid fa-xmark"></i></button>
        `;
    } else if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            preview.innerHTML = `
                <img src="${ev.target.result}" class="post-media-image-preview" alt="Selected photo">
                <span class="media-file-name">${escapeHTML(file.name)}</span>
                <button type="button" class="clear-media-btn" onclick="clearPostMedia()" title="Remove attachment"><i class="fa-solid fa-xmark"></i></button>
            `;
        };
        reader.readAsDataURL(file);
    } else {
        showToast("Only image or audio files can be attached.", "error");
        clearPostMedia();
    }
}

function clearPostMedia() {
    selectedPostMediaFile = null;
    const input = document.getElementById("post-media-input");
    const preview = document.getElementById("post-media-preview");
    if (input) input.value = "";
    if (preview) {
        preview.innerHTML = "";
        preview.style.display = "none";
    }
}

function togglePostTypePlaceholder() {
    const isAnnouncement = document.getElementById("post-as-announcement").checked;
    const textarea = document.getElementById("post-content");
    if (isAnnouncement) {
        textarea.placeholder = "Enter important university announcement (No comments/replies allowed)...";
    } else {
        textarea.placeholder = "What is on your mind? Ask a question or spark a discussion...";
    }
}

function loadPosts() {
    const postsFeed = document.getElementById("posts-feed");
    const announcementsFeed = document.getElementById("announcements-feed");
    const annTitle = document.getElementById("announcements-title-section");

    if (!postsFeed) return;

    fetch('/api/posts')
        .then(res => res.json())
        .then(data => {
            postsFeed.innerHTML = "";
            if (announcementsFeed) announcementsFeed.innerHTML = "";

            const posts = data.posts || [];
            
            if (posts.length === 0) {
                postsFeed.innerHTML = `
                    <div class="empty-feed-card">
                        <i class="fa-solid fa-graduation-cap"></i>
                        <h3>The Feed is Empty</h3>
                        <p>Be the first to start a conversation, share details, or ask a question!</p>
                    </div>
                `;
                if (annTitle) annTitle.style.display = "none";
                return;
            }

            let announcementCount = 0;
            let standardPostCount = 0;

            posts.forEach(post => {
                const postCard = createPostCardDOM(post);
                
                if (post.type === 'announcement') {
                    if (announcementsFeed) {
                        announcementsFeed.appendChild(postCard);
                        announcementCount++;
                    }
                } else {
                    postsFeed.appendChild(postCard);
                    standardPostCount++;
                }
            });

            // Toggle Pinned announcements header
            if (annTitle) {
                annTitle.style.display = announcementCount > 0 ? "flex" : "none";
            }

            if (standardPostCount === 0) {
                postsFeed.innerHTML = `
                    <div class="empty-feed-card">
                        <i class="fa-regular fa-comments"></i>
                        <h3>No standard posts yet</h3>
                        <p>Ask a question or start a discussion below!</p>
                    </div>
                `;
            }

            // If we navigated here from a search result (/feed#post-123), jump to it
            if (window.location.hash.startsWith('#post-')) {
                const target = document.getElementById(window.location.hash.slice(1));
                if (target) {
                    setTimeout(() => {
                        target.scrollIntoView({ behavior: "smooth", block: "center" });
                        target.classList.add("post-highlight");
                        setTimeout(() => target.classList.remove("post-highlight"), 2000);
                    }, 200);
                }
            }
        })
        .catch(err => {
            showToast("Failed to load posts.", "error");
            console.error(err);
        });
}

function createPostCardDOM(post) {
    const card = document.createElement("article");
    card.className = `post-item ${post.type === 'announcement' ? 'announcement-post' : ''}`;
    card.id = `post-${post.id}`;

    const dateFormatted = new Date(post.created_at + "Z").toLocaleString();
    
    // Only the person who created the post may edit or delete it
    const isOwner = currentUser && post.user_id === currentUser.university_id;
    const showEdit = isOwner;
    const showDelete = isOwner;

    const categoryBadgeClass = `badge-role role-${post.category.toLowerCase()}`;
    const categoryIcon = post.category === 'Administrator' ? '<i class="fa-solid fa-user-shield"></i> ' :
                         post.category === 'Lecturer' ? '<i class="fa-solid fa-certificate"></i> ' :
                         '<i class="fa-solid fa-user-graduate"></i> ';

    // Render attached media (photo or audio), if present
    let mediaMarkup = '';
    if (post.media_type === 'image' && post.media_path) {
        mediaMarkup = `
            <div class="post-media-wrap">
                <img src="${post.media_path}" class="post-media-image" alt="Post photo" loading="lazy">
            </div>
        `;
    } else if (post.media_type === 'audio' && post.media_path) {
        mediaMarkup = `
            <div class="post-media-wrap">
                <audio controls class="post-media-audio" src="${post.media_path}"></audio>
            </div>
        `;
    }

    card.innerHTML = `
        <div class="post-meta-header">
            <div class="author-info-block">
                <div class="user-avatar${post.profile_photo ? ' has-photo' : ''}">${avatarInnerMarkup(post.username, post.profile_photo)}</div>
                <div class="author-details">
                    <div class="author-name-row">
                        <span class="author-username">${post.username}</span>
                        <span class="${categoryBadgeClass}">${categoryIcon}${post.category}</span>
                    </div>
                    <span class="post-subtext">${post.faculty} • ${dateFormatted}</span>
                </div>
            </div>
            
            <div class="post-action-controls">
                ${post.type === 'announcement' ? '<span class="pinned-badge"><i class="fa-solid fa-thumbtack"></i> Pinned</span>' : ''}
                ${showEdit ? `<button class="btn-icon-action edit-action" onclick="openEditPost(${post.id})" title="Edit Post"><i class="fa-solid fa-pencil"></i></button>` : ''}
                ${showDelete ? `<button class="btn-icon-action delete-action" onclick="deletePost(${post.id})" title="Delete Post"><i class="fa-solid fa-trash-can"></i></button>` : ''}
            </div>
        </div>

        ${post.content ? `<div class="post-body-content" id="post-body-${post.id}">${escapeHTML(post.content)}</div>` : `<div class="post-body-content" id="post-body-${post.id}" style="display:none;"></div>`}
        ${mediaMarkup}

        <div class="post-footer-actions">
            ${post.type !== 'announcement' ? `
                <button class="comment-toggle-btn" onclick="toggleComments(${post.id})" id="comment-btn-${post.id}">
                    <i class="fa-regular fa-comment-dots"></i> <span>Comments (0)</span>
                </button>
            ` : `
                <span class="announcement-warning-tag">
                    <i class="fa-solid fa-ban"></i> Announcements do not support comments
                </span>
            `}
        </div>

        <!-- Comments Area (visible by default so answers are seen right away) -->
        ${post.type !== 'announcement' ? `
            <div class="post-comments-section active" id="comments-sec-${post.id}">
                <!-- Comment Input -->
                <form class="comment-submit-form" onsubmit="handleCreateComment(event, ${post.id})">
                    <input type="text" placeholder="Add a comment or answer..." required id="comment-input-${post.id}">
                    <button type="submit" class="comment-send-btn"><i class="fa-solid fa-paper-plane"></i></button>
                </form>
                
                <!-- Comment List -->
                <div class="comments-list-box" id="comments-list-${post.id}"></div>
            </div>
        ` : ''}
    `;

    // Comments are shown immediately, not just on click
    if (post.type !== 'announcement') {
        loadComments(post.id);
    }

    return card;
}

function handleCreatePost(e) {
    e.preventDefault();
    const content = document.getElementById("post-content").value.trim();
    const isAnnouncement = document.getElementById("post-as-announcement")?.checked || false;
    const postType = isAnnouncement ? 'announcement' : 'post';

    if (!content && !selectedPostMediaFile) {
        showToast("Write something, or attach a photo/audio clip.", "error");
        return;
    }

    const formData = new FormData();
    formData.append('content', content);
    formData.append('type', postType);
    if (selectedPostMediaFile) {
        formData.append('media', selectedPostMediaFile);
    }

    fetch('/api/posts', {
        method: 'POST',
        body: formData
    })
    .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to create post.");
        return data;
    })
    .then(data => {
        showToast(isAnnouncement ? "Announcement pinned successfully!" : "Post published successfully!", "success");
        document.getElementById("create-post-form").reset();
        clearPostMedia();
        
        // Reset checkbox to standard post
        const annCheck = document.getElementById("post-as-announcement");
        if (annCheck) {
            annCheck.checked = false;
            togglePostTypePlaceholder();
        }
        
        loadPosts();
    })
    .catch(err => {
        showToast(err.message, "error");
    });
}

function deletePost(postId) {
    if (!confirm("Are you sure you want to delete this post? All replies and comments will be permanently removed.")) return;

    fetch(`/api/posts/${postId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to delete post.");
        return data;
    })
    .then(data => {
        showToast("Post deleted successfully.", "success");
        loadPosts();
    })
    .catch(err => {
        showToast(err.message, "error");
    });
}

// Edit post logic
function openEditPost(postId) {
    const postBody = document.getElementById(`post-body-${postId}`);
    if (!postBody) return;

    document.getElementById("edit-post-id").value = postId;
    document.getElementById("edit-post-content").value = postBody.innerText;
    document.getElementById("edit-post-modal").classList.add("active");
}

function closeEditModal() {
    document.getElementById("edit-post-modal").classList.remove("active");
    document.getElementById("edit-post-content").value = "";
}

function handleSaveEdit(e) {
    e.preventDefault();
    const postId = document.getElementById("edit-post-id").value;
    const content = document.getElementById("edit-post-content").value.trim();

    fetch(`/api/posts/${postId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
    })
    .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to save post.");
        return data;
    })
    .then(data => {
        showToast("Post updated successfully.", "success");
        closeEditModal();
        loadPosts();
    })
    .catch(err => {
        showToast(err.message, "error");
    });
}


// ==========================================================================
// COMMENT & REPLY OPERATIONS (INTERACTION BOARDS)
// ==========================================================================

function toggleComments(postId) {
    const commSection = document.getElementById(`comments-sec-${postId}`);
    if (!commSection) return;
    commSection.classList.toggle("active");
}

function loadComments(postId) {
    const commentsList = document.getElementById(`comments-list-${postId}`);
    if (!commentsList) return;

    commentsList.innerHTML = `<div class="feed-loading" style="padding: 1rem;"><i class="fa-solid fa-circle-notch fa-spin"></i></div>`;

    fetch(`/api/posts/${postId}/comments`)
        .then(res => res.json())
        .then(data => {
            commentsList.innerHTML = "";
            const comments = data.comments || [];

            const commentBtn = document.getElementById(`comment-btn-${postId}`);
            if (commentBtn) {
                commentBtn.querySelector("span").innerText = `Comments (${comments.length})`;
            }

            if (comments.length === 0) {
                commentsList.innerHTML = `<p class="no-messages" style="margin: 0.5rem 0;">No comments yet. Share your answer!</p>`;
                return;
            }

            comments.forEach(comment => {
                const commentEl = createCommentDOM(comment, postId);
                commentsList.appendChild(commentEl);
                
                // Load nested replies
                loadReplies(comment.id, postId);
            });
        })
        .catch(err => {
            console.error("Error loading comments:", err);
            commentsList.innerHTML = `<p class="no-messages" style="color: #ef4444;">Failed to load comments.</p>`;
        });
}

function createCommentDOM(comment, postId) {
    const div = document.createElement("div");
    
    // Determine badges and highlight styles (Quora style verified badging)
    let extraClass = "";
    let expertBadge = "";
    if (comment.category === 'Lecturer') {
        extraClass = "verified-response";
        expertBadge = `<span class="expert-badge-helper text-emerald"><i class="fa-solid fa-certificate"></i> Faculty Answer</span>`;
    } else if (comment.category === 'Administrator') {
        extraClass = "admin-verified-response";
        expertBadge = `<span class="expert-badge-helper text-amber"><i class="fa-solid fa-user-shield"></i> Admin Verified</span>`;
    }

    div.className = `comment-item ${extraClass}`;
    div.id = `comment-${comment.id}`;

    const dateFormatted = new Date(comment.created_at + "Z").toLocaleString();

    div.innerHTML = `
        <div class="comment-meta">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span class="comment-author-name">${comment.username}</span>
                <span class="badge-role role-${comment.category.toLowerCase()}" style="font-size: 0.55rem; padding: 1px 5px;">${comment.category}</span>
                ${expertBadge}
            </div>
            <span style="color: var(--text-muted); font-size: 0.7rem;">${dateFormatted}</span>
        </div>
        <div class="comment-text">${escapeHTML(comment.content)}</div>
        
        <div class="comment-reply-action-bar">
            <button class="comment-like-btn ${comment.liked_by_me ? 'liked' : ''}" onclick="toggleCommentLike(${comment.id})" id="comment-like-btn-${comment.id}">
                <i class="fa-solid fa-heart"></i> <span>${comment.like_count > 0 ? comment.like_count : 'Like'}</span>
            </button>
            <button class="comment-reply-btn" onclick="toggleReplyForm(${comment.id})">
                <i class="fa-solid fa-reply"></i> Reply
            </button>
        </div>

        <!-- Inline Reply Input (Hidden by default) -->
        <form class="reply-submit-form" id="reply-form-${comment.id}" onsubmit="handleCreateReply(event, ${comment.id}, ${postId})">
            <input type="text" placeholder="Write a reply..." required id="reply-input-${comment.id}">
            <button type="submit" class="reply-send-btn"><i class="fa-solid fa-paper-plane"></i></button>
        </form>

        <!-- Nested Replies List -->
        <div class="replies-nested-section" id="replies-list-${comment.id}"></div>
    `;

    return div;
}

function toggleCommentLike(commentId) {
    const btn = document.getElementById(`comment-like-btn-${commentId}`);
    if (btn) btn.disabled = true;

    fetch(`/api/comments/${commentId}/like`, { method: 'POST' })
        .then(async res => {
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Could not react to comment.");
            return data;
        })
        .then(data => {
            if (!btn) return;
            btn.classList.toggle('liked', data.liked);
            btn.querySelector('span').textContent = data.like_count > 0 ? data.like_count : 'Like';
        })
        .catch(err => showToast(err.message, "error"))
        .finally(() => { if (btn) btn.disabled = false; });
}

function handleCreateComment(e, postId) {
    e.preventDefault();
    const input = document.getElementById(`comment-input-${postId}`);
    const content = input.value.trim();

    fetch(`/api/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
    })
    .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to post comment.");
        return data;
    })
    .then(data => {
        input.value = "";
        showToast("Answer/comment added.", "success");
        loadComments(postId);
    })
    .catch(err => {
        showToast(err.message, "error");
    });
}

// Inline reply toggle
function toggleReplyForm(commentId) {
    const form = document.getElementById(`reply-form-${commentId}`);
    if (!form) return;
    
    form.classList.toggle("active");
    if (form.classList.contains("active")) {
        form.querySelector("input").focus();
    }
}

function loadReplies(commentId, postId) {
    const repliesList = document.getElementById(`replies-list-${commentId}`);
    if (!repliesList) return;

    fetch(`/api/comments/${commentId}/replies`)
        .then(res => res.json())
        .then(data => {
            repliesList.innerHTML = "";
            const replies = data.replies || [];

            replies.forEach(reply => {
                const replyDiv = document.createElement("div");
                
                // verified replies highlights
                let extraClass = "";
                let expertIcon = "";
                if (reply.category === 'Lecturer') {
                    extraClass = "verified-response";
                    expertIcon = '<i class="fa-solid fa-certificate text-emerald" title="Faculty Verified"></i> ';
                } else if (reply.category === 'Administrator') {
                    extraClass = "admin-verified-response";
                    expertIcon = '<i class="fa-solid fa-user-shield text-amber" title="Admin Verified"></i> ';
                }

                replyDiv.className = `reply-item ${extraClass}`;
                
                const dateFormatted = new Date(reply.created_at + "Z").toLocaleString();

                replyDiv.innerHTML = `
                    <div class="reply-meta">
                        <div style="display: flex; align-items: center; gap: 0.35rem;">
                            <span class="reply-author">${reply.username}</span>
                            ${expertIcon}
                            <span class="badge-role role-${reply.category.toLowerCase()}" style="font-size: 0.5rem; padding: 0.5px 4px;">${reply.category}</span>
                        </div>
                        <span style="color: var(--text-muted); font-size: 0.65rem;">${dateFormatted}</span>
                    </div>
                    <div class="reply-text">${escapeHTML(reply.content)}</div>
                `;
                repliesList.appendChild(replyDiv);
            });
        })
        .catch(err => {
            console.error("Error loading replies:", err);
        });
}

function handleCreateReply(e, commentId, postId) {
    e.preventDefault();
    const input = document.getElementById(`reply-input-${commentId}`);
    const content = input.value.trim();

    fetch(`/api/comments/${commentId}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
    })
    .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to post reply.");
        return data;
    })
    .then(data => {
        input.value = "";
        showToast("Reply sent.", "success");
        toggleReplyForm(commentId); // Hide input
        loadReplies(commentId, postId); // Reload replies
    })
    .catch(err => {
        showToast(err.message, "error");
    });
}


// ==========================================================================
// TOAST NOTIFICATIONS & UX HELPERS
// ==========================================================================

function showToast(message, type = "info") {
    let container = document.getElementById("toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "toast-container";
        container.className = "toast-container";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;

    let icon = '<i class="fa-solid fa-circle-info"></i>';
    if (type === "success") icon = '<i class="fa-solid fa-circle-check"></i>';
    if (type === "error") icon = '<i class="fa-solid fa-circle-exclamation"></i>';

    toast.innerHTML = `
        ${icon}
        <div>${message}</div>
        <button class="toast-close-btn" onclick="this.parentElement.remove()"><i class="fa-solid fa-xmark"></i></button>
    `;

    container.appendChild(toast);

    // Auto remove toast
    setTimeout(() => {
        toast.style.animation = "fade-in 0.3s ease reverse";
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Sandbox mailbox simulation triggers
function toggleMailbox() {
    const box = document.getElementById("simulation-mailbox");
    const icon = document.getElementById("mailbox-toggle-icon");
    if (!box) return;

    box.classList.toggle("expanded");
    if (box.classList.contains("expanded")) {
        icon.className = "fa-solid fa-chevron-down";
    } else {
        icon.className = "fa-solid fa-chevron-up";
    }
}

function addSimulatedEmail(username, email, code) {
    const list = document.getElementById("mailbox-list");
    const emptyText = document.getElementById("mailbox-empty-text");
    const box = document.getElementById("simulation-mailbox");
    const icon = document.getElementById("mailbox-toggle-icon");

    if (!list) return;

    if (emptyText) emptyText.style.display = "none";

    const msg = document.createElement("div");
    msg.className = "mailbox-msg";
    
    const time = new Date().toLocaleTimeString();

    msg.innerHTML = `
        <div class="mailbox-msg-title">Gmail: Verify Code (${time})</div>
        <div class="mailbox-msg-body">
            To: <strong>${email}</strong> (User: ${username})<br>
            Hello ${username}, use code <span class="verification-highlight-code">${code}</span> to confirm your account.
        </div>
    `;

    // Add at the top of the mailbox
    list.insertBefore(msg, list.firstChild);

    // Open mailbox to show user code
    if (box && !box.classList.contains("expanded")) {
        box.classList.add("expanded");
        if (icon) icon.className = "fa-solid fa-chevron-down";
    }
}

// XSS Sanitizer
function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

/* ==========================================================================
   DEBOUNCE HELPER
   ========================================================================== */
function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

/* ==========================================================================
   MEMBERS DIRECTORY (standalone page)
   ========================================================================== */
function loadMembers(search) {
    const list = document.getElementById("members-list");
    list.innerHTML = `<div class="feed-loading"><i class="fa-solid fa-circle-notch fa-spin"></i><p>Loading members...</p></div>`;

    const url = search ? `/api/members?search=${encodeURIComponent(search)}` : '/api/members';
    fetch(url)
        .then(res => res.json())
        .then(data => renderMembersList(data.members || []))
        .catch(() => {
            list.innerHTML = `<div class="feed-loading"><p>Could not load members.</p></div>`;
        });
}

const handleMembersSearch = debounce((e) => {
    loadMembers(e.target.value.trim());
}, 350);

function renderMembersList(members) {
    const list = document.getElementById("members-list");
    if (!members.length) {
        list.innerHTML = `<div class="empty-state-mini"><i class="fa-solid fa-user-slash"></i><p>No members found.</p></div>`;
        return;
    }

    list.innerHTML = members.map(m => {
        const categoryClass = `badge-role role-${m.category.toLowerCase()}`;
        let actionHTML = '';

        if (m.connection_status === 'accepted') {
            actionHTML = `<a href="/messages?chat=${encodeURIComponent(m.university_id)}" class="member-action-btn message-btn"><i class="fa-solid fa-comment-dots"></i> Message</a>`;
        } else if (m.connection_status === 'pending_sent') {
            actionHTML = `<button class="member-action-btn pending-btn" disabled><i class="fa-solid fa-clock"></i> Pending</button>`;
        } else if (m.connection_status === 'pending_received') {
            actionHTML = `
                <div class="member-request-actions">
                    <button class="member-action-btn accept-btn" onclick="respondToRequest('${m.university_id}','accept', this)"><i class="fa-solid fa-check"></i></button>
                    <button class="member-action-btn decline-btn" onclick="respondToRequest('${m.university_id}','decline', this)"><i class="fa-solid fa-xmark"></i></button>
                </div>`;
        } else {
            actionHTML = `<button class="member-action-btn connect-btn" onclick="sendConnectionRequest('${m.university_id}', this)"><i class="fa-solid fa-user-plus"></i> Connect</button>`;
        }

        return `
            <div class="member-row" id="member-row-${m.university_id}">
                <a class="member-info" href="/profile?id=${encodeURIComponent(m.university_id)}" title="View ${escapeHTML(m.username)}'s profile">
                    <div class="mini-avatar${m.profile_photo ? ' has-photo' : ''}">${avatarInnerMarkup(m.username, m.profile_photo)}</div>
                    <div class="member-text">
                        <span class="member-username">${escapeHTML(m.username)}</span>
                        <span class="member-meta"><span class="${categoryClass}">${m.category}</span> • ${escapeHTML(m.faculty)}</span>
                        ${m.bio ? `<span class="member-bio">${escapeHTML(m.bio)}</span>` : ''}
                    </div>
                </a>
                ${actionHTML}
            </div>
        `;
    }).join('');
}

function sendConnectionRequest(recipientId, btnEl) {
    if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }

    fetch('/api/connections/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient_id: recipientId })
    })
    .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not send request.");
        return data;
    })
    .then(data => {
        if (data.status === 'accepted') {
            showToast("You're now connected!", "success");
        } else {
            showToast("Connection request sent.", "success");
        }
        loadMembers(document.getElementById("members-search-input").value.trim());
        refreshRequestsBadge();
    })
    .catch(err => {
        showToast(err.message, "error");
        if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = '<i class="fa-solid fa-user-plus"></i> Connect'; }
    });
}

function respondToRequest(requesterId, action, btnEl) {
    const row = btnEl ? btnEl.closest(".member-request-actions, .request-row") : null;
    if (row) row.style.opacity = "0.5";

    fetch('/api/connections/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requester_id: requesterId, action })
    })
    .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Action failed.");
        return data;
    })
    .then(() => {
        showToast(action === 'accept' ? "Request accepted. You can now chat!" : "Request declined.", "success");
        // Refresh whichever views might be open
        const membersSearch = document.getElementById("members-search-input");
        if (membersSearch) loadMembers(membersSearch.value.trim());
        loadRequests();
        loadChats();
        refreshRequestsBadge();
    })
    .catch(err => showToast(err.message, "error"));
}

/* ==========================================================================
   MESSAGES PAGE (Chats + Groups + Requests + Chat thread)
   ========================================================================== */
let activeChat = { type: null, id: null }; // type: 'dm' | 'group'
let selectedChatMediaFile = null;

function initMessagesPage() {
    switchMessagesTab('chats');
    loadChats();
    loadGroups();
    loadRequests();

    // Deep-link support: /messages?chat=STU-1002 or /messages?group=3
    const params = new URLSearchParams(window.location.search);
    const chatId = params.get('chat');
    const groupId = params.get('group');
    if (chatId) {
        fetch(`/api/members?search=${encodeURIComponent(chatId)}`)
            .then(res => res.json())
            .then(data => {
                const match = (data.members || []).find(m => m.university_id === chatId);
                if (match) openChat(match.university_id, match.username, match.profile_photo);
            });
    } else if (groupId) {
        fetch(`/api/groups/${groupId}`)
            .then(res => res.json())
            .then(data => {
                if (data.group) openGroupChat(data.group.id, data.group.name, data.group.members.length);
            });
    }
}

function switchMessagesTab(tab) {
    const tabs = { chats: 'msg-tab-chats', groups: 'msg-tab-groups', requests: 'msg-tab-requests' };
    const lists = { chats: 'chats-list', groups: 'groups-list', requests: 'requests-list' };

    Object.keys(tabs).forEach(key => {
        document.getElementById(tabs[key]).classList.toggle("active", key === tab);
        document.getElementById(lists[key]).style.display = key === tab ? "block" : "none";
    });
}

function loadChats() {
    const list = document.getElementById("chats-list");
    if (!list) return;
    fetch('/api/connections')
        .then(res => res.json())
        .then(data => renderChatsList(data.connections || []))
        .catch(() => { list.innerHTML = `<div class="empty-state-mini"><p>Could not load chats.</p></div>`; });
}

function renderChatsList(connections) {
    const list = document.getElementById("chats-list");
    if (!connections.length) {
        list.innerHTML = `<div class="empty-state-mini"><i class="fa-solid fa-comment-slash"></i><p>No chats yet. Visit Members to connect with someone first.</p></div>`;
        return;
    }
    list.innerHTML = connections.map(c => `
        <div class="chat-list-row ${activeChat.type === 'dm' && activeChat.id === c.university_id ? 'active' : ''}" onclick="openChat('${c.university_id}','${escapeHTML(c.username)}','${c.profile_photo || ''}')">
            <div class="mini-avatar${c.profile_photo ? ' has-photo' : ''}">${avatarInnerMarkup(c.username, c.profile_photo)}</div>
            <div class="chat-list-text">
                <span class="member-username">${escapeHTML(c.username)}${c.unread_count > 0 ? `<span class="unread-dot"></span>` : ''}</span>
                <span class="chat-preview">${c.last_message ? escapeHTML(c.last_message).slice(0, 40) : (c.last_message_at === null && c.last_message === null ? 'Say hello 👋' : '📎 Media')}</span>
            </div>
        </div>
    `).join('');
}

function loadGroups() {
    const list = document.getElementById("groups-list");
    if (!list) return;
    fetch('/api/groups')
        .then(res => res.json())
        .then(data => renderGroupsList(data.groups || []))
        .catch(() => { list.innerHTML = `<div class="empty-state-mini"><p>Could not load groups.</p></div>`; });
}

function renderGroupsList(groups) {
    const list = document.getElementById("groups-list");
    if (!groups.length) {
        list.innerHTML = `<div class="empty-state-mini"><i class="fa-solid fa-user-group"></i><p>No groups yet. Create one with people you're connected with.</p></div>`;
        return;
    }
    list.innerHTML = groups.map(g => `
        <div class="chat-list-row ${activeChat.type === 'group' && activeChat.id === g.id ? 'active' : ''}" onclick="openGroupChat(${g.id}, '${escapeHTML(g.name)}', ${g.member_count})">
            <div class="mini-avatar group-avatar"><i class="fa-solid fa-user-group"></i></div>
            <div class="chat-list-text">
                <span class="member-username">${escapeHTML(g.name)}</span>
                <span class="chat-preview">${g.last_message ? `${escapeHTML(g.last_message_from)}: ${escapeHTML(g.last_message).slice(0, 32)}` : `${g.member_count} members`}</span>
            </div>
        </div>
    `).join('');
}

function loadRequests() {
    const list = document.getElementById("requests-list");
    if (!list) return;
    fetch('/api/connections/requests')
        .then(res => res.json())
        .then(data => renderRequestsList(data.requests || []))
        .catch(() => {
            list.innerHTML = `<div class="empty-state-mini"><p>Could not load requests.</p></div>`;
        });
}

function renderRequestsList(requests) {
    const list = document.getElementById("requests-list");
    const tabBadge = document.getElementById("requests-tab-badge");

    if (tabBadge) {
        if (requests.length > 0) {
            tabBadge.style.display = "inline-flex";
            tabBadge.textContent = requests.length;
        } else {
            tabBadge.style.display = "none";
        }
    }

    if (!requests.length) {
        list.innerHTML = `<div class="empty-state-mini"><i class="fa-solid fa-user-check"></i><p>No pending requests.</p></div>`;
        return;
    }

    list.innerHTML = requests.map(r => `
        <div class="request-row">
            <div class="member-info">
                <div class="mini-avatar${r.profile_photo ? ' has-photo' : ''}">${avatarInnerMarkup(r.username, r.profile_photo)}</div>
                <div class="member-text">
                    <span class="member-username">${escapeHTML(r.username)}</span>
                    <span class="member-meta">${r.category} • ${escapeHTML(r.faculty)}</span>
                </div>
            </div>
            <div class="member-request-actions">
                <button class="member-action-btn accept-btn" onclick="respondToRequest('${r.requester_id}','accept', this)"><i class="fa-solid fa-check"></i></button>
                <button class="member-action-btn decline-btn" onclick="respondToRequest('${r.requester_id}','decline', this)"><i class="fa-solid fa-xmark"></i></button>
            </div>
        </div>
    `).join('');
}

function refreshRequestsBadge() {
    fetch('/api/connections/requests')
        .then(res => res.json())
        .then(data => {
            const count = (data.requests || []).length;
            // Top nav badge (on Messages nav link)
            const navBadge = document.getElementById("requests-badge");
            if (navBadge) {
                if (count > 0) {
                    navBadge.style.display = "inline-flex";
                    navBadge.textContent = count;
                } else {
                    navBadge.style.display = "none";
                }
            }
            // Messages page tab badge
            const tabBadge = document.getElementById("requests-tab-badge");
            if (tabBadge) {
                if (count > 0) {
                    tabBadge.style.display = "inline-flex";
                    tabBadge.textContent = count;
                } else {
                    tabBadge.style.display = "none";
                }
            }
        })
        .catch(() => {});
}

function showChatThreadUI() {
    document.getElementById("chat-placeholder").style.display = "none";
    const panel = document.getElementById("new-group-panel");
    if (panel) panel.style.display = "none";
    document.getElementById("chat-thread").style.display = "flex";
    clearChatMedia();
    document.querySelectorAll(".chat-list-row").forEach(row => row.classList.remove("active"));
}

function openChat(otherId, username, profilePhoto) {
    activeChat = { type: 'dm', id: otherId };
    showChatThreadUI();

    const header = document.getElementById("chat-thread-header");
    header.innerHTML = `
        <div class="mini-avatar${profilePhoto ? ' has-photo' : ''}">${avatarInnerMarkup(username, profilePhoto)}</div>
        <span class="member-username">${escapeHTML(username)}</span>
    `;

    const messagesEl = document.getElementById("chat-messages");
    messagesEl.innerHTML = `<div class="feed-loading"><i class="fa-solid fa-circle-notch fa-spin"></i></div>`;

    fetch(`/api/messages/${encodeURIComponent(otherId)}`)
        .then(async res => {
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Could not load conversation.");
            return data;
        })
        .then(data => {
            renderChatMessages(data.messages || [], false);
            loadChats(); // refresh unread indicators
            refreshRequestsBadge();
        })
        .catch(err => {
            messagesEl.innerHTML = `<div class="empty-state-mini"><p>${escapeHTML(err.message)}</p></div>`;
        });
}

function openGroupChat(groupId, name, memberCount) {
    activeChat = { type: 'group', id: groupId };
    showChatThreadUI();

    const header = document.getElementById("chat-thread-header");
    header.innerHTML = `
        <div class="mini-avatar group-avatar"><i class="fa-solid fa-user-group"></i></div>
        <div class="chat-list-text">
            <span class="member-username">${escapeHTML(name)}</span>
            <span class="chat-preview">${memberCount} members</span>
        </div>
    `;

    const messagesEl = document.getElementById("chat-messages");
    messagesEl.innerHTML = `<div class="feed-loading"><i class="fa-solid fa-circle-notch fa-spin"></i></div>`;

    fetch(`/api/groups/${groupId}/messages`)
        .then(async res => {
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Could not load group messages.");
            return data;
        })
        .then(data => {
            renderChatMessages(data.messages || [], true);
            loadGroups();
        })
        .catch(err => {
            messagesEl.innerHTML = `<div class="empty-state-mini"><p>${escapeHTML(err.message)}</p></div>`;
        });
}

function chatMediaMarkup(m) {
    if (m.media_type === 'image' && m.media_path) {
        return `<img src="${m.media_path}" class="chat-media-image" alt="Shared photo" loading="lazy">`;
    }
    if (m.media_type === 'audio' && m.media_path) {
        return `<audio controls class="chat-media-audio" src="${m.media_path}"></audio>`;
    }
    return '';
}

function renderChatMessages(messages, isGroup) {
    const messagesEl = document.getElementById("chat-messages");
    if (!messages.length) {
        messagesEl.innerHTML = `<div class="empty-state-mini"><p>No messages yet. Say hello 👋</p></div>`;
        return;
    }
    messagesEl.innerHTML = messages.map(m => {
        const mine = currentUser && m.sender_id === currentUser.university_id;
        const senderLabel = (isGroup && !mine) ? `<span class="chat-bubble-sender">${escapeHTML(m.username)}</span>` : '';
        const media = chatMediaMarkup(m);
        const textPart = m.content ? `<div class="chat-bubble-text">${escapeHTML(m.content)}</div>` : '';
        return `<div class="chat-bubble-row ${mine ? 'mine' : 'theirs'}"><div class="chat-bubble">${senderLabel}${media}${textPart}</div></div>`;
    }).join('');
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function handleChatMediaSelected(e) {
    const file = e.target.files[0];
    const preview = document.getElementById("chat-media-preview");
    if (!file || !preview) return;

    if (!file.type.startsWith("image/") && !file.type.startsWith("audio/")) {
        showToast("Only image or audio files can be attached.", "error");
        return;
    }

    selectedChatMediaFile = file;
    preview.style.display = "flex";
    preview.innerHTML = `
        <i class="fa-solid ${file.type.startsWith('audio/') ? 'fa-music' : 'fa-image'}"></i>
        <span class="media-file-name">${escapeHTML(file.name)}</span>
        <button type="button" class="clear-media-btn" onclick="clearChatMedia()" title="Remove attachment"><i class="fa-solid fa-xmark"></i></button>
    `;
}

function clearChatMedia() {
    selectedChatMediaFile = null;
    const input = document.getElementById("chat-media-input");
    const preview = document.getElementById("chat-media-preview");
    if (input) input.value = "";
    if (preview) { preview.innerHTML = ""; preview.style.display = "none"; }
}

function handleSendChatMessage(e) {
    e.preventDefault();
    if (!activeChat.id) return;

    const input = document.getElementById("chat-input");
    const content = input.value.trim();
    if (!content && !selectedChatMediaFile) return;

    const formData = new FormData();
    formData.append('content', content);
    if (selectedChatMediaFile) formData.append('media', selectedChatMediaFile);

    const url = activeChat.type === 'group' ? `/api/groups/${activeChat.id}/messages` : '/api/messages';
    if (activeChat.type === 'dm') formData.append('recipient_id', activeChat.id);

    input.value = "";
    const mediaFileSnapshot = selectedChatMediaFile;
    clearChatMedia();

    fetch(url, { method: 'POST', body: formData })
        .then(async res => {
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Message failed to send.");
            return data;
        })
        .then(() => {
            // Re-fetch the thread so both sides stay in sync
            const refreshUrl = activeChat.type === 'group'
                ? `/api/groups/${activeChat.id}/messages`
                : `/api/messages/${encodeURIComponent(activeChat.id)}`;
            fetch(refreshUrl)
                .then(res => res.json())
                .then(data => {
                    renderChatMessages(data.messages || [], activeChat.type === 'group');
                    if (activeChat.type === 'group') loadGroups(); else loadChats();
                });
        })
        .catch(err => {
            showToast(err.message, "error");
            input.value = content;
            selectedChatMediaFile = mediaFileSnapshot;
        });
}

/* ==========================================================================
   GROUP CREATION
   ========================================================================== */
function openNewGroupPanel() {
    document.getElementById("chat-placeholder").style.display = "none";
    document.getElementById("chat-thread").style.display = "none";
    document.getElementById("new-group-panel").style.display = "flex";
    document.querySelectorAll(".chat-list-row").forEach(row => row.classList.remove("active"));

    const picker = document.getElementById("group-member-picker");
    picker.innerHTML = `<div class="feed-loading"><i class="fa-solid fa-circle-notch fa-spin"></i></div>`;

    fetch('/api/connections')
        .then(res => res.json())
        .then(data => {
            const connections = data.connections || [];
            if (!connections.length) {
                picker.innerHTML = `<div class="empty-state-mini"><p>Connect with members first to add them to a group.</p></div>`;
                return;
            }
            picker.innerHTML = connections.map(c => `
                <label class="group-member-option">
                    <input type="checkbox" name="group-member" value="${c.university_id}">
                    <div class="mini-avatar${c.profile_photo ? ' has-photo' : ''}">${avatarInnerMarkup(c.username, c.profile_photo)}</div>
                    <span class="member-username">${escapeHTML(c.username)}</span>
                </label>
            `).join('');
        })
        .catch(() => {
            picker.innerHTML = `<div class="empty-state-mini"><p>Could not load your connections.</p></div>`;
        });
}

function closeNewGroupPanel() {
    document.getElementById("new-group-panel").style.display = "none";
    document.getElementById("chat-placeholder").style.display = "flex";
    document.getElementById("new-group-form").reset();
}

function handleCreateGroup(e) {
    e.preventDefault();
    const name = document.getElementById("new-group-name").value.trim();
    const checked = Array.from(document.querySelectorAll('input[name="group-member"]:checked')).map(el => el.value);

    if (!checked.length) {
        showToast("Pick at least one connection to add.", "error");
        return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<span>Creating...</span> <i class="fa-solid fa-spinner fa-spin"></i>'; }

    fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, member_ids: checked })
    })
    .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not create group.");
        return data;
    })
    .then(data => {
        showToast("Group created!", "success");
        closeNewGroupPanel();
        switchMessagesTab('groups');
        loadGroups();
        openGroupChat(data.id, name, checked.length + 1);
    })
    .catch(err => showToast(err.message, "error"))
    .finally(() => {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = 'Create Group <i class="fa-solid fa-check"></i>'; }
    });
}


/* ==========================================================================
   GLOBAL SEARCH (members + posts)
   ========================================================================== */
const handleGlobalSearchInput = debounce((e) => {
    const query = e.target.value.trim();
    const clearBtn = document.getElementById("clear-search-btn");
    clearBtn.style.display = query ? "flex" : "none";

    if (!query) {
        hideSearchDropdown();
        return;
    }
    runGlobalSearch(query);
}, 300);

function handleGlobalSearchFocus() {
    const query = document.getElementById("global-search-input").value.trim();
    if (query) runGlobalSearch(query);
}

function clearGlobalSearch() {
    const input = document.getElementById("global-search-input");
    input.value = "";
    document.getElementById("clear-search-btn").style.display = "none";
    hideSearchDropdown();
}

function hideSearchDropdown() {
    const dropdown = document.getElementById("search-results-dropdown");
    dropdown.classList.remove("active");
    dropdown.innerHTML = "";
}

function runGlobalSearch(query) {
    Promise.all([
        fetch(`/api/members?search=${encodeURIComponent(query)}`).then(res => res.json()).catch(() => ({ members: [] })),
        fetch(`/api/search/posts?q=${encodeURIComponent(query)}`).then(res => res.json()).catch(() => ({ posts: [] }))
    ]).then(([memberData, postData]) => {
        renderSearchDropdown(memberData.members || [], postData.posts || [], query);
    });
}

function renderSearchDropdown(members, posts, query) {
    const dropdown = document.getElementById("search-results-dropdown");
    const topMembers = members.slice(0, 4);
    const topPosts = posts.slice(0, 4);

    if (!topMembers.length && !topPosts.length) {
        dropdown.innerHTML = `<div class="search-empty">No members or posts match "${escapeHTML(query)}"</div>`;
        dropdown.classList.add("active");
        return;
    }

    let html = '';

    if (topMembers.length) {
        html += `<div class="search-section-label">Members</div>`;
        html += topMembers.map(m => `
            <div class="search-result-row" onclick="window.location.href='/profile?id=${encodeURIComponent(m.university_id)}';">
                <div class="mini-avatar${m.profile_photo ? ' has-photo' : ''}">${avatarInnerMarkup(m.username, m.profile_photo)}</div>
                <div class="member-text">
                    <span class="member-username">${escapeHTML(m.username)}</span>
                    <span class="member-meta">${m.category} • ${m.university_id}</span>
                </div>
            </div>
        `).join('');
    }

    if (topPosts.length) {
        html += `<div class="search-section-label">Posts</div>`;
        html += topPosts.map(p => `
            <div class="search-result-row" onclick="hideSearchDropdown(); scrollToPost(${p.id});">
                <div class="mini-avatar${p.profile_photo ? ' has-photo' : ''}">${avatarInnerMarkup(p.username, p.profile_photo)}</div>
                <div class="member-text">
                    <span class="member-username">${escapeHTML(p.username)}</span>
                    <span class="member-meta">${p.content ? escapeHTML(p.content).slice(0, 55) : '📎 Media post'}</span>
                </div>
            </div>
        `).join('');
    }

    dropdown.innerHTML = html;
    dropdown.classList.add("active");
}

function scrollToPost(postId) {
    clearGlobalSearch();
    const el = document.getElementById(`post-${postId}`);
    if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("post-highlight");
        setTimeout(() => el.classList.remove("post-highlight"), 2000);
    } else if (document.body.dataset.page === 'feed') {
        showToast("Post found, but it's not currently loaded in the feed.", "success");
    } else {
        window.location.href = `/feed#post-${postId}`;
    }
}

// Close the search dropdown when clicking elsewhere on the page
document.addEventListener("click", (e) => {
    const searchWrap = document.getElementById("nav-search");
    if (searchWrap && !searchWrap.contains(e.target)) {
        hideSearchDropdown();
    }
});


// ==========================================================================
// ADMIN STAFF DIRECTORY
// ==========================================================================
function openStaffDirectory() {
    let modal=document.getElementById('staff-directory-modal');
    if(!modal){ modal=document.createElement('div'); modal.id='staff-directory-modal'; modal.className='modal-overlay'; modal.innerHTML=`<div class="modal-card staff-directory-card scale-in"><div class="modal-header"><i class="fa-solid fa-id-badge modal-icon"></i><h2>Staff Directory</h2><p>Pre-approve lecturer and administrator IDs before registration.</p></div><form id="staff-directory-form" class="staff-form"><input id="staff-id" placeholder="KU-LEC-0047 or KU-ADM-0012" required><input id="staff-name" placeholder="Full name" required><input id="staff-email" type="email" placeholder="Official university email" required><select id="staff-role" required><option value="Lecturer">Lecturer</option><option value="Administrator">Administrator</option></select><input id="staff-faculty" placeholder="Faculty / Department" required><button class="submit-btn" type="submit">Add Staff <i class="fa-solid fa-plus"></i></button></form><div class="staff-list" id="staff-list"></div><div class="modal-actions"><button type="button" class="cancel-btn" onclick="document.getElementById('staff-directory-modal').remove()">Close</button></div></div>`; document.body.appendChild(modal); document.getElementById('staff-directory-form').onsubmit=submitStaffApproval; }
    modal.style.display='flex'; loadApprovedStaff();
}
function loadApprovedStaff(){ fetch('/api/admin/staff').then(r=>r.json()).then(data=>{const list=document.getElementById('staff-list'); if(!list)return; list.innerHTML=(data.staff||[]).map(x=>`<div class="staff-row"><strong>${escapeHTML(x.staff_id)}</strong><span>${escapeHTML(x.full_name)}</span><span class="badge-role role-${x.role.toLowerCase()}">${x.role}</span><small>${x.is_registered?'Account registered':'Awaiting registration'}</small></div>`).join('')||'<p class="no-messages">No approved staff yet.</p>';}).catch(()=>showToast('Could not load staff directory.','error'));}
function submitStaffApproval(e){ e.preventDefault(); const payload={staff_id:document.getElementById('staff-id').value.trim().toUpperCase(),full_name:document.getElementById('staff-name').value.trim(),official_email:document.getElementById('staff-email').value.trim(),role:document.getElementById('staff-role').value,faculty:document.getElementById('staff-faculty').value.trim()}; fetch('/api/admin/staff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not add staff.');return d;}).then(()=>{showToast('Staff member approved.','success');document.getElementById('staff-directory-form').reset();loadApprovedStaff();}).catch(e=>showToast(e.message,'error'));}
