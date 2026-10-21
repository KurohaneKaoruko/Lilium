import { useMemo, useState } from "react";
import { Folder as FolderIcon, Tag, Sparkles, Images, ChevronLeft, Plus } from "lucide-react";
import { useStore } from "../../store/useStore";
import { api, thumbUrl } from "../../api/client";

/**
 * 分类卡片墙（Collections）：参考悬浮卡片式分类界面。
 *
 * - 文件夹 / 标签 / 智能文件夹渲染为分离的悬浮卡片
 * - 卡片带封面图、名称、数量角标，鼠标悬停上浮增亮
 * - 深色空间中错落散布（确定性伪随机，每次进入一致）
 * - 点击卡片 → 过滤到该分类（文件夹/标签即切到瀑布流浏览）
 * - 顶部分段切换：文件夹 / 标签
 */
export default function CollectionsView() {
  const folders = useStore((s) => s.folders);
  const tags = useStore((s) => s.tags);
  const smartFolders = useStore((s) => s.smartFolders);
  const setFilters = useStore((s) => s.setFilters);
  const fetchItems = useStore((s) => s.fetchItems);
  const refreshMeta = useStore((s) => s.refreshMeta);

  const [tab, setTab] = useState<"folders" | "tags">("folders");

  const newFolder = async () => {
    const name = prompt("文件夹名称：");
    if (!name?.trim()) return;
    await api("/folders", { method: "POST", body: JSON.stringify({ parentId: null, name: name.trim() }) });
    refreshMeta();
  };

  // 根文件夹列表（侧栏树保留层级；这里平铺展示所有含内容的）
  const cards = useMemo(() => {
    if (tab === "folders") {
      return folders.map((f) => ({
        key: `f-${f.id}`,
        id: f.id,
        kind: "folder" as const,
        title: f.name,
        sub: `${f.itemCount} 张`,
        cover: f.coverItemId,
        count: f.itemCount,
      }));
    }
    return tags.map((t) => ({
      key: `t-${t.name}`,
      id: t.name,
      kind: "tag" as const,
      title: t.name,
      sub: `${t.count} 张`,
      cover: null,
      count: t.count,
      color: t.color,
    }));
  }, [tab, folders, tags]);

  /** 打开分类 → 设过滤、切瀑布流并进入浏览 */
  const openCard = (c: (typeof cards)[number]) => {
    if (c.kind === "folder") {
      setFilters({ folderId: c.id, recursive: true, tag: null, trash: false });
    } else {
      setFilters({ tag: c.id, folderId: null, trash: false });
    }
    useStore.setState({ view: "masonry" });
    fetchItems();
  };

  /** 卡片散布：确定性伪随机（基于 key 哈希），带 3D 透视 */
  const scatter = (key: string, i: number) => {
    let h = 2166136261;
    for (const ch of key) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    const rx = ((h >>> 8) % 1000) / 1000 - 0.5; // -0.5..0.5
    const ry = ((h >>> 16) % 1000) / 1000 - 0.5;
    const rot = (((h >>> 24) % 100) / 100 - 0.5) * 3.2; // ±1.6deg
    const depth = 0.86 + ((h >>> 4) % 100) / 100 * 0.28; // 0.86..1.14 缩放
    const col = i % 4;
    const row = Math.floor(i / 4);
    // 内容区安全范围:列中心 17%..83%,行起点避开顶部标题栏
    const x = (col - 1.5) * 22 + rx * 8; // 百分比
    const y = row * 36 + ry * 8;
    return {
      left: `${50 + x}%`,
      top: `${26 + y}%`,
      transform: `translate(-50%,-50%) rotate(${rot}deg) scale(${depth})`,
      zIndex: 10 + ((h >>> 12) % 50),
    };
  };

  return (
    <div className="flex-1 overflow-auto relative bg-[#0c0d11]">
      {/* 背景光晕 */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(1200px 500px at 30% -10%, rgba(139,92,246,.13), transparent 60%), radial-gradient(900px 500px at 85% 110%, rgba(56,189,248,.08), transparent 60%)",
        }}
      />

      <div className="relative z-10 px-6 pt-5">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-neutral-100">分类</h1>
          <div className="flex bg-panel2 border border-border rounded-full p-0.5 text-xs">
            {(
              [
                ["folders", `文件夹 (${folders.length})`],
                ["tags", `标签 (${tags.length})`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                className={`px-3 py-1 rounded-full transition-colors ${
                  tab === k ? "bg-violet-500/25 text-violet-200" : "text-neutral-400 hover:text-neutral-200"
                }`}
                onClick={() => setTab(k)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "folders" && (
            <button className="btn text-xs" title="新建文件夹" onClick={newFolder}>
              <Plus size={13} /> 新建
            </button>
          )}
        </div>
      </div>

      {/* 卡片散布区 */}
      {cards.length === 0 ? (
        <div className="relative z-10 h-[60vh] flex flex-col items-center justify-center text-neutral-500 gap-2">
          {tab === "folders" ? <FolderIcon size={34} /> : <Tag size={34} />}
          <div className="text-sm">{tab === "folders" ? "还没有文件夹" : "还没有标签"}</div>
        </div>
      ) : (
        <div
          className="relative z-10"
          style={{ perspective: 1400, height: `${Math.ceil(cards.length / 4) * 36 + 34}vh` }}
        >
          {cards.map((c, i) => {
            const style = scatter(c.key, i);
            return (
              <button
                key={c.key}
                className="absolute w-[240px] text-left group"
                style={style}
                onClick={() => openCard(c)}
              >
                <div
                  className="rounded-2xl overflow-hidden border border-white/10 bg-panel/95 backdrop-blur
                             shadow-[0_20px_50px_rgba(0,0,0,.5)] transition-all duration-300
                             group-hover:-translate-y-2 group-hover:shadow-[0_30px_70px_rgba(0,0,0,.65)]
                             group-hover:border-violet-400/40"
                  style={{ transform: "translateZ(0)" }}
                >
                  <div className="h-[132px] relative overflow-hidden bg-[#181a20]">
                    {c.cover ? (
                      <img
                        src={thumbUrl(c.cover)}
                        alt=""
                        loading="lazy"
                        className="w-full h-full object-cover opacity-85 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500"
                      />
                    ) : (
                      <div
                        className="w-full h-full flex items-center justify-center"
                        style={{
                          background:
                            "kind" in c && c.kind === "tag"
                              ? `linear-gradient(135deg, ${(c as { color?: string }).color}44, #1a1c22)`
                              : "linear-gradient(135deg, #232630, #1a1c22)",
                        }}
                      >
                        {c.kind === "folder" ? (
                          <FolderIcon size={30} className="text-neutral-600" />
                        ) : c.kind === "tag" ? (
                          <Tag size={28} style={{ color: (c as { color?: string }).color ?? "#8b5cf6" }} />
                        ) : (
                          <Sparkles size={28} className="text-neutral-600" />
                        )}
                      </div>
                    )}
                    {/* 数量角标 */}
                    <div className="absolute left-2 top-2 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur text-[10px] text-neutral-200 border border-white/10">
                      {c.count}
                    </div>
                    {/* 悬停"打开"提示 */}
                    <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="w-7 h-7 rounded-full bg-violet-500/90 flex items-center justify-center">
                        <Images size={13} className="text-white" />
                      </div>
                    </div>
                  </div>
                  <div className="px-3 py-2.5">
                    <div className="text-[13px] text-neutral-100 font-medium truncate flex items-center gap-1.5">
                      {c.kind === "folder" && <FolderIcon size={12} className="text-neutral-500 shrink-0" />}
                      {c.kind === "tag" && (
                        <Tag size={12} style={{ color: (c as { color?: string }).color }} className="shrink-0" />
                      )}
                      <span className="truncate">{c.title}</span>
                    </div>
                    <div className="text-[11px] text-neutral-500 mt-0.5">{c.sub}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* 底部提示 */}
      <div className="sticky bottom-0 left-0 right-0 h-10 flex items-center justify-center pointer-events-none">
        <div className="bg-black/45 backdrop-blur border border-white/10 rounded-full px-3 py-1 text-[11px] text-neutral-400 flex items-center gap-1.5">
          <ChevronLeft size={11} />
          点击卡片进入分类浏览
        </div>
      </div>
    </div>
  );
}
