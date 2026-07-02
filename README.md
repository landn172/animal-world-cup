# 2D Phaser + Next.js Game Template

A modern full-stack 2D game development template designed for Advanced Agentic Coding (AI development).

This template bridges the gap between **web-native component ecosystems** and **H5 game engines**, using `React` (DOM layer) to render high-fidelity modern UI/HUD while delegating core gameplay logic to `Phaser 3`. State synchronization and decoupling are handled via `Zustand`.

---

## 🚀 Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Engine**: Phaser 3.90+
- **Styling**: Tailwind CSS v4 (zero-config integration)
- **State Management**: Zustand 5
- **Typography**: Inter / Outfit / JetBrains Mono (Google Fonts)

---

## 📂 Architecture

This project uses a **fully flat, strictly separated** directory structure:

```text
src/
├── app/            # Next.js core routing layer (layout.tsx, page.tsx, globals.css)
├── components/     # React wrapper components (GameWrapper bridges Phaser and React)
├── ui/             # High-fidelity HUD & frontend UI (GameCanvas.tsx, HUD.tsx)
├── store/          # Zustand state hub (useGameStore) — sole bridge between DOM and Canvas
├── game/           # [Pure Game Logic Zone]
│   ├── boot.ts     # Phaser game entry point & configuration
│   └── config.ts   # Core parameters (gravity, debug mode, etc.)
│                   # Add scenes/ and entities/ subfolders as the game grows
└── kit/            # Core game toolkit (BaseScene, AssetsManager, AudioManager, input, textures)
```

### 💡 Core Design Principles

1. **DOM Over Canvas**:
   Build complex layout content (scoreboards, tooltips, inventory, dialogs) with Tailwind in `src/ui/`, not `Phaser.Text`.
2. **Single Source of Truth**:
   Phaser must not directly manipulate the DOM. Call `useGameStore.getState().xxx()` from Phaser, and React re-renders the HUD automatically.
3. **Responsive Canvas**:
   The game wrapper renders fullscreen (`100vw / 100vh`). No hard-coded fixed dimensions.

---

## 🎮 Quick Start

1. **Install** (pnpm is recommended; a `pnpm-lock.yaml` is shipped):
   ```bash
   pnpm install
   ```

2. **Start the dev server** (bound to port 13000 for container compatibility):
   ```bash
   pnpm dev
   ```
   Open `http://localhost:13000`.

3. **Other scripts**:
   - `pnpm build` — production build
   - `pnpm start` — run production build on port 13000
   - `pnpm lint` — Next.js / ESLint check

---

## 🛠 Development Best Practices (For AI Agents)

- **Phaser loop logic** belongs in `game/` scenes, not in React components — never run `requestAnimationFrame` polling from React.
- **No inline styles for business logic**: use Tailwind utility classes (e.g. `absolute top-0 right-10`).
- **State flows through Zustand only**: Phaser → `useGameStore` → React. Do not cross-call between layers directly.

---

Developed with ❤️ for Advanced Agentic Coding.
