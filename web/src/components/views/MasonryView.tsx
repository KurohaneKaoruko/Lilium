import { useMemo } from "react";
import { useStore } from "../../store/useStore";
import { itemAspectRatio } from "../../api/client";
import { AssetMeta, assetInteractions, LoadMoreSentinel, SelectionMark, Thumb, useGalleryViewport, useMasonryTiles } from "./shared";

export default function MasonryView() {
  const items = useStore((s) => s.items);
  const zoom = useStore((s) => s.zoom);
  const selection = useStore((s) => s.selection);
  const { scrollRef, innerRef, width, height, top, measure } = useGalleryViewport();
  const aspects = useMemo(() => items.map((item) => ({ id: item.id, aspect: itemAspectRatio(item) })), [items]);
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const { tiles, height: contentHeight } = useMasonryTiles(aspects, width, zoom);

  return <div ref={scrollRef} className="gallery-scroll" onScroll={measure}>
    <div className="gallery-inner" ref={innerRef} style={{ height: contentHeight }}>
      {tiles.filter((tile) => tile.y + tile.h >= top - 400 && tile.y <= top + height + 400).map(({ id, x, y, w, h }) => {
        const item = byId.get(id)!;
        const picked = selection.has(id);
        return <button key={id} className="asset-card masonry-asset" type="button" aria-label={item.name} aria-pressed={picked} title={item.name}
          style={{ left: x, top: y, width: w, height: h }} {...assetInteractions(id)}>
          <Thumb id={id} kind={item.kind} className="w-full h-full" />
          <span className="asset-caption"><strong className="truncate">{item.name}</strong><AssetMeta item={item} /></span>
          <SelectionMark selected={picked} />
        </button>;
      })}
    </div>
    <LoadMoreSentinel />
  </div>;
}
