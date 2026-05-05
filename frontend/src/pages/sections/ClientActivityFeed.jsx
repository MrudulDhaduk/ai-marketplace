const FEED = [
  { id: 1, dot: "orange", text: 'New bid on "AI Chatbot for E-commerce"', time: "2m ago" },
  { id: 2, dot: "teal", text: 'Dev replied on "Object Detection"', time: "14m ago" },
  { id: 3, dot: "lime", text: '"Voice-to-Invoice" milestone complete', time: "1h ago" },
  { id: 4, dot: "orange", text: '3 new bids on "Resume Screening"', time: "3h ago" },
  { id: 5, dot: "gold", text: 'Deadline alert: "Content Calendar" in 5 days', time: "5h ago" },
];

export default function ClientActivityFeed() {
  return (
    <aside className="feed">
      <div className="feed-head">
        <span className="feed-title">Live Feed</span>
        <span className="feed-live-badge">
          <span className="feed-live-dot" />
          Live
        </span>
      </div>
      <ul className="feed-list">
        {FEED.map((item, index) => (
          <li key={item.id} className="feed-row" style={{ "--fi": index }}>
            <span className={`feed-pip pip--${item.dot}`} />
            <div className="feed-content">
              <p className="feed-text">{item.text}</p>
              <span className="feed-time">{item.time}</span>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
