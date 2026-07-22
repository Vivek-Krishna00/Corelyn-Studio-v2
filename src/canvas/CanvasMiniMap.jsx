// The bottom-right overview: every node as a dot, plus the current viewport.
import { getNodeDef } from "../nodeDefs";
import { getNodePlacementRect, rectsIntersect } from "./geometry";

export default function CanvasMiniMap({ nodes, selected, selectedIds = [], pan, zoom, canvasSize }) {
  if (!nodes.length || canvasSize.width <= 0 || canvasSize.height <= 0) return null;

  const width = 168;
  const height = 108;
  const viewport = {
    x: -pan.x / zoom,
    y: -pan.y / zoom,
    width: canvasSize.width / zoom,
    height: canvasSize.height / zoom,
  };
  const visibleNodes = nodes.filter(node =>
    rectsIntersect(
      getNodePlacementRect(node),
      viewport,
    )
  );

  const minX = viewport.x;
  const minY = viewport.y;
  const maxX = viewport.x + viewport.width;
  const maxY = viewport.y + viewport.height;
  const worldW = Math.max(1, maxX - minX);
  const worldH = Math.max(1, maxY - minY);
  const scale = Math.min(width / worldW, height / worldH);
  const offsetX = (width - worldW * scale) / 2;
  const offsetY = (height - worldH * scale) / 2;

  const mapRect = (rect) => ({
    x: offsetX + (rect.x - minX) * scale,
    y: offsetY + (rect.y - minY) * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  });

  const viewportRect = mapRect(viewport);

  return (
    <div className="canvas-minimap" aria-hidden="true">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
        <rect x="0" y="0" width={width} height={height} rx="12" fill="var(--panel-bg)" />
        {visibleNodes.map(node => {
          const def = getNodeDef(node.type);
          const rect = mapRect(getNodePlacementRect(node));
          return (
            <rect
              key={node.id}
              x={rect.x}
              y={rect.y}
              width={Math.max(5, rect.width)}
              height={Math.max(4, rect.height)}
              rx="2"
              fill={def?.color || "#3b82f6"}
              opacity={selected === node.id || selectedIds.includes(node.id) ? "1" : "0.78"}
            />
          );
        })}
        <rect
          x={viewportRect.x}
          y={viewportRect.y}
          width={viewportRect.width}
          height={viewportRect.height}
          rx="4"
          fill="rgba(56,189,248,0.08)"
          stroke="#38bdf8"
          strokeWidth="1.4"
        />
      </svg>
    </div>
  );
}
