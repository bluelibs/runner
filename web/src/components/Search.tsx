import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search as SearchIcon } from "lucide-react";
import { allDocSections } from "../data/documentation";

interface Item {
  id: string;
  title: string;
  section: string;
  href: string;
}

const buildIndex = (): Item[] => {
  const items: Item[] = [];
  for (const section of allDocSections) {
    for (const it of section.items) {
      items.push({
        id: it.id,
        title: it.title,
        section: section.title,
        href: `/docs#${it.id}`,
      });
    }
  }
  return items;
};

const index = buildIndex();

const Search: React.FC = () => {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [] as Item[];
    return index
      .map((it) => ({
        item: it,
        score:
          (it.title.toLowerCase().includes(query) ? 2 : 0) +
          (it.section.toLowerCase().includes(query) ? 1 : 0) +
          (it.id.toLowerCase().includes(query) ? 1 : 0),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((x) => x.item);
  }, [q]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <div className="flex items-center bg-white/10 text-white rounded-lg px-3 py-2 focus-within:ring-1 focus-within:ring-white/30">
        <SearchIcon className="w-4 h-4 text-gray-200 mr-2" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search docs…"
          className="bg-transparent outline-none placeholder:text-gray-400 text-sm w-48"
          aria-label="Search documentation"
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute mt-2 w-[20rem] right-0 bg-black/90 backdrop-blur-md border border-gray-700 rounded-lg shadow-xl z-50">
          <ul className="max-h-80 overflow-auto py-2">
            {results.map((r) => (
              <li key={r.href}>
                <button
                  onClick={() => {
                    setOpen(false);
                    setQ("");
                    navigate(r.href);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-white/10"
                >
                  <div className="text-sm text-white">{r.title}</div>
                  <div className="text-xs text-gray-400">{r.section}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default Search;

