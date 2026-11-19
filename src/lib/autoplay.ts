/**
 * Q.T.R.S. attract mode: a believable, imperfect player that drives the real TetrisGame engine through its
 * public methods (rotate, moveLeft, moveRight, softDrop, hardDrop). It runs locally; no network, no AI calls.
 *
 *  - chooseMove(): the placement brain. Every rotation x column is scored with the classic heuristic
 *    (aggregate height, holes, bumpiness, lines cleared), then perturbed with noise, an occasional
 *    "second thoughts" pick from the top few, and a rare blunder, so he is decent but beatable and sometimes messy.
 *  - QtrsAutoplayer: the hands. Short thinking pauses (150 to 450 ms), stepwise rotates and moves at about
 *    8 to 12 a second, the odd wrong step that gets corrected, then a hard or soft drop.
 */
import type { TetrisGame } from "./gameEngine";

export const COLS = 10;
export const ROWS = 20;

/** the classic weights (Yiyuan Lee's well-known set) */
export const WEIGHTS = { height: -0.510066, lines: 0.760666, holes: -0.35663, bump: -0.184483 };

export interface AutoplayTuning {
    /** std-dev of the noise added to each candidate's score (bigger = sloppier) */
    noise: number;
    /** chance he picks one of his top few instead of his best ("second thoughts") */
    secondThoughts: number;
    /** chance of an outright poor choice (any legal placement) */
    blunder: number;
    /** thinking pause before a piece's first move, ms */
    thinkMs: [number, number];
    /** a rare long hesitation, chance and ms */
    hesitate: { chance: number; ms: [number, number] };
    /** moves and rotates per second */
    stepsPerSec: [number, number];
    /** chance a step goes the wrong way first (then he corrects) */
    fumble: number;
    /** chance the final drop is a hard drop (else he soft drops down) */
    hardDropChance: number;
    /** soft drop speed, rows per second */
    softRowsPerSec: number;
}

export const DEFAULT_TUNING: AutoplayTuning = {
    noise: 0.3,
    secondThoughts: 0.06,
    blunder: 0.02,
    thinkMs: [150, 450],
    hesitate: { chance: 0.07, ms: [600, 1000] },
    stepsPerSec: [8, 12],
    fumble: 0.06,
    hardDropChance: 0.62,
    softRowsPerSec: 28,
};

export type Grid = number[][]; // ROWS x COLS, 0 empty

/** the engine's own clockwise rotation (kept identical so rotation counts line up) */
export function rotateMatrix(matrix: number[][]): number[][] {
    const N = matrix.length - 1;
    return matrix.map((row, i) => row.map((_v, j) => matrix[N - j][i]));
}

export function gridFromPlayfield(playfield: (string | number)[][]): Grid {
    const g: Grid = [];
    for (let r = 0; r < ROWS; r++) {
        const row: number[] = [];
        for (let c = 0; c < COLS; c++) row.push(playfield[r] && playfield[r][c] ? 1 : 0);
        g.push(row);
    }
    return g;
}

function fits(grid: Grid, m: number[][], y: number, x: number): boolean {
    for (let i = 0; i < m.length; i++) {
        for (let j = 0; j < m[i].length; j++) {
            if (!m[i][j]) continue;
            const r = y + i;
            const c = x + j;
            if (c < 0 || c >= COLS || r >= ROWS) return false;
            if (r >= 0 && grid[r][c]) return false;
        }
    }
    return true;
}

export interface Metrics {
    height: number;
    holes: number;
    bump: number;
    lines: number;
    maxHeight: number;
}

export function measure(grid: Grid, lines = 0): Metrics {
    const heights: number[] = [];
    let holes = 0;
    for (let c = 0; c < COLS; c++) {
        let h = 0;
        let seen = false;
        for (let r = 0; r < ROWS; r++) {
            if (grid[r][c]) {
                if (!seen) {
                    seen = true;
                    h = ROWS - r;
                }
            } else if (seen) holes++;
        }
        heights.push(h);
    }
    let bump = 0;
    for (let c = 0; c < COLS - 1; c++) bump += Math.abs(heights[c] - heights[c + 1]);
    return { height: heights.reduce((a, b) => a + b, 0), holes, bump, lines, maxHeight: Math.max(...heights) };
}

