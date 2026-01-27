"use client";

import { useMemo } from "react";

const FOOD_EMOJIS = [
  "🍜", "🍣", "🍕", "🥗", "🌮", "🍔", "🍩", "🍦",
  "🍟", "🥟", "🍛", "🍰", "🫖", "☕️", "🥐"
];

interface EmojiItem {
  emoji: string;
  top: number;
  left: number;
  fontSize: number;
  rotation: number;
  opacity: number;
  animationDuration: number;
  animationDelay: number;
}

// Seeded random number generator for deterministic positioning
function seededRandom(seed: number): () => number {
  return function () {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

interface GridConfig {
  cols: number;
  rows: number;
  targetCount: number;
  jitterX: number; // Max jitter as percentage of cell width
  jitterY: number; // Max jitter as percentage of cell height
}

function generateGridEmojis(config: GridConfig, seed: number): EmojiItem[] {
  const random = seededRandom(seed);
  const emojis: EmojiItem[] = [];
  
  const { cols, rows, targetCount, jitterX, jitterY } = config;
  const totalCells = cols * rows;
  
  // Create array of all cell indices and shuffle them
  const cellIndices: number[] = [];
  for (let i = 0; i < totalCells; i++) {
    cellIndices.push(i);
  }
  
  // Fisher-Yates shuffle with seeded random
  for (let i = cellIndices.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cellIndices[i], cellIndices[j]] = [cellIndices[j], cellIndices[i]];
  }
  
  // Take only the number of cells we need
  const selectedCells = cellIndices.slice(0, Math.min(targetCount, totalCells));
  
  // Cell dimensions as percentages
  const cellWidth = 100 / cols;
  const cellHeight = 100 / rows;
  
  for (const cellIndex of selectedCells) {
    const col = cellIndex % cols;
    const row = Math.floor(cellIndex / cols);
    
    // Center of the cell
    const centerX = (col + 0.5) * cellWidth;
    const centerY = (row + 0.5) * cellHeight;
    
    // Add random jitter within bounds
    const offsetX = (random() - 0.5) * 2 * jitterX * cellWidth;
    const offsetY = (random() - 0.5) * 2 * jitterY * cellHeight;
    
    emojis.push({
      emoji: FOOD_EMOJIS[Math.floor(random() * FOOD_EMOJIS.length)],
      top: Math.max(2, Math.min(98, centerY + offsetY)),
      left: Math.max(2, Math.min(98, centerX + offsetX)),
      fontSize: 18 + random() * 24, // 18-42px
      rotation: -30 + random() * 60, // -30 to 30 degrees
      opacity: 0.14 + random() * 0.08, // 0.14-0.22
      animationDuration: 10 + random() * 12, // 10-22 seconds (faster)
      animationDelay: random() * -15, // Staggered start
    });
  }

  return emojis;
}

// Desktop: 6 columns x 5 rows = 30 cells, target ~28 emojis
const DESKTOP_CONFIG: GridConfig = {
  cols: 6,
  rows: 5,
  targetCount: 28,
  jitterX: 0.35,
  jitterY: 0.35,
};

// Mobile: 4 columns x 4 rows = 16 cells, target ~12 emojis
const MOBILE_CONFIG: GridConfig = {
  cols: 4,
  rows: 4,
  targetCount: 12,
  jitterX: 0.3,
  jitterY: 0.3,
};

export function EmojiBackground() {
  // Generate emojis once, deterministically using grid placement
  const desktopEmojis = useMemo(() => generateGridEmojis(DESKTOP_CONFIG, 42), []);
  const mobileEmojis = useMemo(() => generateGridEmojis(MOBILE_CONFIG, 42), []);

  return (
    <>
      {/* CSS Keyframes for floating animation */}
      <style jsx global>{`
        @keyframes emoji-float {
          0%, 100% {
            transform: translateY(0px) rotate(var(--rotation));
          }
          50% {
            transform: translateY(-10px) rotate(calc(var(--rotation) + 4deg));
          }
        }
      `}</style>

      {/* Fixed background container - z-0 with gradient, content should use z-10+ */}
      <div
        className="fixed inset-0 w-screen h-screen overflow-hidden pointer-events-none select-none bg-gradient-to-b from-background via-background to-emerald-50/30"
        style={{ zIndex: 0 }}
        aria-hidden="true"
      >
        {/* Desktop emojis (hidden on small screens) */}
        <div className="hidden md:block w-full h-full">
          {desktopEmojis.map((item, index) => (
            <span
              key={`desktop-${index}`}
              className="absolute"
              style={{
                top: `${item.top}%`,
                left: `${item.left}%`,
                fontSize: `${item.fontSize}px`,
                opacity: item.opacity,
                "--rotation": `${item.rotation}deg`,
                animation: `emoji-float ${item.animationDuration}s ease-in-out infinite`,
                animationDelay: `${item.animationDelay}s`,
              } as React.CSSProperties}
            >
              {item.emoji}
            </span>
          ))}
        </div>

        {/* Mobile emojis (shown only on small screens) */}
        <div className="block md:hidden w-full h-full">
          {mobileEmojis.map((item, index) => (
            <span
              key={`mobile-${index}`}
              className="absolute"
              style={{
                top: `${item.top}%`,
                left: `${item.left}%`,
                fontSize: `${item.fontSize}px`,
                opacity: item.opacity,
                "--rotation": `${item.rotation}deg`,
                animation: `emoji-float ${item.animationDuration}s ease-in-out infinite`,
                animationDelay: `${item.animationDelay}s`,
              } as React.CSSProperties}
            >
              {item.emoji}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}
