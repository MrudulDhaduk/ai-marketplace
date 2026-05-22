import React from "react";

/**
 * QuickActionsPanel — stateless, driven entirely by props.
 *
 * Props:
 *   actions       Array<{ key, label, icon, description, onClick, disabled, variant }>
 *   actionMessage string  — shown as a toast below the buttons when non-empty
 *   layout        "client" | "developer"  — controls which CSS class set is used
 *                 "client"   → container: cpw-quick-actions, button: cpw-action-btn
 *                 "developer"→ container: dd-qa-grid,         button: dd-qa-btn
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.6
 */
const QuickActionsPanel = React.memo(function QuickActionsPanel({
  actions = [],
  actionMessage = "",
  layout = "client",
}) {
  const isDeveloper = layout === "developer";

  const containerClass = isDeveloper ? "dd-qa-grid" : "cpw-quick-actions";
  const btnBaseClass   = isDeveloper ? "dd-qa-btn"  : "cpw-action-btn";
  const iconClass      = isDeveloper ? "dd-qa-icon" : "cpw-action-icon";

  return (
    <>
      <div className={containerClass}>
        {actions.map((action) => {
          // Variant modifier only applies to client layout (cpw-action-btn--{variant})
          const variantClass =
            !isDeveloper && action.variant
              ? ` ${btnBaseClass}--${action.variant}`
              : "";

          return (
            <button
              key={action.key}
              className={`${btnBaseClass}${variantClass}`}
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
            >
              <span className={iconClass}>{action.icon}</span>
              {isDeveloper ? (
                // Developer layout: simple span text, no strong/small
                <span>{action.label}</span>
              ) : (
                // Client layout: strong label + small description
                <span className="cpw-action-text">
                  <strong>{action.label}</strong>
                  {action.description && <small>{action.description}</small>}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {actionMessage && (
        <div className="cpw-action-toast">{actionMessage}</div>
      )}
    </>
  );
});

export default QuickActionsPanel;
