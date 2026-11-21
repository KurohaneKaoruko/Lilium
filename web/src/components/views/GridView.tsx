import { useStore } from "../../store/useStore";
import { AssetMeta, assetInteractions, galleryColumns, LoadMoreSentinel, SelectionMark, Thumb, useGalleryViewport } from "./shared";

export default function GridView() {
  const items = useStore((s) => s.items);
  const zoom = useStore((s) => s.zoom);
  const selection = useStore((s) => s.selection);
  const { scrollRef, innerRef, width, height, top, measure } = useGalleryViewport();
  const { count, gap, cell } = galleryColumns(width, zoom);
  const preview = Math.round(cell * 0.8);
  const rowHeight = preview + 62 + gap;
  const rows = Math.ceil(items.length / count);
  const first = Math.max(0, Math.min(rows, Math.floor((top - 360) / rowHeight)));
  const last = Math.min(rows, Math.ceil((top + height + 360) / rowHeight));

  return <div ref={scrollRef} className="gallery-scroll" onScroll={measure}>
    <div className="gallery-inner" ref={innerRef} style={{ height: width > 0 ? rows * rowHeight : 0 }}>
      {width > 0 && items.slice(first * count, last * count).map((item, i) => {
        const index = first * count + i;
        const picked = selection.has(item.id);
        return <button type="button" className="asset-card grid-asset" aria-label={item.name} title={item.name} aria-pressed={picked} key={item.id}
          style={{ left: (index % count) * (cell + gap), top: Math.floor(index / count) * rowHeight, width: cell }} {...assetInteractions(item.id)}>
          <Thumb id={item.id} kind={item.kind} className="w-full" style={{ height: preview }} />
          <span className="asset-card-body"><strong className="truncate">{item.name}</strong><AssetMeta item={item} /></span>
          <SelectionMark selected={picked} />
        </button>;
      })}
    </div>
    <LoadMoreSentinel />
  </div>;
}
