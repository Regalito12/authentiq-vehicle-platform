import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";

// Mantiene las listas pequeñas simples y solo reduce el DOM cuando realmente
// hay volumen. El contenido sigue siendo propiedad del módulo que lo renderiza.
export default function VirtualizedList({ items = [], renderItem, getKey = (item, index) => item?.id ?? index, estimateSize = 120, className = "" }) {
  const shouldVirtualize = items.length > 100;
  const viewportRef = useRef(null);
  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? items.length : 0,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => estimateSize,
    overscan: 6,
    getItemKey: (index) => getKey(items[index], index),
  });

  if (!shouldVirtualize) return <div className={className}>{items.map((item, index) => renderItem(item, index))}</div>;
  return <div ref={viewportRef} className={`${className} is-virtualized`.trim()} style={{ maxHeight: "min(72vh, 760px)", overflowY: "auto" }}>
    <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
      {virtualizer.getVirtualItems().map((virtualItem) => <div key={virtualItem.key} data-index={virtualItem.index} ref={virtualizer.measureElement} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualItem.start}px)` }}>{renderItem(items[virtualItem.index], virtualItem.index)}</div>)}
    </div>
  </div>;
}
