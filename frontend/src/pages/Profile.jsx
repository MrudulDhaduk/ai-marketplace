import React, { useState, useEffect, useCallback } from "react";
import "./Profile.css";
import TopBar from "../components/TopBar";
import { apiRequest } from "../lib/api";
import { useAuth } from "../context/AuthContext";

/* ── helpers ─────────────────────────────────────── */
function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const EVENT_LABELS = {
  bid_placed:         "Placed a bid",
  bid_accepted:       "Bid accepted",
  project_assigned:   "Assigned to project",
  submission_added:   "Submitted work",
  revision_requested: "Revision requested",
  project_approved:   "Project approved",
};

/* ========== Profile Header ========== */
function ProfileHeader({ user, isOwner, onEditBio }) {
  const initials = (user.name || "?")[0].toUpperCase();

  return (
    <div className="glass-card profile-header">
      <div className="profile-header-left">
        <div className="avatar-container">
          {/* Text-based avatar — no broken image */}
          <div className="avatar avatar--initials">
            <span>{initials}</span>
          </div>
        </div>

        <div className="profile-info">
          <h1 className="profile-name">{user.name}</h1>
          <span className="profile-role">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            {user.role || "Member"}
          </span>

          {/* Only show contact info to owner */}
          {isOwner && (
            <div className="contact-info">
              {user.email && (
                <div className="contact-item">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                  <span>{user.email}</span>
                  {user.emailVerified && <span className="verified-badge">✓</span>}
                </div>
              )}
              {user.phone && (
                <div className="contact-item">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                  <span>{user.phone}</span>
                  {user.phoneVerified && <span className="verified-badge">✓</span>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {isOwner && (
        <button className="edit-profile-btn" onClick={onEditBio}>
          Edit Bio
        </button>
      )}
    </div>
  );
}

/* ========== Stats Strip ========== */
function StatsStrip({ stats, role }) {
  return (
    <div className="stats-strip">
      <div className="stat-card">
        <div className="stat-value">{stats.projectsCompleted ?? 0}</div>
        <div className="stat-label">Projects Completed</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{stats.activeProjects ?? 0}</div>
        <div className="stat-label">Active Projects</div>
      </div>
    </div>
  );
}

/* ========== Bio / About Section ========== */
function AboutSection({ bio, isOwner, userId, onBioSaved }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(bio || "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [expanded, setExpanded] = useState(false);

  const shouldTruncate = !editing && draft && draft.length > 200;

  const handleSave = async () => {
    setSaving(true);
    try {
      const r = await apiRequest(`/profile/${userId}`, {
        method: "PUT",
        body: JSON.stringify({ bio: draft }),
      });
      if (r.ok) {
        setMsg("✓ Saved");
        setEditing(false);
        onBioSaved?.(draft);
      } else {
        setMsg("Failed to save");
      }
    } catch {
      setMsg("Failed to save");
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(""), 3000);
    }
  };

  return (
    <div className="glass-card">
      <h2 className="section-title">About</h2>
      {editing ? (
        <>
          <textarea
            className="add-skill-input"
            style={{ width: "100%", minHeight: "100px", resize: "vertical", marginBottom: "10px" }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={1000}
            placeholder="Tell clients about yourself…"
          />
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button className="add-skill-btn" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button className="verify-btn" onClick={() => { setEditing(false); setDraft(bio || ""); }}>
              Cancel
            </button>
            {msg && <span style={{ fontSize: "13px", color: msg.startsWith("✓") ? "#22d3ee" : "#f87171" }}>{msg}</span>}
          </div>
        </>
      ) : (
        <>
          {draft ? (
            <>
              <p className={`about-text${shouldTruncate && !expanded ? " collapsed" : ""}`}>
                {draft}
              </p>
              {shouldTruncate && (
                <button className="read-more-btn" onClick={() => setExpanded(!expanded)}>
                  {expanded ? "Show Less" : "Read More"}
                </button>
              )}
            </>
          ) : (
            <p className="about-text" style={{ opacity: 0.4 }}>
              {isOwner ? "No bio yet — click Edit Bio to add one." : "No bio provided."}
            </p>
          )}
          {isOwner && (
            <button className="verify-btn" style={{ marginTop: "10px" }} onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </>
      )}
    </div>
  );
}

/* ========== Skills Section ========== */
function SkillsSection({ skills, setSkills, isOwner, userId }) {
  const [newSkill, setNewSkill] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const handleAddSkill = async (e) => {
    e.preventDefault();
    const trimmed = newSkill.trim();
    if (!trimmed || skills.includes(trimmed)) return;
    setSaving(true);
    try {
      const resp = await apiRequest(`/profile/${userId}/skills`, {
        method: "POST",
        body: JSON.stringify({ skill: trimmed }),
      });
      if (resp.ok) {
        setSkills([...skills, trimmed]);
        setNewSkill("");
      } else {
        const d = await resp.json();
        setMsg(d.message || "Failed");
        setTimeout(() => setMsg(""), 3000);
      }
    } catch {
      setMsg("Failed to add skill");
      setTimeout(() => setMsg(""), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveSkill = async (skillToRemove) => {
    try {
      const resp = await apiRequest(`/profile/${userId}/skills`, {
        method: "DELETE",
        body: JSON.stringify({ skill: skillToRemove }),
      });
      if (resp.ok) setSkills(skills.filter((s) => s !== skillToRemove));
    } catch {}
  };

  return (
    <div className="glass-card">
      <h2 className="section-title">Skills</h2>
      <div className="skills-container">
        {skills.length === 0 && (
          <p style={{ opacity: 0.4, fontSize: "13px" }}>
            {isOwner ? "No skills added yet." : "No skills listed."}
          </p>
        )}
        {skills.map((skill, index) => (
          <div key={index} className="skill-tag">
            {skill}
            {isOwner && (
              <button
                className="skill-remove"
                onClick={() => handleRemoveSkill(skill)}
                aria-label={`Remove ${skill}`}
              >
                &times;
              </button>
            )}
          </div>
        ))}
      </div>

      {isOwner && (
        <form className="add-skill-form" onSubmit={handleAddSkill}>
          <input
            type="text"
            className="add-skill-input"
            placeholder="Add a skill…"
            value={newSkill}
            onChange={(e) => setNewSkill(e.target.value)}
            maxLength={60}
          />
          <button type="submit" className="add-skill-btn" disabled={saving || !newSkill.trim()}>
            {saving ? "…" : "Add"}
          </button>
        </form>
      )}
      {msg && <p style={{ fontSize: "13px", color: "#f87171", marginTop: "6px" }}>{msg}</p>}
    </div>
  );
}

/* ========== Projects Section ========== */
function ProjectsSection({ projects, role }) {
  if (!projects || projects.length === 0) {
    return (
      <div className="glass-card">
        <h2 className="section-title">Projects</h2>
        <p style={{ opacity: 0.4, fontSize: "13px" }}>No projects yet.</p>
      </div>
    );
  }

  return (
    <div className="glass-card">
      <h2 className="section-title">Projects</h2>
      <div className="projects-grid">
        {projects.map((project, index) => (
          <div key={project.id ?? index} className="project-card">
            <div className="project-header">
              <h3 className="project-title">{project.title}</h3>
              <span className={`project-status ${(project.status || "").toLowerCase()}`}>
                {project.status}
              </span>
            </div>
            <p className="project-description">{project.description}</p>
            {Array.isArray(project.tags) && project.tags.length > 0 && (
              <div className="project-tech">
                {project.tags.map((tag, i) => (
                  <span key={i} className="tech-tag">{tag}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ========== Activity Timeline ========== */
function ActivityTimeline({ activities }) {
  if (!activities || activities.length === 0) {
    return (
      <div className="glass-card">
        <h2 className="section-title">Activity</h2>
        <p style={{ opacity: 0.4, fontSize: "13px" }}>No recent activity.</p>
      </div>
    );
  }

  return (
    <div className="glass-card">
      <h2 className="section-title">Activity</h2>
      <div className="timeline">
        {activities.map((event, index) => (
          <div key={event.id ?? index} className="timeline-item">
            <div className="timeline-dot" />
            <div className="timeline-content">
              <div className="timeline-title">
                {EVENT_LABELS[event.event_type] || event.event_type}
                {event.project_title && (
                  <span style={{ opacity: 0.6 }}> — {event.project_title}</span>
                )}
              </div>
              <div className="timeline-date">{timeAgo(event.created_at)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ========== Trust Signals ========== */
function TrustSignals({ signals }) {
  return (
    <div className="glass-card">
      <h2 className="section-title">Trust Signals</h2>
      <div className="trust-badges">
        <div className={`trust-badge${signals?.emailVerified ? " active" : ""}`}>
          <span className="trust-icon">{signals?.emailVerified ? "✅" : "✉️"}</span>
          {signals?.emailVerified ? "Email Verified" : "Email Not Verified"}
        </div>
        <div className={`trust-badge${signals?.phoneVerified ? " active" : ""}`}>
          <span className="trust-icon">{signals?.phoneVerified ? "✅" : "📱"}</span>
          {signals?.phoneVerified ? "Phone Verified" : "Phone Not Verified"}
        </div>
      </div>
    </div>
  );
}

/* ========== Main Profile Component ========== */
export default function Profile() {
  const { currentUser } = useAuth();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [skills, setSkills] = useState([]);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [projects, setProjects] = useState([]);
  const [activity, setActivity] = useState([]);

  const userId = currentUser?.id ?? null;
  const isOwner = Boolean(userId && profile?.user?.id && Number(userId) === Number(profile.user.id));

  const fetchProfile = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    try {
      const resp = await apiRequest(`/profile/${userId}`);
      if (!resp.ok) throw new Error("Profile fetch failed");
      const data = await resp.json();
      setProfile(data);
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  useEffect(() => {
    if (!userId) { setSkillsLoading(false); return; }
    apiRequest(`/profile/${userId}/skills`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setSkills(Array.isArray(data) ? data : []))
      .catch(() => setSkills([]))
      .finally(() => setSkillsLoading(false));
  }, [userId]);

  // Fetch real projects for this user
  useEffect(() => {
    if (!userId || !profile?.user?.role) return;
    const role = profile.user.role;
    const endpoint = role === "developer"
      ? `/projects/assigned/${userId}?limit=10`
      : `/api/projects?limit=10`;
    apiRequest(endpoint)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => setProjects(data?.data ?? []))
      .catch(() => setProjects([]));
  }, [userId, profile?.user?.role]);

  // Fetch real activity for this user
  useEffect(() => {
    if (!userId || !profile?.user?.role) return;
    const role = profile.user.role;
    const endpoint = role === "developer"
      ? `/api/activity/developer?limit=10`
      : `/api/activity/client?limit=10`;
    apiRequest(endpoint)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => setActivity(data?.data ?? []))
      .catch(() => setActivity([]));
  }, [userId, profile?.user?.role]);

  if (loading || skillsLoading) {
    return (
      <div className="profile-page">
        <TopBar title="Profile" search="" onSearch={() => {}} total={null} filtered={null} showSearch={false} />
        <div className="profile-container">
          <div className="profile-content">
            <div className="glass-card" style={{ textAlign: "center", padding: "3rem" }}>
              Loading profile…
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!profile || !profile.user) {
    return (
      <div className="profile-page">
        <TopBar title="Profile" search="" onSearch={() => {}} total={null} filtered={null} showSearch={false} />
        <div className="profile-container">
          <div className="profile-content">
            <div className="glass-card" style={{ textAlign: "center", padding: "3rem" }}>
              {userId ? "Unable to load profile." : "Please log in to view your profile."}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const user = profile.user;
  const stats = profile.stats || {};
  const signals = profile.signals || {};

  const formattedUser = {
    name: user.username,
    role: user.role,
    email: user.email,           // only present for self-view
    phone: user.phone,           // only present for self-view
    emailVerified: user.email_verified,
    phoneVerified: user.phone_verified,
    bio: user.bio,
  };

  const formattedStats = {
    projectsCompleted: Number(stats.projectsCompleted) || 0,
    activeProjects: Number(stats.activeProjects) || 0,
  };

  return (
    <div className="profile-page">
      <TopBar title="Profile" search="" onSearch={() => {}} total={null} filtered={null} showSearch={false} />
      <div className="profile-container">
        <div className="profile-content">
          <ProfileHeader
            user={formattedUser}
            isOwner={isOwner}
            onEditBio={() => {/* handled inside AboutSection */}}
          />
          <StatsStrip stats={formattedStats} role={user.role} />
          <AboutSection
            bio={formattedUser.bio}
            isOwner={isOwner}
            userId={userId}
            onBioSaved={(newBio) => {
              setProfile((prev) => ({
                ...prev,
                user: { ...prev.user, bio: newBio },
              }));
            }}
          />
          <SkillsSection
            skills={skills}
            setSkills={setSkills}
            isOwner={isOwner}
            userId={userId}
          />
          <ProjectsSection projects={projects} role={user.role} />
          <ActivityTimeline activities={activity} />
          {isOwner && <TrustSignals signals={signals} />}
        </div>
      </div>
    </div>
  );
}
