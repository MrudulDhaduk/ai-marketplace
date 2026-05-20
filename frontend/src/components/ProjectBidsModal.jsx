import "./ProjectBidsModal.css";
import { apiRequest } from "../lib/api";
import { useProjectBids } from "../hooks/useProjectQueries";
import { queryClient } from "../lib/queryClient";
import { queryKeys } from "../lib/queryKeys";

export default function ProjectBidsModal({ project, onClose }) {
  /*
   * Replace manual useEffect + fetch (which had a missing project.id dep)
   * with useProjectBids — properly keyed on project.id, no stale data.
   */
  const { data: bids = [], isLoading: loading } = useProjectBids(project?.id);

  const acceptBid = async (bidId) => {
    try {
      await apiRequest(
        `/api/projects/${project.id}/accept-bid/${bidId}`,
        { method: "POST" }
      );
      // Invalidate bids cache so the list refreshes with the accepted status
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.bids(project.id) });
      // Also invalidate the project list so the dashboard badge updates
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.list() });
    } catch {
      // ignore
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2>Bids for {project.title}</h2>

        {loading ? (
          <p>Loading...</p>
        ) : bids.length === 0 ? (
          <p>No bids yet</p>
        ) : (
          bids.map((bid) => (
            <div key={bid.id} className="bid-card">
              <h4>
                {bid.first_name} {bid.last_name}
              </h4>
              <p>{bid.proposal}</p>
              <p>₹{bid.amount}</p>
              <p>Status: {bid.status}</p>

              {bid.status === "accepted" ? (
                <button className="accepted-btn">Accepted ✓</button>
              ) : bids.some((b) => b.status === "accepted") ? (
                <button className="disabled-btn" disabled>
                  Not Available
                </button>
              ) : (
                <button onClick={() => acceptBid(bid.id)}>Accept</button>
              )}
            </div>
          ))
        )}

        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
