import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";

/* ── Skill tag ─────────────────────────────────── */
function SkillTag({ skill, onRemove, saving }) {
  return (
    <div className="skill-tag" style={{
      display: "inline-flex",
      alignItems: "center",
      gap: "6px",
      padding: "4px 10px",
      background: "rgba(255,255,255,0.07)",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: "20px",
      fontSize: "13px",
      margin: "4px",
    }}>
      {skill}
      <button
        onClick={() => onRemove(skill)}
        disabled={saving}
        aria-label={`Remove ${skill}`}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "rgba(255,255,255,0.5)",
          fontSize: "14px",
          lineHeight: 1,
          padding: "0 2px",
        }}
      >
        ×
      </button>
    </div>
  );
}

export default function DeveloperSettings() {
  const { currentUser } = useAuth();
  const userId = currentUser?.id;

  /* bio state */
  const [bio, setBio] = useState("");
  const [bioSaving, setBioSaving] = useState(false);
  const [bioMsg, setBioMsg] = useState("");

  /* skills state */
  const [skills, setSkills] = useState([]);
  const [newSkill, setNewSkill] = useState("");
  const [skillSaving, setSkillSaving] = useState(false);
  const [skillMsg, setSkillMsg] = useState("");

  /* load current profile + skills */
  useEffect(() => {
    if (!userId) return;
    apiRequest(`/profile/${userId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.user?.bio) setBio(data.user.bio);
      })
      .catch(() => {});

    apiRequest(`/profile/${userId}/skills`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (Array.isArray(data)) setSkills(data);
      })
      .catch(() => {});
  }, [userId]);

  /* save bio */
  const handleSaveBio = async (e) => {
    e.preventDefault();
    if (!userId) return;
    setBioSaving(true);
    setBioMsg("");
    try {
      const r = await apiRequest(`/profile/${userId}`, {
        method: "PUT",
        body: JSON.stringify({ bio }),
      });
      if (r.ok) {
        setBioMsg("✓ Bio saved");
      } else {
        const d = await r.json();
        setBioMsg(d.message || "Failed to save");
      }
    } catch {
      setBioMsg("Failed to save");
    } finally {
      setBioSaving(false);
      setTimeout(() => setBioMsg(""), 3000);
    }
  };

  /* add skill */
  const handleAddSkill = async (e) => {
    e.preventDefault();
    const trimmed = newSkill.trim();
    if (!trimmed || skills.includes(trimmed)) return;
    setSkillSaving(true);
    setSkillMsg("");
    try {
      const r = await apiRequest(`/profile/${userId}/skills`, {
        method: "POST",
        body: JSON.stringify({ skill: trimmed }),
      });
      if (r.ok) {
        setSkills((prev) => [...prev, trimmed]);
        setNewSkill("");
        setSkillMsg("✓ Skill added");
      } else {
        const d = await r.json();
        setSkillMsg(d.message || "Failed to add skill");
      }
    } catch {
      setSkillMsg("Failed to add skill");
    } finally {
      setSkillSaving(false);
      setTimeout(() => setSkillMsg(""), 3000);
    }
  };

  /* remove skill */
  const handleRemoveSkill = async (skill) => {
    setSkillSaving(true);
    try {
      const r = await apiRequest(`/profile/${userId}/skills`, {
        method: "DELETE",
        body: JSON.stringify({ skill }),
      });
      if (r.ok) {
        setSkills((prev) => prev.filter((s) => s !== skill));
      }
    } catch {}
    setSkillSaving(false);
  };

  return (
    <div className="dd-content">
      <div className="dd-grid" style={{ gridTemplateColumns: "1fr" }}>

        {/* Account info (read-only) */}
        <div className="dd-card" style={{ "--ci": 0 }}>
          <h3 className="dd-card-title">Account</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "12px" }}>
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <span style={{ opacity: 0.5, fontSize: "13px", minWidth: "80px" }}>Username</span>
              <span style={{ fontSize: "14px" }}>{currentUser?.username}</span>
            </div>
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <span style={{ opacity: 0.5, fontSize: "13px", minWidth: "80px" }}>Role</span>
              <span className="dd-status active" style={{ fontSize: "12px" }}>{currentUser?.role}</span>
            </div>
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <span style={{ opacity: 0.5, fontSize: "13px", minWidth: "80px" }}>Email</span>
              <span style={{ fontSize: "14px" }}>{currentUser?.email || "—"}</span>
            </div>
          </div>
        </div>

        {/* Bio */}
        <div className="dd-card" style={{ "--ci": 1 }}>
          <h3 className="dd-card-title">Bio</h3>
          <p className="dd-card-desc" style={{ marginBottom: "12px" }}>
            Tell clients about yourself, your expertise, and what you build.
          </p>
          <form onSubmit={handleSaveBio}>
            <textarea
              className="dd-input"
              placeholder="I'm a full-stack developer specialising in AI/ML integrations…"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={1000}
              style={{ minHeight: "120px", width: "100%", resize: "vertical" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "10px" }}>
              <span style={{ fontSize: "12px", opacity: 0.4 }}>{bio.length}/1000</span>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                {bioMsg && (
                  <span style={{ fontSize: "13px", color: bioMsg.startsWith("✓") ? "var(--cyan, #22d3ee)" : "#f87171" }}>
                    {bioMsg}
                  </span>
                )}
                <button className="dd-bid-btn" type="submit" disabled={bioSaving}>
                  {bioSaving ? "Saving…" : "Save Bio"}
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* Skills */}
        <div className="dd-card" style={{ "--ci": 2 }}>
          <h3 className="dd-card-title">Skills</h3>
          <p className="dd-card-desc" style={{ marginBottom: "12px" }}>
            Skills are used to match you with relevant projects in your feed.
          </p>

          <div style={{ marginBottom: "16px", minHeight: "40px" }}>
            {skills.length === 0 ? (
              <p style={{ opacity: 0.4, fontSize: "13px" }}>No skills added yet.</p>
            ) : (
              skills.map((s) => (
                <SkillTag key={s} skill={s} onRemove={handleRemoveSkill} saving={skillSaving} />
              ))
            )}
          </div>

          <form onSubmit={handleAddSkill} style={{ display: "flex", gap: "8px" }}>
            <input
              className="dd-input"
              type="text"
              placeholder="e.g. React, Python, LLM"
              value={newSkill}
              onChange={(e) => setNewSkill(e.target.value)}
              maxLength={60}
              style={{ flex: 1 }}
            />
            <button className="dd-bid-btn" type="submit" disabled={skillSaving || !newSkill.trim()}>
              {skillSaving ? "…" : "Add"}
            </button>
          </form>
          {skillMsg && (
            <p style={{ fontSize: "13px", marginTop: "8px", color: skillMsg.startsWith("✓") ? "var(--cyan, #22d3ee)" : "#f87171" }}>
              {skillMsg}
            </p>
          )}
        </div>

      </div>
    </div>
  );
}
