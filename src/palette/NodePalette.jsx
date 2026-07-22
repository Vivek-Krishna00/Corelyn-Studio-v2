// The left-hand block palette: categories from shared/nodes.json, each
// collapsible, each block draggable onto the canvas or clickable to place it.
import { CATEGORY_META, CATEGORY_ORDER, NODE_DEFS } from "../nodeDefs";

export default function NodePalette({ expandedCategories, onToggleCategory, onPaletteDragStart, onAddNode, onClose, isMobile }) {
  return (
    <>
      <div className="palette-header">
        <div>
          <div className="palette-eyebrow">System Blocks</div>
          <div className="palette-title">Blocks</div>
        </div>
        {isMobile && (
          <button className="palette-close" onClick={onClose} aria-label="Close blocks panel">x</button>
        )}
      </div>
      <div className="palette-search" aria-hidden="true">
        <span>⌕</span>
        <span>Search Blocks</span>
      </div>
      <div className="palette-groups">
        {CATEGORY_ORDER.map(category => {
          const meta = CATEGORY_META[category];
          const items = NODE_DEFS.filter(node => node.category === category);
          const isOpen = Boolean(expandedCategories[category]);
          return (
            <div className="palette-group" key={category}>
              <button className="palette-group-trigger" onClick={() => onToggleCategory(category)} type="button">
                <span className={`palette-chevron ${isOpen ? "palette-chevron-open" : ""}`}>›</span>
                <span className="palette-category-dot" style={{ background: meta.color, boxShadow: `0 0 14px ${meta.color}55` }} />
                <span className="palette-category-label">{meta.label}</span>
                <span className="palette-category-count">{items.length}</span>
              </button>
              {isOpen && (
                <div className="palette-block-list">
                  {items.map((def, index) => {
                    const blockColor = def.color;
                    const isWideBlock = def.label.length > 10;
                    return (
                      <button
                        key={def.type}
                        className={`palette-block ${isWideBlock ? "palette-block-wide" : ""} ${def.type === "stop" ? "palette-block-danger" : ""}`}
                        draggable
                        onDragStart={event => onPaletteDragStart(event, def.type)}
                        onClick={() => onAddNode(def.type)}
                        type="button"
                        style={{ "--block-index": index, "--block-color": blockColor }}
                      >
                        <span className="palette-block-dot" style={{ background: blockColor }} />
                        <span className="palette-block-label">{def.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
