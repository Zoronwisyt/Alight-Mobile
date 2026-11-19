import React from 'react';
import {
  Activity,
  Bookmark,
  Camera,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileCode2,
  Film,
  Folder,
  Grid,
  HelpCircle,
  Home,
  Image as ImageIcon,
  Layers,
  Link,
  Lock,
  Magnet,
  Menu,
  MoreVertical,
  Music,
  Pause,
  Pencil,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Scissors,
  Search,
  Settings,
  Shapes,
  Sliders,
  Sparkles,
  Square,
  Trash2,
  Type,
  Undo2,
  Unlock,
  Upload,
  X,
} from 'lucide-react';
import iconsData from '../../generated/icons.json';

interface VectorPathData {
  d: string;
  fill?: string;
  stroke?: string;
  sw?: number;
  fa?: number;
  sa?: number;
  fr?: 'evenodd' | 'nonzero';
  lc?: 'butt' | 'round' | 'square';
  lj?: 'miter' | 'round' | 'bevel';
  g?: {
    tx: number;
    ty: number;
    sx: number;
    sy: number;
    rot: number;
    px: number;
    py: number;
  };
}

interface VectorIconEntry {
  vb: number[];
  paths: VectorPathData[];
}

const ICONS = iconsData as unknown as Record<string, VectorIconEntry>;

const FALLBACK_LUCIDE: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  home: Home,
  projects: Folder,
  tutorials: HelpCircle,
  elements: Layers,
  plus: Plus,
  menu: Menu,
  search: Search,
  settings: Settings,
  back: ChevronLeft,
  next: ChevronRight,
  undo: Undo2,
  redo: Redo2,
  export: Upload,
  download: Download,
  play: Play,
  pause: Pause,
  grid: Grid,
  snap: Magnet,
  camera: Camera,
  bookmark: Bookmark,
  split: Scissors,
  delete: Trash2,
  copy: Copy,
  eye: Eye,
  eyeOff: EyeOff,
  lock: Lock,
  unlock: Unlock,
  link: Link,
  shape: Shapes,
  text: Type,
  image: ImageIcon,
  video: Film,
  audio: Music,
  draw: Pencil,
  effects: Sparkles,
  curve: Activity,
  sliders: Sliders,
  xml: FileCode2,
  close: X,
  more: MoreVertical,
  reset: RotateCcw,
  rotate: RotateCw,
  box: Square,
};

export interface AmIconProps {
  /** Exact APK drawable name (e.g. 'ic_edit_undo') or semantic fallback key */
  name: string;
  fallback?: keyof typeof FALLBACK_LUCIDE;
  size?: number;
  className?: string;
  color?: string;
}

export const AmIcon: React.FC<AmIconProps> = ({
  name,
  fallback,
  size = 20,
  className,
  color = 'currentColor',
}) => {
  const entry = ICONS[name];
  if (entry) {
    const [vw, vh] = entry.vb;
    return (
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${vw} ${vh}`}
        fill="none"
        className={className}
        style={{ color, flexShrink: 0 }}
        aria-hidden="true"
      >
        {entry.paths.map((p, idx) => {
          const tf = p.g
            ? `translate(${p.g.tx}, ${p.g.ty}) translate(${p.g.px}, ${p.g.py}) rotate(${p.g.rot}) scale(${p.g.sx}, ${p.g.sy}) translate(${-p.g.px}, ${-p.g.py})`
            : undefined;
          return (
            <path
              key={idx}
              d={p.d}
              transform={tf}
              fill={p.fill ? (p.fill === 'currentColor' ? 'currentColor' : p.fill) : p.stroke ? 'none' : 'currentColor'}
              stroke={p.stroke ? (p.stroke === 'currentColor' ? 'currentColor' : p.stroke) : undefined}
              strokeWidth={p.sw}
              fillOpacity={p.fa}
              strokeOpacity={p.sa}
              fillRule={p.fr}
              strokeLinecap={p.lc}
              strokeLinejoin={p.lj}
            />
          );
        })}
      </svg>
    );
  }

  const Fallback = (fallback && FALLBACK_LUCIDE[fallback]) || FALLBACK_LUCIDE[name] || Square;
  return <Fallback size={size} strokeWidth={2} />;
};
