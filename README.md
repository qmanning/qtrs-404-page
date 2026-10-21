# Q.T.R.S. 404 Page

*Queue, Turn, Rotate, Slam.*

A 404 page you don't mind landing on — a playable Tetris on a canvas, with a leaderboard.

**Live demo:** https://qmanning.com/labs/qtrs-404-page

## What it does

Someone hits a dead link and, instead of a shrug, gets a **game**. The page shows the error ("This page fell through the cracks!"), score / lines / level, and a Tetris board that starts on its own. Keyboard on desktop (arrows, space to drop), **swipe** on phones, and on-screen buttons for both. When the game ends it offers a restart — and, if you wire the leaderboard, lets a good score be submitted with a name.

## How it works

- `gameEngine.ts` is the whole game: board, tetrominoes, rotation with wall kicks, line clears, scoring and level speed. It has no React in it.
- `TetrisGame.tsx` owns a `<canvas>` and a `requestAnimationFrame` loop, draws the engine's state, and maps keyboard, swipe (`swipeDetection.ts`) and button input to engine moves.
- `TetrisErrorPage.tsx` is the page: message, stats, the game, the retry/home buttons, and the optional leaderboard + score modal (Supabase-backed in this site — swap the two fetch calls for your own store, or set `enableLeaderboard={false}`).
- `errorMessages.ts` holds the copy per status code.

## Settings

The gear in the top corner of the demo (14px, `Settings` icon) opens a menu of this lab's controls; every change updates the demo live. Save keeps your values in the browser, Reset restores the defaults, and a universal "Hide controls" switch hides every lab's gear at once (a small "show controls" link brings it back). The 404 page keeps its own defaults; the gear is on the Labs tile.

| Control | Type | Default | Range or options |
|---|---|---|---|
| Block size | range | 16px | 12px to 24px |
| Starting level | range | 1 | 1 to 10 |
| Ghost piece | toggle | on | on/off |
| Ghost opacity | range | 0.18 | 0.05 to 0.6 |
| Score row | toggle | off | on/off |
| Celebrations | toggle | on | on/off |

Going live: pass `showControls={false}` to hide the gear in production, or keep it and let visitors dial it in.

## Install

1. Download the files (this repo) and drop them in: `TetrisErrorPage.tsx`, `TetrisGame.tsx`, `ScoreSubmissionModal.tsx`, `TetrisLeaderboard.tsx` into your components, `gameEngine.ts`, `swipeDetection.ts`, `errorMessages.ts` into a `lib/tetris` folder. Fix the `@/…` import paths to match.
2. `npm i lucide-react framer-motion` (icons and the page's entrance animation).
3. Use it as your Next.js `not-found.tsx`:

```tsx
import TetrisErrorPage from "@/components/tetris/TetrisErrorPage";
import { getTetrisErrorMessage } from "@/lib/tetris/errorMessages";

export default function NotFound() {
    const m = getTetrisErrorMessage("404");
    return <TetrisErrorPage title={m.title} subtitle={m.subtitle} description={m.description} instruction={m.instruction} />;
}
```

## Use the game on its own

```tsx
import TetrisGame from "@/components/tetris/TetrisGame";

<TetrisGame width={320} height={640} enableLeaderboard={false} onGameOver={(score) => console.log(score)} />
```

Props: `width`, `height`, `autoScale` (fit small screens), `enableLeaderboard`, `minScoreForSubmission`, and callbacks `onGameStart`, `onScoreUpdate`, `onGameOver`, `onAchievement`, `onScoreSubmitted`, `onGameRestart`.

## Credits

Built on [Basic Tetris HTML and JavaScript Game](https://gist.github.com/straker/3c98304f8a6a9e20f2f8e1e1b86b0bc4) by Steven Lambert (MIT). It was ported to TypeScript and extended here with levels, line-clear animation, swipe controls and the leaderboard. If you build on this, please carry the credit forward the same way.

## License

MIT.

---

Made by [Q Manning](https://qmanning.com) · [Source on GitHub](https://github.com/qmanning/qtrs-404-page) · [See it live in the Labs](https://qmanning.com/labs/qtrs-404-page)