export function scoreMetrics(m: Metrics): number {
    return WEIGHTS.height * m.height + WEIGHTS.lines * m.lines + WEIGHTS.holes * m.holes + WEIGHTS.bump * m.bump;
}

export interface Candidate {
    /** clockwise rotations from the piece's current matrix */
    rot: number;
    /** the matrix origin column the piece should end up at (engine piece.col) */
    col: number;
    /** where it lands (matrix origin row) */
    row: number;
    score: number;
    metrics: Metrics;
    /** it would reach the top: a lost cause */
    topsOut: boolean;
}

/** every distinct rotation x column, dropped from above and scored */
export function evaluatePlacements(grid: Grid, matrix: number[][], maxRot = 3): Candidate[] {
    const out: Candidate[] = [];
    const seen = new Set<string>();
    let m = matrix.map((r) => [...r]);
    for (let rot = 0; rot <= maxRot; rot++) {
        const key = JSON.stringify(m);
        if (!seen.has(key)) {
            seen.add(key);
            for (let x = -3; x < COLS; x++) {
                if (!fits(grid, m, -4, x)) continue;
                let y = -4;
                while (fits(grid, m, y + 1, x)) y++;
                const g = grid.map((r) => [...r]);
                let topsOut = false;
                for (let i = 0; i < m.length; i++)
                    for (let j = 0; j < m[i].length; j++) {
                        if (!m[i][j]) continue;
                        if (y + i < 0) topsOut = true;
                        else g[y + i][x + j] = 1;
                    }
                let lines = 0;
                for (let r = ROWS - 1; r >= 0; ) {
                    if (g[r].every((v) => v)) {
                        g.splice(r, 1);
                        g.unshift(new Array(COLS).fill(0));
                        lines++;
                    } else r--;
                }
                const metrics = measure(g, lines);
                out.push({ rot, col: x, row: y, score: scoreMetrics(metrics) - (topsOut ? 100 : 0), metrics, topsOut });
            }
        }
        m = rotateMatrix(m);
    }
    return out;
}

export interface Choice extends Candidate {
    /** he did not take his best placement, or it leaves a hole: expect a grimace */
    messy: boolean;
    /** how many holes it adds to the board */
    holesAdded: number;
}

function gauss(rng: () => number): number {
    return (rng() + rng() + rng() + rng() - 2) * 1.7; // close enough to N(0, ~1)
}

/** pick a placement the way a decent, distractible human might */
export function chooseMove(
    grid: Grid,
    matrix: number[][],
    rng: () => number = Math.random,
    tuning: AutoplayTuning = DEFAULT_TUNING,
    maxRot = 3
): Choice | null {
    const cands = evaluatePlacements(grid, matrix, maxRot);
    if (!cands.length) return null;
    const holesBefore = measure(grid).holes;
    const best = cands.reduce((a, b) => (b.score > a.score ? b : a));
    const noisy = cands.map((c) => ({ c, s: c.score + gauss(rng) * tuning.noise })).sort((a, b) => b.s - a.s);
    let pick = noisy[0].c;
    const roll = rng();
    if (roll < tuning.blunder) pick = cands[Math.floor(rng() * cands.length)];
    else if (roll < tuning.blunder + tuning.secondThoughts) pick = noisy[Math.min(noisy.length - 1, 1 + Math.floor(rng() * 3))].c;
    const holesAdded = Math.max(0, pick.metrics.holes - holesBefore);
    return { ...pick, messy: pick !== best && pick.score < best.score - 0.5 ? true : holesAdded > 0, holesAdded };
}

const between = (rng: () => number, [a, b]: [number, number]) => a + rng() * (b - a);

type Phase = "idle" | "think" | "act" | "drop";

