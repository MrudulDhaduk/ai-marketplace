import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFadeUp } from '../hooks/useFadeup';
import { apiRequest } from '../lib/api';

/* ── Project detail modal ─────────────────────────── */
function ProjectModal({ project, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const budget = project.min_budget && project.max_budget
    ? `₹${Number(project.min_budget).toLocaleString()} – ₹${Number(project.max_budget).toLocaleString()}`
    : 'Budget TBD';

  const due = project.due_date
    ? new Date(project.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'No deadline';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#0f1117', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '16px', padding: '32px', maxWidth: '560px', width: '100%',
          maxHeight: '80vh', overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0, lineHeight: 1.3 }}>{project.title}</h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: '20px', cursor: 'pointer', padding: '0 4px' }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Status + budget */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <span style={{
            padding: '4px 10px', borderRadius: '20px', fontSize: '12px',
            background: 'rgba(34,211,238,0.15)', color: '#22d3ee', border: '1px solid rgba(34,211,238,0.3)',
          }}>
            {project.status}
          </span>
          <span style={{
            padding: '4px 10px', borderRadius: '20px', fontSize: '12px',
            background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.7)',
          }}>
            {budget}
          </span>
          <span style={{
            padding: '4px 10px', borderRadius: '20px', fontSize: '12px',
            background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.7)',
          }}>
            Due: {due}
          </span>
        </div>

        {/* Description */}
        <p style={{ fontSize: '14px', lineHeight: 1.7, opacity: 0.8, marginBottom: '20px' }}>
          {project.description}
        </p>

        {/* Tags */}
        {project.tags?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '24px' }}>
            {project.tags.map((tag) => (
              <span key={tag} style={{
                padding: '3px 10px', borderRadius: '12px', fontSize: '12px',
                background: 'rgba(124,92,252,0.15)', color: '#a78bfa',
                border: '1px solid rgba(124,92,252,0.3)',
              }}>
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* CTA */}
        <a
          href="/signup"
          style={{
            display: 'inline-block', padding: '10px 24px',
            background: 'linear-gradient(135deg, #4f8ef7, #7c5cfc)',
            color: '#fff', borderRadius: '8px', fontSize: '14px',
            fontWeight: 600, textDecoration: 'none',
          }}
        >
          Sign up to bid →
        </a>
      </div>
    </div>
  );
}

/* ── Project card ─────────────────────────────────── */
function ProjectCard({ project, onClick }) {
  const budget = project.min_budget && project.max_budget
    ? `₹${Number(project.min_budget).toLocaleString()} – ₹${Number(project.max_budget).toLocaleString()}`
    : 'Budget TBD';

  return (
    <div
      className="project-card"
      onClick={() => onClick(project)}
      style={{ cursor: 'pointer' }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(project); }}
    >
      <div className="project-header">
        <span className="project-category">
          {project.tags?.[0] || 'AI Project'}
        </span>
        <span className="project-budget">{budget}</span>
      </div>

      <h3>{project.title}</h3>
      <p style={{ WebkitLineClamp: 2, display: '-webkit-box', WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {project.description}
      </p>

      <div className="project-skills">
        {(project.tags || []).slice(0, 4).map((tag) => (
          <span className="skill-tag" key={tag}>{tag}</span>
        ))}
      </div>

      <div className="project-footer">
        <div className="project-bids">
          <span>{project.bids_count ?? project.bids ?? 0}</span> bids so far
        </div>
        <button className="btn-ghost" style={{ fontSize: '12px', padding: '5px 12px' }}>
          View →
        </button>
      </div>
    </div>
  );
}

/* ── Main component ───────────────────────────────── */
function Projects() {
  const ref = useFadeUp();
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        setLoading(true);
        setError(null);
        // Use apiRequest instead of raw fetch — gets proper auth headers
        // and consistent 401 handling via the centralized api layer
        const res = await apiRequest(`/projects?limit=6`);
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        const data = await res.json();
        setProjects(Array.isArray(data) ? data : (data.data || []));
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchProjects();
  }, []);

  return (
    <>
      {selectedProject && (
        <ProjectModal project={selectedProject} onClose={() => setSelectedProject(null)} />
      )}

      <div className="section-divider" />
      <section id="projects" className="section fade-up" ref={ref}>
        <div className="projects-header">
          <div>
            <div className="section-label">Marketplace</div>
            <h2 className="section-heading" style={{ marginBottom: '4px' }}>
              Live Projects
            </h2>
            <p className="section-sub" style={{ fontSize: '15px' }}>
              Real projects waiting for developers right now.
            </p>
          </div>
          <button
            className="btn-ghost"
            onClick={() => navigate('/signup')}
          >
            View all projects →
          </button>
        </div>

        {loading && (
          <div className="projects-loading">Loading projects…</div>
        )}

        {error && (
          <div className="projects-error">
            Could not load projects. The server may be starting up.
          </div>
        )}

        {!loading && !error && projects.length === 0 && (
          <div className="projects-loading" style={{ opacity: 0.5 }}>
            No open projects yet — be the first to post one.
          </div>
        )}

        {!loading && !error && projects.length > 0 && (
          <div className="projects-grid">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onClick={setSelectedProject}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

export default Projects;
