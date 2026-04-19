import { useEffect, useState } from "react";
import "./ProjectBidsModal.css";
export default function ProjectBidsModal({ project, onClose }) {
  const [bids, setBids] = useState([]);
  const [loading, setLoading] = useState(true);

  const token = localStorage.getItem("token");

  useEffect(() => {
    fetchBids();
  }, []);

  const fetchBids = async () => {
    try {
      const res = await fetch(
        `http://localhost:5000/api/projects/${project.id}/bids`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const data = await res.json();
      if (Array.isArray(data)) {
        setBids(data);
      } else {
        console.error("Unexpected response:", data);
        setBids([]); // fallback to empty
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const acceptBid = async (bidId) => {
    try {
      await fetch(
        `http://localhost:5000/api/projects/${project.id}/accept-bid/${bidId}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      fetchBids(); // refresh
    } catch (err) {
      console.error(err);
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
          (Array.isArray(bids) ? bids : []).map((bid) => (
            <div key={bid.id} className="bid-card">
              <h4>
                {bid.first_name} {bid.last_name}
              </h4>
              <p>{bid.proposal}</p>
              <p>₹{bid.amount}</p>
              <p>Status: {bid.status}</p>

              {bid.status !== "accepted" && (
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