export interface AutoplayInfo {
    /** the choice made for the piece now falling (null until planned) */
    plan: Choice | null;
}

/** the hands: call tick(now) every frame while the engine is in bot mode */
export class QtrsAutoplayer {
    private phase: Phase = "idle";
    private plan: Choice | null = null;
    private rotsDone = 0;
    private nextAt = 0;
    private lastRow = -99;
    private lastName = "";
    private blockedRot = false;
    private fails = 0;
    private fumbled = false;
    private hard = true;

    constructor(
        private engine: TetrisGame,
        private rng: () => number = Math.random,
        public tuning: AutoplayTuning = DEFAULT_TUNING
    ) {}

    get info(): AutoplayInfo {
        return { plan: this.plan };
    }

    /** forget the current piece (a new game started) */
    reset(): void {
        this.phase = "idle";
        this.plan = null;
        this.lastRow = -99;
        this.lastName = "";
    }

    private stepGap(): number {
        return 1000 / between(this.rng, this.tuning.stepsPerSec) + (this.rng() - 0.5) * 24;
    }

    tick(now: number): void {
        const s = this.engine.getGameState();
        const p = s.currentPiece;
        if (s.gameOver || s.isPaused || !p) return;
        // a different piece than the one we were planning for (it locked by gravity, or we dropped it)
        if (p.name !== this.lastName || p.row < this.lastRow) {
            this.phase = "idle";
            this.plan = null;
        }
        this.lastName = p.name;
        this.lastRow = p.row;

        if (this.phase === "idle") {
            this.blockedRot = false;
            this.fails = 0;
            this.fumbled = false;
            this.rotsDone = 0;
            this.plan = chooseMove(gridFromPlayfield(s.playfield), p.matrix, this.rng, this.tuning);
            this.hard = this.rng() < this.tuning.hardDropChance;
            let think = between(this.rng, this.tuning.thinkMs);
            if (this.rng() < this.tuning.hesitate.chance) think += between(this.rng, this.tuning.hesitate.ms);
            this.nextAt = now + think;
            this.phase = "think";
            return;
        }
        if (now < this.nextAt) return;
        if (this.phase === "think") this.phase = "act";

        if (this.phase === "drop") {
            this.nextAt = now + 1000 / this.tuning.softRowsPerSec;
            const moved = this.engine.softDrop();
            if (!moved) this.phase = "idle";
            return;
        }

        const plan = this.plan;
        if (!plan) {
            // nothing fits: just let it fall
            this.engine.hardDrop();
            this.phase = "idle";
            return;
        }
        // rotate first, one step at a time
        if (!this.blockedRot && this.rotsDone < plan.rot) {
            if (this.engine.rotate()) this.rotsDone++;
            else this.replanForCurrentShape(s.playfield, p.matrix);
            this.nextAt = now + this.stepGap();
            return;
        }
        const diff = plan.col - p.col;
        if (diff !== 0) {
            let dir = Math.sign(diff);
            if (!this.fumbled && Math.abs(diff) > 1 && this.rng() < this.tuning.fumble) {
                this.fumbled = true;
                dir = -dir; // a wrong step, corrected next tick
            }
            const ok = dir < 0 ? this.engine.moveLeft() : this.engine.moveRight();
            if (!ok && ++this.fails > 2) this.replanForCurrentShape(s.playfield, p.matrix);
            this.nextAt = now + this.stepGap();
            return;
        }
        // in place: drop
        if (this.hard) {
            this.engine.hardDrop();
            this.phase = "idle";
            this.lastName = "";
        } else {
            this.phase = "drop";
            this.nextAt = now + 60;
        }
    }

    /** a rotation or walk was blocked: plan again with the shape as it is now */
    private replanForCurrentShape(playfield: (string | number)[][], matrix: number[][]): void {
        this.blockedRot = true;
        this.fails = 0;
        this.plan = chooseMove(gridFromPlayfield(playfield), matrix, this.rng, this.tuning, 0);
    }
}
