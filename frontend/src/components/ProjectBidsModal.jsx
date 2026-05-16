import { useEffect, useState } from "react";
import "./ProjectBidsModal.css";
import { apiRequest } from "../api";

export default function ProjectBidsModal({ project, onClose }) {
  const [bids, setBids] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBids();
  }, []);

  const fetchBids = async () => {
    try {
      const res = await apiRequest(`/api/projects/${project.id}/bids`);
      const data = await res.json();
      const rows = Array.isArray(data) ? data : (data.data ?? []);
      setBids(rows);
    } catch {
      setBids([]);
    } finally {
      setLoading(false);
    }
  };

  const acceptBid = async (bidId) => {
    try {
      await apiRequest(
        `/api/projects/${project.id}/accept-bid/${bidId}`,
        { method: "POST" }
      );
      fetchBids();
    } catch {
      // ignore
    }
  };
  const hasAccepted = bids.some((b) => b.status === "accepted");
  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2>Bids for {project.title}</h2>

        {loading ? (
          <p>Loading...</p>
        ) : bids.length === 0 ? (
          <p>No bids yet</p>
        ) : (
          (Array.isArray(bids) ? bids : []).map((bid) => (
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
