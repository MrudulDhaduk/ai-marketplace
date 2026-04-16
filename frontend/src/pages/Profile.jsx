"use client";

import React, { useState, useEffect } from "react";
import "./Profile.css";
import TopBar from "../components/TopBar";

/* ========== Profile Header ========== */
function ProfileHeader({ user, isOwner }) {
  return (
    <div className="glass-card profile-header">
      <div className="profile-header-left">
        <div className="avatar-container">
          <div className="avatar">
            <img
              src={user.avatar || "/placeholder-avatar.png"}
              alt={user.name}
            />
          </div>
          {user.isOnline && <div className="online-indicator" />}
        </div>

        <div className="profile-info">
          <h1 className="profile-name">{user.name}</h1>
          <span className="profile-role">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            Developer
          </span>

          <div className="contact-info">
            <div className="contact-item">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              <span>{user.email}</span>
              {user.emailVerified ? (
                <span className="verified-badge">&#10003;</span>
              ) : (
                <button className="verify-btn">Verify Email</button>
              )}
            </div>

            <div className="contact-item">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              <span>{user.phone}</span>
              {user.phoneVerified ? (
                <span className="verified-badge">&#10003;</span>
              ) : (
                <button className="verify-btn">Verify Phone</button>
              )}
            </div>
          </div>
        </div>
      </div>
      {isOwner && <button className="edit-profile-btn">Edit Profile</button>}
    </div>
  );
}

/* ========== Stats Strip ========== */
function StatsStrip({ stats }) {
  return (
    <div className="stats-strip">
      <div className="stat-card">
        <div className="stat-value">{stats.projectsCompleted}</div>
        <div className="stat-label">Projects Completed</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{stats.activeProjects}</div>
        <div className="stat-label">Active Projects</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">
          ${stats.avgMonthlyEarnings && stats.avgMonthlyEarnings.toLocaleString()}
        </div>
        <div className="stat-label">Avg Monthly Earnings</div>
      </div>
    </div>
  );
}

/* ========== About Section ========== */
function AboutSection({ bio }) {
  const [expanded, setExpanded] = useState(false);
  const shouldShowReadMore = bio && bio.length > 200;

  return (
    <div className="glass-card">
      <h2 className="section-title">About</h2>
      <p
        className={`about-text ${!expanded && shouldShowReadMore ? "collapsed" : ""}`}
      >
        {bio}
      </p>
      {shouldShowReadMore && (
        <button
          className="read-more-btn"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show Less" : "Read More"}
        </button>
      )}
    </div>
  );
}

/* ========== Skills Section ========== */
function SkillsSection({ skills, setSkills, isOwner, userId }) {
  const [newSkill, setNewSkill] = useState("");

  const handleAddSkill = async (e) => {
    e.preventDefault();
    const trimmedSkill = newSkill.trim();
    if (!trimmedSkill || skills.includes(trimmedSkill)) return;

    try {
      const resp = await fetch(
        `http://localhost:5000/profile/${userId}/skills`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ skill: trimmedSkill }),
        }
      );
      if (resp.ok) {
        setSkills([...skills, trimmedSkill]);
        setNewSkill("");
      }
      // Optionally: handle backend errors
    } catch (err) {
      // Optionally handle error
    }
  };

  const handleRemoveSkill = async (skillToRemove) => {
    try {
      const resp = await fetch(
        `http://localhost:5000/profile/${userId}/skills`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ skill: skillToRemove }),
        }
      );
      if (resp.ok) {
        setSkills(skills.filter((skill) => skill !== skillToRemove));
      }
      // Optionally: handle backend errors
    } catch (err) {
      // Optionally handle error
    }
  };

  return (
    <div className="glass-card">
      <h2 className="section-title">Skills</h2>
      <div className="skills-container">
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
            placeholder="Add a skill..."
            value={newSkill}
            onChange={(e) => setNewSkill(e.target.value)}
          />
          <button type="submit" className="add-skill-btn">
            Add
          </button>
        </form>
      )}
    </div>
  );
}

