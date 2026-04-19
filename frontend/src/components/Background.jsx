export default function Background({ mousePos }) {
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
