/** Draws the wires between measured DOM nodes, behind the cards. Hidden on narrow screens. */
import { useLayoutEffect, useState, type RefObject } from 'react';
import type { Wire } from '../rules/graph';

interface Props {
  wires: Wire[];
  nodes: RefObject<Map<string, HTMLElement>>;
  board: RefObject<HTMLElement>;
  hot: Set<string> | null;
  tick: unknown; // anything that changes the layout
}

interface Path {
  d: string;
  lit: boolean;
  hot: boolean;
  key: string;
}

export function Wires({ wires, nodes, board, hot, tick }: Props) {
  const [paths, setPaths] = useState<Path[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    let ro: ResizeObserver | null = null;
    // the board's ref and the cards' refs attach after this effect runs, so measure on the next frame
    const measure = () => {
      const el = board.current;
      if (!el) return;
      const b = el.getBoundingClientRect();
      const map = nodes.current!;
      const next: Path[] = [];
      for (const w of wires) {
        if (w.from.startsWith('dec:')) continue; // decision to decision stays in the logic, not on the board
        const a = map.get(w.from);
        const z = map.get(w.to);
        if (!a || !z || !a.offsetParent || !z.offsetParent) continue;
        const ra = a.getBoundingClientRect();
        const rz = z.getBoundingClientRect();
        const x1 = ra.right - b.left;
        const y1 = ra.top + ra.height / 2 - b.top;
        const x2 = rz.left - b.left;
        const y2 = (w.to.startsWith('dec:') ? rz.top + 24 : rz.top + rz.height / 2) - b.top;
        if (x2 <= x1) continue;
        const k = (x2 - x1) / 2;
        next.push({
          key: `${w.from}>${w.to}`,
          d: `M${x1.toFixed(1)} ${y1.toFixed(1)} C${(x1 + k).toFixed(1)} ${y1.toFixed(1)}, ${(x2 - k).toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`,
          lit: w.lit,
          hot: !!hot && hot.has(w.from) && hot.has(w.to),
        });
      }
      setSize((s) => (s.w === b.width && s.h === b.height ? s : { w: b.width, h: b.height }));
      setPaths((p) => (JSON.stringify(p) === JSON.stringify(next) ? p : next));
    };
    const frame = requestAnimationFrame(() => {
      measure();
      if (!board.current) return;
      ro = new ResizeObserver(measure);
      ro.observe(board.current);
      document.fonts?.ready.then(measure);
    });
    return () => {
      cancelAnimationFrame(frame);
      ro?.disconnect();
    };
  }, [wires, nodes, board, hot, tick]);

  const dimOthers = !!hot;
  return (
    <svg className="wires" width={size.w} height={size.h} aria-hidden>
      {paths.filter((p) => !p.lit).map((p) => <path key={p.key} d={p.d} className={`wire${p.hot ? ' hot' : ''}${dimOthers && !p.hot ? ' faded' : ''}`} />)}
      {paths.filter((p) => p.lit).map((p) => <path key={p.key} d={p.d} className={`wire lit${p.hot ? ' hot' : ''}${dimOthers && !p.hot ? ' faded' : ''}`} />)}
    </svg>
  );
}