/* ========== Projects Section ========== */
function ProjectsSection({ projects }) {
  return (
    <div className="glass-card">
      <h2 className="section-title">Projects</h2>
      <div className="projects-grid">
        {projects && projects.map((project, index) => (
          <div key={index} className="project-card">
            <div className="project-header">
              <h3 className="project-title">{project.title}</h3>
              <span
                className={`project-status ${project.status.toLowerCase()}`}
              >
                {project.status}
              </span>
            </div>
            <p className="project-description">{project.description}</p>
            <div className="project-tech">
              {project.tech && project.tech.map((tech, techIndex) => (
                <span key={techIndex} className="tech-tag">
                  {tech}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ========== Activity Timeline ========== */
function ActivityTimeline({ activities }) {
  return (
    <div className="glass-card">
      <h2 className="section-title">Activity</h2>
      <div className="timeline">
        {activities && activities.map((activity, index) => (
          <div key={index} className="timeline-item">
            <div className="timeline-dot" />
            <div className="timeline-content">
              <div className="timeline-title">{activity.title}</div>
              <div className="timeline-date">{activity.date}</div>
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
        {signals?.emailVerified && (
          <div className="trust-badge active">
            <span className="trust-icon">&#9989;</span>
            Email Verified
          </div>
        )}
        {signals?.phoneVerified && (
          <div className="trust-badge active">
            <span className="trust-icon">&#9989;</span>
            Phone Verified
          </div>
        )}
        {signals?.isActiveDeveloper && (
          <div className="trust-badge active">
            <span className="trust-icon">&#9889;</span>
            Active Developer
          </div>
        )}
        {!signals?.emailVerified && (
          <div className="trust-badge">
            <span className="trust-icon">&#9993;</span>
            Email Not Verified
          </div>
        )}
        {!signals?.phoneVerified && (
          <div className="trust-badge">
            <span className="trust-icon">&#128222;</span>
            Phone Not Verified
          </div>
        )}
      </div>
    </div>
  );
}

/* ========== Main Profile Component ========== */
export default function Profile() {
  // In production: determine from auth context
  const isOwner = true;

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const [skills, setSkills] = useState([]);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const userObj = JSON.parse(window.localStorage.getItem("user"));
        if (!userObj || !userObj.id) {
          setProfile(null);
          setLoading(false);
          setUserId(null);
          return;
        }
        setUserId(userObj.id);
        const resp = await fetch(`http://localhost:5000/profile/${userObj.id}`);
        if (!resp.ok) throw new Error("Profile fetch failed");
        const data = await resp.json();
        setProfile(data);
      } catch (err) {
        setProfile(null);
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);

  useEffect(() => {
    // Fetch skills from backend using userId
    const fetchSkills = async () => {
      if (!userId) {
        setSkills([]);
        setSkillsLoading(false);
        return;
      }
      try {
        const resp = await fetch(`http://localhost:5000/profile/${userId}/skills`);
        if (!resp.ok) throw new Error("Skills fetch failed");
        const data = await resp.json();
        setSkills(data || []);
      } catch (err) {
        setSkills([]);
      } finally {
        setSkillsLoading(false);
      }
    };
    fetchSkills();
  }, [userId]);

  if (loading || skillsLoading) {
    return (
      <div className="profile-page">
        <TopBar
          title="Profile"
          search=""
          onSearch={() => {}}
          total={null}
          filtered={null}
          showSearch={false}
        />
        <div className="profile-container">
          <div className="profile-content">
            <div className="glass-card" style={{ textAlign: "center", padding: "3rem" }}>
              Loading profile...
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!profile || !profile.user || !profile.stats) {
    return (
      <div className="profile-page">
        <TopBar
          title="Profile"
          search=""
          onSearch={() => {}}
          total={null}
          filtered={null}
          showSearch={false}
        />
        <div className="profile-container">
          <div className="profile-content">
            <div className="glass-card" style={{ textAlign: "center", padding: "3rem", color: "red" }}>
              Unable to load profile.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Data normalization / mapping
  const formattedUser = {
    name: profile.user.username,
    email: profile.user.email,
    phone: profile.user.phone,
    emailVerified: profile.user.email_verified,
    phoneVerified: profile.user.phone_verified,
    avatar: null,
    isOnline: true,
    bio: profile.user.bio,
  };

  const formattedStats = {
    projectsCompleted: Number(profile.stats?.projectsCompleted) || 0,
    activeProjects: Number(profile.stats?.activeProjects) || 0,
    avgMonthlyEarnings: 0,
  };

  const formattedProjects = Array.isArray(profile.projects) ? profile.projects : [];
  const formattedActivities = Array.isArray(profile.activities) ? profile.activities : [];
  const formattedSignals = profile.signals || {};

  return (
    <div className="profile-page">
      <TopBar
        title="Profile"
        search=""
        onSearch={() => {}}
        total={null}
        filtered={null}
        showSearch={false}
      />
      <div className="profile-container">
        <div className="profile-content">
          <ProfileHeader user={formattedUser} isOwner={isOwner} />
          <StatsStrip stats={formattedStats} />
          <AboutSection bio={formattedUser.bio} />
          <SkillsSection
            skills={skills}
            setSkills={setSkills}
            isOwner={isOwner}
            userId={userId}
          />
          <ProjectsSection projects={formattedProjects} />
          <ActivityTimeline activities={formattedActivities} />
          <TrustSignals signals={formattedSignals} />
        </div>
      </div>
    </div>
  );
}
