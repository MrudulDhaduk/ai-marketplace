export default function Background({ mousePos, variant = "developer", light = false, tabTone = "all" }) {
  if (variant === "client") {
    return (
      <div
        className={`bg-layer ${light ? `bg-layer--light bg-layer--tone-${tabTone}` : "bg-layer--dark"}`}
      >
        {light ? (
          <>
            <div className="bg-mesh" />
            <div className="bg-blob bg-blob--1" />
            <div className="bg-blob bg-blob--2" />
            <div className="bg-blob bg-blob--3" />
            <div className="bg-dot-grid" />
            <div className="bg-grain" />
          </>
        ) : (
          <>
            <div className="bg-orb bg-orb--1" />
            <div className="bg-orb bg-orb--2" />
            <div className="bg-orb bg-orb--3" />
            <div className="bg-aurora-grid" />
            <div className="bg-noise" />
            <div className="bg-vignette" />
          </>
        )}

        <div
          className={`bg-cursor-orb ${light ? "bg-cursor-orb--light" : "bg-cursor-orb--dark"}`}
          style={{ left: mousePos.x, top: mousePos.y }}
        />
      </div>
    );
  }

  return (
    <div className="dd-bg">
      <div className="dd-bg-base" />
      <div className="dd-bg-orb dd-bg-orb--1" />
      <div className="dd-bg-orb dd-bg-orb--2" />
      <div className="dd-bg-orb dd-bg-orb--3" />
      <div className="dd-bg-cursor" style={{ left: mousePos.x, top: mousePos.y }} />
      <div className="dd-bg-grid" />
      <div className="dd-bg-noise" />
    </div>
  );
}
