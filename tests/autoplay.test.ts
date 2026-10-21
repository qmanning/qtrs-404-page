import { chooseMove, evaluatePlacements, measure, rotateMatrix, DEFAULT_TUNING, QtrsAutoplayer, COLS, ROWS, type Grid } from "../src/lib/autoplay";
import { TetrisGame, tetrominos } from "../src/lib/gameEngine";

const steady = { ...DEFAULT_TUNING, noise: 0, blunder: 0, secondThoughts: 0 };
const empty = (): Grid => Array.from({ length: ROWS }, () => new Array(COLS).fill(0));

describe("Q.T.R.S. autoplay", () => {
    it("drops a vertical I into a one-wide well to clear four lines", () => {
        const g = empty();
        for (let r = ROWS - 4; r < ROWS; r++) for (let c = 0; c < COLS - 1; c++) g[r][c] = 1;
        const choice = chooseMove(g, tetrominos.I, () => 0.5, steady)!;
        expect(choice.metrics.lines).toBe(4);
        expect(choice.rot % 2).toBe(1);
        // the vertical I occupies matrix column 2: the origin column puts it in column 9
        expect(choice.col + 2).toBe(COLS - 1);
        expect(choice.messy).toBe(false);
    });

    it("avoids holes when a clean spot exists", () => {
        const g = empty();
        for (let c = 0; c < COLS; c++) g[ROWS - 1][c] = c === 4 ? 0 : 1;
        const choice = chooseMove(g, tetrominos.O, () => 0.5, steady)!;
        expect(choice.holesAdded).toBe(0);
    });

    it("rotations match the engine and every candidate is in bounds", () => {
        const m = rotateMatrix(tetrominos.T);
        expect(m).toEqual([[0, 1, 0], [0, 1, 1], [0, 1, 0]]);
        const cands = evaluatePlacements(empty(), tetrominos.L);
        expect(cands.length).toBeGreaterThan(20);
        expect(measure(empty()).holes).toBe(0);
    });

    it("plays real pieces on the engine and clears lines", () => {
        let seed = 7;
        const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        const engine = new TetrisGame();
        const bot = new QtrsAutoplayer(engine, rng);
        let t = 0;
        for (let i = 0; i < 4000 && !engine.getGameState().gameOver; i++) {
            t += 16;
            engine.update(16);
            bot.tick(t);
        }
        const s = engine.getGameState();
        expect(s.lines).toBeGreaterThan(3);
    });
});
