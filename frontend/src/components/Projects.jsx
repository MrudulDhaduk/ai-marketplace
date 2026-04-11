import { useState, useEffect } from 'react';
import { useFadeUp } from '../hooks/useFadeup';

const API_URL = 'http://localhost:5000/projects';

function ProjectCard({ project, onClick }) {
  return (
    <div className="project-card" onClick={() => onClick(project)}>
      <div className="project-header">
        <span className="project-category">{project.category}</span>
        <span className="project-budget">{project.budget}</span>
      </div>

      <h3>{project.title}</h3>
      <p>{project.description}</p>

      <div className="project-skills">
        {(project.tags || []).map((tag) => (
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

function Projects() {
  const ref = useFadeUp();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(API_URL);
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        const data = await res.json();
        setProjects(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchProjects();
  }, []);

  const handleCardClick = (project) => {
    // TODO: Navigate to project detail page
    console.log('Project clicked:', project);
  };

  return (
    <>
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
          <button className="btn-ghost">View all projects →</button>
        </div>

        {loading && (
          <div className="projects-loading">Loading projects...</div>
        )}

        {error && (
          <div className="projects-error">
            Could not load projects: {error}
          </div>
        )}

        {!loading && !error && (
          <div className="projects-grid">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onClick={handleCardClick}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

export default Projects;