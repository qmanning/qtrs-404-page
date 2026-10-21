"use client";

/**
 * Q.T.R.S. 404: QBOT plays Q.T.R.S. on a blue-and-white handheld. He is a believable, imperfect player (../lib/autoplay.ts)
 * driving the real engine (../lib/gameEngine.ts). "Click to Play" (or Enter / Space) hands the game to the visitor; after about
 * 30 s with no input he takes it back. On phones (820 px wide or less) the screen is the QBOY handheld with on-screen controls.
 *
 * Everything is served from `assetBase` (default "/qtrs"): the sprites, the fonts, the optional voice and sound effects.
 * Sound is OFF until the visitor turns it on (that click is the user gesture); nothing audio is requested before then.
 * The leaderboard is optional: pass `leaderboard` (an endpoint) or the scores stay in this browser's localStorage.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { TetrisGame as Engine, type GameState } from "../lib/gameEngine";
import { QtrsAutoplayer, gridFromPlayfield, measure } from "../lib/autoplay";
import spritePx from "../manifests/q-pixellab.json";
import sfxManifest from "../manifests/sfx.json";
import voiceManifest from "../manifests/voice.json";
import { SwipeDetector } from "../lib/swipeDetection";
import { createScoreStore, type LeaderboardConfig, type ScoreStore } from "../lib/scores";
import ScoreSubmissionModal from "./ScoreSubmissionModal";
import { ArrowDown, ArrowDownToLine, ArrowLeft, ArrowRight, RotateCcw, RotateCw } from "lucide-react";
import styles from "./Qtrs404.module.css";

type Mode = "bot" | "count" | "player" | "over" | "attract";

// ---- the screen: 144 x 160 logical pixels, a 4-tone palette built from QOS blue ----
// the well is 10 x 20 square 8px cells (80 x 160, the classic 1:2); the readouts sit beside it, one cell clear of the wall
const W = 144; // 80 well + 8 wall + 8 gap + 40 readouts + 8 margin
const H = 160;
const CELL = 8;
const PAL = ["#f3f6ff", "#9db3fa", "#163bef", "#09156b"]; // lightest to darkest: white, light blue, QOS blue, navy
// the line-clear flash swaps the tones (navy board, white blocks), never leaving the four
let T0 = PAL[0];
let T1 = PAL[1];
let T2 = PAL[2];
let T3 = PAL[3];
function setTones(inverted: boolean) {
    [T0, T1, T2, T3] = inverted ? [PAL[3], PAL[2], PAL[1], PAL[0]] : PAL;
}
const FONT = '8px "QtrsCGA", ui-monospace, monospace';
// ---- sound: OFF until the visitor turns it on (the click is the user gesture); nothing is requested before that ----
const SND_KEY = "qtrs-sound";
const COACH_KEY = "qtrs-sound-reminded";
const VOICE = voiceManifest as Record<string, { file: string; duration: number }>;
// the chiptune effects: decoded once with Web Audio after the first sound-on gesture, played as buffer sources (cheap overlap, no latency)
const SFX = sfxManifest as Record<string, { file: string; ms: number; volume: number }>;
const MUSIC_VOL = 0.25;
const MUSIC_DUCKED = 0.12;
/** Q is the full-colour PixelLab sprite sheet (q-pixellab.png, 4 x 6 frames of 170 x 220 px; the idle loop plus two reactions) */
const PX = true;
const sprite = spritePx;
/** the four-blue twin of the sheet (same cells), for the QBOY handheld: q-pixellab-mono.png */
const IDLE_ANIM = spritePx.animations.idle;
/** PixelLab's reactions: which animation a pose plays (the other poses, like the fist pump and the clap on a small win, play none and just show the bubble) */
const PX_ANIM: Partial<Record<Pose, "punch" | "jump">> = { oops: "punch", slump: "punch", cheer: "jump", clap: "jump" };
/** reduced motion: one still frame per reaction (Taking_Punch frame 2, the flinch; Two-Footed_Jump frame 4, the top of the hop) */
const PX_STILL = { punch: 2, jump: 4 };
/** sprite frame indices (row-major, 0 based): the 16 frames of the sheet */
const F = { idle: 0, breathe: 1, blink: 2, watch: 3, play: 4, think: 5, oops: 6, slump: 7, fist: 8, cheer: 9, clap: 10, point: 11, talk: [12, 13, 14, 15] } as const;
type Pose = "watch" | "oops" | "slump" | "fist" | "cheer" | "clap" | "point";
type Base = "idle" | "play" | "watch";
const POSE_FRAME: Record<Pose, number> = { watch: F.watch, oops: F.oops, slump: F.slump, fist: F.fist, cheer: F.cheer, clap: F.clap, point: F.point };
/** 3, 2, 1, GO!: each one this long */
const STEP = 700;
/** the visitor has been idle this long (ms): Q asks to take over, and the meter drains over ASK_MS */
const IDLE_MS = 20000;
const ASK_MS = 8000;
/** how long the high-score interstitial shows before Q starts playing again */
const ATTRACT_MS = 5200;
const COUNT = ["3", "2", "1", "GO!"];

type Kind = "A" | "B" | "C" | "wall";
const KIND: Record<string, Kind> = { I: "A", T: "A", O: "B", Z: "B", J: "B", L: "C", S: "C" };

function rect(c: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number) {
    c.fillStyle = color;
    c.fillRect(x, y, w, h);
}

/** one 8 x 8 block with the classic inner bevel */
function drawCell(c: CanvasRenderingContext2D, x: number, y: number, kind: Kind) {
    rect(c, T3, x, y, CELL, CELL);
    if (kind === "A") {
        rect(c, T2, x + 1, y + 1, 6, 6);
        rect(c, T1, x + 1, y + 1, 6, 1);
        rect(c, T1, x + 1, y + 1, 1, 6);
    } else if (kind === "B") {
        rect(c, T2, x + 1, y + 1, 6, 6);
        rect(c, T3, x + 2, y + 2, 4, 4);
        rect(c, T1, x + 1, y + 1, 2, 1);
        rect(c, T1, x + 1, y + 1, 1, 2);
    } else if (kind === "C") {
        rect(c, T1, x + 1, y + 1, 6, 6);
        rect(c, T0, x + 1, y + 1, 3, 1);
        rect(c, T0, x + 1, y + 1, 1, 3);
        rect(c, T2, x + 1, y + 6, 6, 1);
        rect(c, T2, x + 6, y + 1, 1, 6);
    } else {
        rect(c, T2, x + 1, y + 1, 6, 6);
        rect(c, T1, x + 1, y + 1, 1, 1);
    }
}

function text(c: CanvasRenderingContext2D, s: string, x: number, y: number, color = T3) {
    c.fillStyle = color;
    c.fillText(s, x, y);
}
const centered = (s: string, w: number) => Math.max(0, Math.floor((w - s.length * 8) / 2));

interface Pop {
    text: string;
    until: number;
}

interface Count {
    text: string;
    /** ms since this number appeared */
    age: number;
    reduced: boolean;
}

/** the real ink bounds of a string in the pixel font (advance and side bearings differ per glyph: "1" is narrow), measured once by drawing it and scanning the pixels */
const inkCache = new Map<string, { cx: number; cy: number }>();
function inkCentre(text: string, size: number) {
    const key = text + "@" + size;
    const hit = inkCache.get(key);
    if (hit) return hit;
    const pad = size;
    const cv = document.createElement("canvas");
    cv.width = text.length * size + pad * 2;
    cv.height = size * 2 + pad;
    const g = cv.getContext("2d", { willReadFrequently: true });
    let r = { cx: (text.length * size) / 2, cy: size / 2 };
    if (g) {
        g.font = `${size}px "QtrsCGA", ui-monospace, monospace`;
        g.textBaseline = "top";
        g.fillStyle = "#000";
        g.fillText(text, pad, pad);
        const d = g.getImageData(0, 0, cv.width, cv.height).data;
        let x0 = cv.width, x1 = -1, y0 = cv.height, y1 = -1;
        for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (d[(y * cv.width + x) * 4 + 3] > 127) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
        }
        if (x1 >= 0) r = { cx: (x0 + x1 + 1) / 2 - pad, cy: (y0 + y1 + 1) / 2 - pad };
    }
    inkCache.set(key, r);
    return r;
}

/** the countdown: a very large pixel number centred on the well (80 x 160, its centre is 40, 80), white with a navy outline (one font pixel thick), a punch-in on each */
function drawCount(c: CanvasRenderingContext2D, k: Count) {
    const go = k.text === "GO!";
    // sizes are multiples of 8 so every font pixel lands on whole canvas pixels (the board is shown at a whole-number scale)
    const size = go ? (!k.reduced && k.age < 90 ? 32 : 24) : !k.reduced && k.age < 110 ? 72 : 64;
    const u = size / 8;
    const ink = inkCentre(k.text, size);
    const x = Math.round(40 - ink.cx), y = Math.round(80 - ink.cy);
    c.font = `${size}px "QtrsCGA", ui-monospace, monospace`;
    c.textBaseline = "top";
    c.fillStyle = PAL[3];
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) c.fillText(k.text, x + dx * u, y + dy * u);
    c.fillStyle = PAL[0];
    c.fillText(k.text, x, y);
    c.font = FONT;
}

/** the takeover meter: a chunky classic-game energy bar across the well, ten segments draining from the right */
function drawMeter(c: CanvasRenderingContext2D, left: number, now: number) {
    const x = 4, y = 118, w = 72, h = 30;
    rect(c, PAL[3], x, y, w, h);
    rect(c, PAL[0], x + 2, y + 2, w - 4, h - 4);
    c.font = FONT;
    c.textBaseline = "top";
    c.fillStyle = PAL[3];
    c.fillText("MY TURN?", x + 4 + 4, y + 5);
    const segs = Math.ceil(left * 10);
    const low = segs <= 3;
    for (let i = 0; i < 10; i++) {
        const sx = x + 5 + i * 6.2 | 0;
        if (i < segs && !(low && Math.floor(now / 160) % 2 && i === segs - 1)) {
            rect(c, PAL[3], sx, y + 17, 6, 9);
            rect(c, low ? PAL[1] : PAL[2], sx + 1, y + 18, 4, 7);
            rect(c, PAL[0], sx + 1, y + 18, 4, 1);
        } else {
            rect(c, PAL[1], sx, y + 17, 6, 9);
            rect(c, PAL[0], sx + 1, y + 18, 4, 7);
        }
    }
}

function draw(canvas: HTMLCanvasElement, s: GameState, mode: Mode, now: number, pop: Pop | null, inverted = false, count: Count | null = null, meter: number | null = null, ghost: GameState["currentPiece"] = null, qboy = false, qTop = 110) {
    const c = canvas.getContext("2d");
    if (!c) return;
    setTones(inverted);
    c.imageSmoothingEnabled = false;
    c.font = FONT;
    c.fontKerning = "none";
    c.textBaseline = "top";
    const CW = canvas.width;
    rect(c, T0, 0, 0, CW, H);
    // the stack
    for (let r = 0; r < 20; r++)
        for (let col = 0; col < 10; col++) {
            const v = s.playfield[r] && s.playfield[r][col];
            if (v) drawCell(c, col * CELL, r * CELL, KIND[String(v)] || "A");
        }
    // the ghost: where a hard drop would land, an outline only (a 1 px inset border in light blue), under the active piece and
    // not drawn where the active piece already is
    const p = s.currentPiece;
    if (ghost && p && !s.gameOver) {
        const here = new Set<string>();
        for (let i = 0; i < p.matrix.length; i++) for (let j = 0; j < p.matrix[i].length; j++) if (p.matrix[i][j]) here.add(p.row + i + "," + (p.col + j));
        for (let i = 0; i < ghost.matrix.length; i++)
            for (let j = 0; j < ghost.matrix[i].length; j++) {
                if (!ghost.matrix[i][j] || ghost.row + i < 0 || here.has(ghost.row + i + "," + (ghost.col + j))) continue;
                const x = (ghost.col + j) * CELL, y = (ghost.row + i) * CELL;
                rect(c, PAL[1], x, y, CELL, 1);
                rect(c, PAL[1], x, y + CELL - 1, CELL, 1);
                rect(c, PAL[1], x, y + 1, 1, CELL - 2);
                rect(c, PAL[1], x + CELL - 1, y + 1, 1, CELL - 2);
            }
    }
    // the falling piece
    if (p && !s.gameOver)
        for (let i = 0; i < p.matrix.length; i++)
            for (let j = 0; j < p.matrix[i].length; j++)
                if (p.matrix[i][j] && p.row + i >= 0) drawCell(c, (p.col + j) * CELL, (p.row + i) * CELL, KIND[p.name] || "A");
    // wall between the field and the readouts
    for (let r = 0; r < 20; r++) drawCell(c, 80, r * CELL, "wall");
    // readouts
    const hx = 96; // one cell (8px) clear of the wall at 80..88
    // QBOY: the side panel is NEXT (no label) and one or two short lines; Q fills the rest of the panel (a DOM sprite over this canvas)
    text(c, qboy ? "Next" : "NEXT", hx, 2);
    const n = s.nextPiece;
    if (n) {
        let minR = 9, maxR = -1, minC = 9, maxC = -1;
        n.matrix.forEach((row, i) =>
            row.forEach((v, j) => {
                if (v) {
                    minR = Math.min(minR, i);
                    maxR = Math.max(maxR, i);
                    minC = Math.min(minC, j);
                    maxC = Math.max(maxC, j);
                }
            })
        );
        const ox = hx + Math.floor((40 - (maxC - minC + 1) * CELL) / 2);
        const oy = 14 + Math.floor((24 - (maxR - minR + 1) * CELL) / 2);
        n.matrix.forEach((row, i) =>
            row.forEach((v, j) => {
                if (v) drawCell(c, ox + (j - minC) * CELL, oy + (i - minR) * CELL, KIND[n.name] || "A");
            })
        );
    }
    if (qboy) {
        // the handheld's readouts: the labels in mixed case, the three blocks spread evenly between the next piece and Q's head
        const y0 = 44, bh = 18, gap = Math.max(4, (qTop - 4 - y0 - 3 * bh) / 2);
        text(c, "Level", hx, Math.round(y0));
        text(c, String(s.level), hx, Math.round(y0 + 10));
        text(c, "Lines", hx, Math.round(y0 + bh + gap));
        text(c, String(Math.min(s.lines, 9999)), hx, Math.round(y0 + bh + gap + 10));
        text(c, "Score", hx, Math.round(y0 + 2 * (bh + gap)));
        text(c, String(Math.min(s.score, 99999)), hx, Math.round(y0 + 2 * (bh + gap) + 10));
    } else {
        text(c, "LEVEL", hx, 48);
        text(c, String(s.level), hx, 58);
        text(c, "LINES", hx, 76);
        text(c, String(Math.min(s.lines, 9999)), hx, 86);
        text(c, "SCORE", hx, 104);
        text(c, String(Math.min(s.score, 99999)), hx, 114);
        text(c, mode === "bot" || mode === "attract" ? "DEMO" : "1P", hx, 140);
    }
    // the line-clear shout
    if (pop && now < pop.until && !s.gameOver) {
        const w = pop.text.length * 8 + 12;
        const x = Math.floor((80 - w) / 2);
        rect(c, T3, x, 28, w, 18);
        rect(c, T0, x + 1, 29, w - 2, 16);
        rect(c, T2, x + 2, 30, w - 4, 14);
        text(c, pop.text, x + 6, 33, T0);
    }
    if (count) drawCount(c, count);
    if (meter !== null) drawMeter(c, meter, now);
    if (s.isPaused && !s.gameOver) {
        rect(c, T3, 0, 64, 80, 32);
        text(c, "PAUSED", centered("PAUSED", 80), 76, T0);
    }
    if (s.gameOver) {
        rect(c, T3, 0, 60, 80, 40);
        rect(c, T2, 2, 62, 76, 36);
        text(c, "GAME", centered("GAME", 80), 70, T0);
        text(c, "OVER", centered("OVER", 80), 82, T0);
    }
}

// ---- QBOT's lines (short, playful, no dashes) ----
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const LINES = {
    botStart: ["Hmm.", "Okay, here we go."],
    ambient: ["Hmm.", "Left a bit.", "Thinking...", "Where does this go?", "Almost."],
    clear: { 1: ["Nice.", "Got it.", "Clean."], 2: ["Double!", "Two at once."], 3: ["Triple!"], 4: ["TETRIS!", "Q.T.R.S.!"] } as Record<number, string[]>,
    oops: ["Oops.", "Hmm, that's a hole.", "Eh, it'll work.", "Not my best."],
    rising: ["Uh oh.", "Getting tall.", "Breathe."],
    topout: ["Well. Again!", "Oof. Reset.", "I meant to do that."],
    go: ["Your turn!"],
    playerClear: { 1: ["Nice!", "Yes!"], 2: ["Double!", "Whoa!"], 3: ["Triple! Wow."], 4: ["TETRIS! Show off."] } as Record<number, string[]>,
    playerRising: ["Careful!", "Whoa, tall."],
    playerOverGood: ["Good game!", "Not bad at all."],
    playerOverBad: ["Oof. Again?", "So close."],
    idleReturn: ["My turn!", "Okay, I'll play."],
};
// "Q.T.R.S.!" is 84px with its frame, wider than the 80px well, so the four-line shout is TETRIS!
const POP = ["", "NICE!", "DOUBLE!", "TRIPLE!", "TETRIS!"];

interface ScoreRow {
    initials: string;
    score: number;
}

/** the high scores in the game's own look: navy plate, pixel font, read from the score store (nothing is sent from here) */
function PixelScores({ store, kicker, onClose }: { store: ScoreStore; kicker?: string; onClose?: () => void }) {
    const [rows, setRows] = useState<ScoreRow[] | null>(null);
    useEffect(() => {
        let live = true;
        store
            .list()
            .then((rows) => live && setRows(rows.slice(0, 10)))
            .catch(() => live && setRows([]));
        return () => {
            live = false;
        };
    }, [store]);
    return (
        <div className={styles.scores}>
            {onClose && (
                <button type="button" className={styles.scoresClose} aria-label="Close high scores" onClick={onClose}>
                    X
                </button>
            )}
            {kicker && <div className={styles.scoresKicker}>{kicker}</div>}
            <div className={styles.scoresTitle}>HIGH SCORES</div>
            {rows === null ? (
                <div className={styles.scoresNote}>LOADING</div>
            ) : rows.length === 0 ? (
                <div className={styles.scoresNote}>NO SCORES YET</div>
            ) : (
                <ol className={styles.scoresList}>
                    {rows.map((r, i) => (
                        <li key={i} className={i === 0 ? styles.scoresTop : undefined}>
                            <span>{i + 1}</span>
                            <span>{String(r.initials).toUpperCase().slice(0, 3)}</span>
                            <span>{r.score}</span>
                        </li>
                    ))}
                </ol>
            )}
        </div>
    );
}

/** the screen box (navy bezel with its title bar) is the screen scaled, plus 14 + 16 padding, the title line and its 10px gap */
// padding, the title strip (a line of the pixel font plus 10px) and the Start/sound strip (a line plus 24px above it; the bezel pads 14px above and 24px below)
const bezelH = (sc: number) => H * sc + 38 + ((sc < 3 ? 8 : 16) + 10) + ((sc < 3 ? 8 : 16) + 24);
/**
 * His whole-number scale (2x, 3x, 4x ...): his figure (head to feet) about 42% of the screen box's height, never wider than fits,
 * and k times the device pixel ratio a whole number too, so every native pixel is a whole number of device pixels (at 1.5 or 1.25,
 * or browser zoom, a plain k would smear some pixels wider than others).
 */
function spriteScale(sc: number, fit: number) {
    const figure = sprite.baselineY - sprite.headTopY;
    const ideal = (0.425 * bezelH(sc)) / figure;
    const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    const clean = (k: number) => Math.abs(k * dpr - Math.round(k * dpr)) < 0.001;
    let best = 0;
    // PixelLab's Q is drawn at 1:1 and is already 200 px tall, so 1x is a valid scale for him (the GPT sheet starts at 2x)
    const kmin = PX ? 1 : 2;
    for (let k = kmin; k <= Math.max(kmin, fit); k++) if (clean(k) && (!best || Math.abs(k - ideal) < Math.abs(best - ideal))) best = k;
    return best || Math.max(kmin, Math.min(Math.round(ideal), fit));
}
const EYES = ((sprite as unknown as { eyes?: Record<string, { up: number; down: number }> }).eyes || {}) as Record<string, { up: number; down: number }>;

/** the D-pad's plus as a path on a 195 unit square: every edge pulled in by the same d, so a gap between two of these is even all the way round;
 * convex corners rounded by r, the four inner corners by ri */
function plusPath(d: number, r: number, ri: number) {
    const c = 97.5, hw = 32.5 - d, R = 97.5 - d;
    const v: [number, number, number][] = [[c - hw, c - R, r], [c + hw, c - R, r], [c + hw, c - hw, ri], [c + R, c - hw, r], [c + R, c + hw, r], [c + hw, c + hw, ri], [c + hw, c + R, r], [c - hw, c + R, r], [c - hw, c + hw, ri], [c - R, c + hw, r], [c - R, c - hw, r], [c - hw, c - hw, ri]];
    let out = "";
    v.forEach(([x, y, rad], i) => {
        const [px, py] = v[(i + v.length - 1) % v.length];
        const [nx, ny] = v[(i + 1) % v.length];
        const l1 = Math.hypot(x - px, y - py), l2 = Math.hypot(nx - x, ny - y);
        const t1 = Math.min(rad, l1 / 2), t2 = Math.min(rad, l2 / 2);
        const sx = x + ((px - x) / l1) * t1, sy = y + ((py - y) / l1) * t1;
        const ex = x + ((nx - x) / l2) * t2, ey = y + ((ny - y) / l2) * t2;
        out += (i ? "L" : "M") + sx.toFixed(1) + " " + sy.toFixed(1) + "Q" + x + " " + y + " " + ex.toFixed(1) + " " + ey.toFixed(1);
    });
    return out + "Z";
}

type PadName = "left" | "right" | "down" | "up" | "n1" | "n2" | "n3" | "n4";

declare global {
    interface Window {
        __qtrs?: unknown;
    }
}

const DEFAULT_LINES = ["This page fell through the cracks.", "QBOT is playing Q.T.R.S. while you are here. Want a turn?"];

export interface Qtrs404Props {
    /** where "Go home" and the QBOY's Home button go (default "/") */
    home?: string;
    /** the error code; "404" is the default page, "qtrs" is the plain game page, anything else is an error page with the same game */
    code?: string;
    /** the small tag above the heading (and the QBOY's code label comes from `code`) */
    title?: string;
    /** the heading and the short paragraph under it */
    lines?: [string, string] | string[];
    /** when set, a "Try again" button sits beside "Go home" (an error boundary's reset) */
    onRetry?: () => void;
    /**
     * The shared leaderboard: one URL (GET `?limit=10` returns `{ leaderboard: [{ initials, score }] }`, POST sends
     * `{ initials, score, level, lines }`), or `{ list, submit }` when they are two URLs. Left out, high scores stay in this
     * browser's localStorage and the game works with no backend at all.
     */
    leaderboard?: LeaderboardConfig;
    /** the folder the sprites, fonts, voice and sound effects are served from (default "/qtrs"; copy `public/qtrs` there) */
    assetBase?: string;
    /** an optional looping music track URL; there is none by default */
    musicSrc?: string;
}

export default function Qtrs404({
    home = "/",
    code = "404",
    title = "Error 404",
    lines = DEFAULT_LINES,
    onRetry,
    leaderboard,
    assetBase = "/qtrs",
    musicSrc,
}: Qtrs404Props) {
    const base = assetBase.replace(/\/+$/, "");
    const spriteSrc = `${base}/q-pixellab.png`;
    const spriteSrcMono = `${base}/q-pixellab-mono.png`;
    const baseRefA = useRef(base);
    baseRefA.current = base;
    const musicRef = useRef(musicSrc);
    musicRef.current = musicSrc;
    const [store] = useState<ScoreStore>(() => createScoreStore(leaderboard));
    const [mode, setModeState] = useState<Mode>("bot");
    const [paused, setPaused] = useState(false);
    const [bubble, setBubble] = useState<{ text: string; id: number } | null>(null);
    const [scale, setScale] = useState(3);
    const [pk, setPk] = useState(5); // the sprite's whole-number scale (2x, 3x, 4x ...)
    const [bh, setBh] = useState(536); // the screen box's height, so his feet can stand on its bottom edge
    const [touch, setTouch] = useState(false);
    // QBOY: the phone handheld (viewport 820 px or narrower): the screen is the device, with on-screen controls and Q in the side panel
    const [qboy, setQboy] = useState(false);
    // the handheld's measures: u is one pixel of Q's 538 px wide render, the lens is the screen's black glass around the display
    const [qdim, setQdim] = useState({ u: 0.7, uc: 0.7, lw: 330, lh: 360, cbf: 60, cbd: 63, qw: 144, kq: 0.5, kdev: 1, showQ: true, pt: 18, pb: 26, sat: 0, sab: 0, sim: false });
    const qboyRef = useRef(false);
    const qTopRef = useRef(110); // the row (of the 160) where Q's head starts, so the readouts can be spread evenly above him
    const observeRef = useRef<() => void>(() => {});
    const [pressed, setPressed] = useState<string | null>(null);
    const [board, setBoard] = useState<null | "pause" | "over" | "attract">(null);
    const [boardKey, setBoardKey] = useState(0);
    const [asking, setAsking] = useState(false);
    const [scoreModal, setScoreModal] = useState<{ score: number; level: number; lines: number } | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const screenRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const spriteRef = useRef<HTMLDivElement>(null);
    const startRef = useRef<HTMLButtonElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement>(null);
    const modeRef = useRef<Mode>("bot");
    const engine = useRef<Engine | null>(null);
    const bot = useRef<QtrsAutoplayer | null>(null);
    const pop = useRef<Pop | null>(null);
    const baseRef = useRef<Base>("play");
    const reaction = useRef<{ pose: Pose; until: number; bounce: boolean; anim?: "punch" | "jump"; start: number } | null>(null);
    const talk = useRef<{ from: number; until: number } | null>(null);
    const lastBubble = useRef(0);
    const [soundOn, setSoundOn] = useState(false);
    const [coach, setCoach] = useState(false);
    const soundRef = useRef(false);
    const musicEl = useRef<HTMLAudioElement | null>(null);
    const voiceEl = useRef<HTMLAudioElement | null>(null);
    const playVoice = useRef<(t: string) => void>(() => {});
    const audioCtx = useRef<AudioContext | null>(null);
    const sfxBuffers = useRef<Record<string, AudioBuffer>>({});
    const sfxLoading = useRef(false);
    const lastMoveAt = useRef(0);
    const skipThunk = useRef(false);
    const duckTimer = useRef(0);
    /** play an effect (only while sound is on); demo = QBOT's game, at 60% */
    const sfxRef = useRef<(name: string, demo?: boolean) => void>(() => {});
    const boardRef = useRef<string | null>(null);
    qboyRef.current = qboy;
    const frameRef = useRef(0);
    /** where his eyes look: 0 up, 1 centred, 2 down, from the active piece's row (held at least 150 ms) */
    const gaze = useRef({ zone: 1, since: 0 });
    const reduced = useRef(false);
    const pausedRef = useRef(false);
    const countRef = useRef<{ t0: number } | null>(null);
    const askRef = useRef({ on: false, left: 0 });
    const attractTimer = useRef(0);
    const scoreModalRef = useRef(false);
    const cancelAskRef = useRef<() => void>(() => {});
    const takeOverRef = useRef<() => void>(() => {});
    const countTimers = useRef<number[]>([]);
    const bubbleTimer = useRef(0);
    const resetTimer = useRef(0);
    const boardTimer = useRef(0);
    const lastInput = useRef(0);
    const overAt = useRef(0);
    const log = useRef<{ t: number; mood: string; why: string }[]>([]);
    const risingAt = useRef(0);
    const doSay = useRef<(t: string, ms?: number) => void>(() => {});
    const startPlayerRef = useRef<() => void>(() => {});
    const startAskRef = useRef<() => void>(() => {});

    // ---- sound ----
    const audioLog = useRef<string[]>([]);
    const ensureAudio = useCallback(() => {
        if (!musicEl.current && musicRef.current) {
            const m = new Audio(musicRef.current);
            m.loop = true;
            m.volume = MUSIC_VOL;
            m.preload = "auto";
            ["loadstart", "canplay", "playing", "pause", "error"].forEach((ev) => m.addEventListener(ev, () => audioLog.current.push("music:" + ev)));
            musicEl.current = m;
        }
        if (!voiceEl.current) {
            const v = new Audio();
            v.preload = "auto";
            const un = () => {
                if (musicEl.current) musicEl.current.volume = MUSIC_VOL;
            };
            v.addEventListener("ended", un);
            v.addEventListener("pause", un);
            v.addEventListener("error", un);
            ["loadstart", "playing", "ended", "error"].forEach((ev) => v.addEventListener(ev, () => audioLog.current.push("voice:" + ev + ":" + v.src.split("/").pop())));
            voiceEl.current = v;
        }
    }, []);
    /** music plays only while sound is on, the game is not paused and the tab is visible */
    const syncMusic = useCallback(() => {
        const m = musicEl.current;
        if (!m) return;
        if (soundRef.current && !pausedRef.current && !document.hidden) m.play().catch(() => {});
        else m.pause();
        if (document.hidden) voiceEl.current?.pause();
    }, []);
    playVoice.current = (t: string) => {
        const clip = VOICE[t];
        if (!soundRef.current || !clip) return; // lines without a recording stay silent
        ensureAudio();
        const v = voiceEl.current;
        const m = musicEl.current;
        if (!v) return;
        v.pause(); // a new clip cuts the old one
        v.src = `${baseRefA.current}/voice/${clip.file}`;
        v.currentTime = 0;
        if (m) m.volume = MUSIC_DUCKED;
        v.play().catch(() => {
            if (m) m.volume = MUSIC_VOL;
        });
    };
    const stopSound = useCallback(() => {
        voiceEl.current?.pause();
        const m = musicEl.current;
        if (m) {
            m.pause();
            m.currentTime = 0;
            m.volume = MUSIC_VOL;
        }
    }, []);
    /** decode the effects once, after a user gesture has made sound audible */
    const ensureSfx = useCallback(() => {
        if (typeof window === "undefined") return;
        if (!audioCtx.current) {
            const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (!AC) return;
            audioCtx.current = new AC();
        }
        audioCtx.current.resume().catch(() => {});
        if (sfxLoading.current) return;
        sfxLoading.current = true;
        const ctx = audioCtx.current;
        Object.entries(SFX).forEach(([name, d]) => {
            fetch(`${baseRefA.current}/${d.file}`)
                .then((r) => r.arrayBuffer())
                .then((ab) => ctx.decodeAudioData(ab))
                .then((buf) => {
                    sfxBuffers.current[name] = buf;
                })
                .catch(() => {});
        });
    }, []);
    sfxRef.current = (name: string, demo = false) => {
        const ctx = audioCtx.current;
        const buf = sfxBuffers.current[name];
        const d = SFX[name];
        if (!soundRef.current || !ctx || !buf || !d) return;
        const now = performance.now();
        if (name === "move") {
            if (now - lastMoveAt.current < 80) return; // held moves repeat faster than the ear wants
            lastMoveAt.current = now;
        }
        const vol = d.volume * (demo ? 0.6 : 1);
        const src = ctx.createBufferSource();
        const g = ctx.createGain();
        g.gain.value = vol;
        src.buffer = buf;
        src.connect(g).connect(ctx.destination);
        src.start();
        audioLog.current.push("sfx:" + name + ":" + vol.toFixed(2));
        if (name === "clear" || name === "tetris" || name === "gameover") {
            // the music ducks under the big ones, as it does under a voice line
            const m = musicEl.current;
            if (m) {
                m.volume = MUSIC_DUCKED;
                window.clearTimeout(duckTimer.current);
                duckTimer.current = window.setTimeout(() => {
                    if (musicEl.current && (!voiceEl.current || voiceEl.current.paused)) musicEl.current.volume = MUSIC_VOL;
                }, d.ms);
            }
        }
    };
    const toggleSound = useCallback(() => {
        const on = !soundRef.current;
        soundRef.current = on;
        setSoundOn(on);
        setCoach(false);
        try {
            localStorage.setItem(SND_KEY, on ? "1" : "0");
            localStorage.setItem(COACH_KEY, "1");
        } catch {
            /* storage can be off */
        }
        if (on) {
            ensureAudio();
            ensureSfx();
            syncMusic();
        } else stopSound();
    }, [ensureAudio, ensureSfx, syncMusic, stopSound]);

    // ---- QBOT ----
    const note = useCallback((m: string, why: string) => {
        log.current.push({ t: Math.round(performance.now()), mood: m, why });
    }, []);
    /**
     * A line in a bubble. The bubble stays up for ms; his mouth flaps (the talking frames, which share pose 1) for as long as
     * the words take to say, then he holds "closed" a moment and goes back to his pose. A reaction pose cannot talk (the talking
     * frames are the stance), so the reaction plays its beat first and the mouth starts when the beat is over.
     */
    const say = useCallback((t: string, ms = 2300) => {
        const now = performance.now();
        window.clearTimeout(bubbleTimer.current);
        setBubble({ text: t, id: now });
        lastBubble.current = now;
        bubbleTimer.current = window.setTimeout(() => setBubble(null), Math.max(1600, ms));
        // a line spoken during a reaction pose does not flap: the pose is held for the whole line (see hold), one clean beat per event
        const busy = reaction.current && now < reaction.current.until;
        // the mouth follows the recorded clip's real length when there is one, the word count's estimate when there is not
        const clip = VOICE[t];
        const dur = clip ? clip.duration * 1000 : Math.min(1600, Math.max(500, t.length * 70));
        talk.current = reduced.current || busy ? null : { from: now, until: now + dur };
        playVoice.current(t);
    }, []);
    doSay.current = say;
    /** a reaction: a pose held for ms (and for as long as its line is up), then back to the base pose; bounce = the Tetris hop, two frames */
    const hold = useCallback(
        (pose: Pose, ms: number, why: string, line?: string, bounce = false) => {
            note(pose, why);
            const now = performance.now();
            const anim = PX ? PX_ANIM[pose] : undefined;
            // PixelLab's Q: only the poses with an animation take a reaction beat; the rest just show the bubble (and he talks it)
            reaction.current = PX && !anim ? null : { pose, until: now + (line ? Math.max(ms, 2000) : ms), bounce, anim, start: now };
            if (line) say(line, 2000);
        },
        [note, say]
    );
    const setBase = useCallback(
        (b: Base, why: string) => {
            baseRef.current = b;
            reaction.current = null;
            note(b, why);
        },
        [note]
    );

    /**
     * The event to pose map (frames in brackets are 1 based, as on the sheet).
     *   bot: placing = play [5] (base), a think [6] now and then | 1 to 3 lines = fist pump [9] |
     *        a Tetris = cheer and hop [10, 9] | a hole = oops [7] | stack near the top = watch, leaning in [4] |
     *        top out = slump [8], then he resets
     *   visitor: the countdown (see startPlayer) | their clear = clap [11], a Tetris = cheer and hop |
     *        tall stack = watch [4] | game over = clap [11] if it was a good one, else oops [7], base = idle [1, 2, 3]
     *   idle return: fist pump [9] "My turn!", then play
     *   paused: idle. Talking is layered on top of whatever the base is (see say).
     */
    const react = useCallback(
        (kind: "clear" | "oops" | "rising" | "topout" | "playerOver" | "idleReturn" | "botStart", n = 0, extra = 0) => {
            const player = modeRef.current !== "bot";
            // the bot's small moments (a 1 to 3 line clear, a hole, a tall stack) fire on about 1 in 3 placements and never closer
            // than 2.5 s to the last line; Tetris, top-outs and everything the visitor does always get their beat
            const quiet = !player && ((kind === "clear" && n < 4) || kind === "oops" || kind === "rising");
            if (quiet && (Math.random() > 0.34 || performance.now() - lastBubble.current < 2500)) return;
            switch (kind) {
                case "clear":
                    if (n >= 4) hold("cheer", 2600, (player ? "visitor " : "") + "tetris", pick((player ? LINES.playerClear : LINES.clear)[4]), true);
                    else if (player) hold("clap", 1700, "visitor cleared " + n, pick(LINES.playerClear[n] || LINES.playerClear[1]));
                    else hold("fist", 1600, "cleared " + n, pick(LINES.clear[n] || LINES.clear[1]));
                    break;
                case "oops":
                    hold("oops", 1500, "messy placement", pick(LINES.oops));
                    break;
                case "rising":
                    hold("watch", 2200, "stack rising", pick(player ? LINES.playerRising : LINES.rising));
                    break;
                case "topout":
                    hold("slump", 2300, "topped out", pick(LINES.topout));
                    break;
                case "playerOver":
                    setBase("idle", "visitor game over");
                    hold(extra >= 8 ? "clap" : "oops", 3000, "visitor game over", pick(extra >= 8 ? LINES.playerOverGood : LINES.playerOverBad));
                    break;
                case "idleReturn":
                    setBase("play", "idle, back to autoplay");
                    hold("fist", 1500, "my turn", pick(LINES.idleReturn));
                    break;
                case "botStart":
                    setBase("play", "bot started");
                    break;
            }
        },
        [hold, setBase]
    );
    const reactRef = useRef(react);
    reactRef.current = react;

    // ---- mode changes ----
    const clearBoard = useCallback(() => {
        window.clearTimeout(boardTimer.current);
        setBoard(null);
        setScoreModal(null);
    }, []);

    const startBot = useCallback(
        (idle: boolean) => {
            window.clearTimeout(resetTimer.current);
            countTimers.current.forEach((id) => window.clearTimeout(id));
            window.clearTimeout(attractTimer.current);
            askRef.current.on = false;
            setAsking(false);
            countRef.current = null;
            clearBoard();
            engine.current?.reset();
            bot.current?.reset();
            pop.current = null;
            modeRef.current = "bot";
            setModeState("bot");
            setPaused(false);
            if (idle) react("idleReturn");
            else react("botStart");
        },
        [react, clearBoard]
    );

    /** a takeover: a fresh empty well, then 3, 2, 1, GO! (inputs are ignored until GO!); QBOT cheers along */
    const startPlayer = useCallback(() => {
        if (modeRef.current === "count") return;
        window.clearTimeout(resetTimer.current);
        window.clearTimeout(attractTimer.current);
        askRef.current.on = false;
        setAsking(false);
        clearBoard();
        engine.current?.reset();
        bot.current?.reset();
        pop.current = null;
        lastInput.current = performance.now();
        modeRef.current = "count";
        setModeState("count");
        setPaused(false);
        setBubble(null);
        startRef.current?.blur();
        setBase("watch", "visitor took over");
        countRef.current = { t0: performance.now() };
        hold("fist", STEP, "countdown 3");
        sfxRef.current("countdown-beep");
        const at = (ms: number, fn: () => void) => countTimers.current.push(window.setTimeout(fn, ms));
        countTimers.current.forEach((id) => window.clearTimeout(id));
        countTimers.current = [];
        at(STEP, () => {
            hold("point", STEP, "countdown 2");
            sfxRef.current("countdown-beep");
        });
        at(STEP * 2, () => {
            hold("fist", STEP, "countdown 1");
            sfxRef.current("countdown-beep");
        });
        at(STEP * 3, () => {
            // GO!: the game and the controls start now
            sfxRef.current("countdown-go");
            lastInput.current = performance.now();
            modeRef.current = "player";
            setModeState("player");
            hold("cheer", 1000, "GO", pick(LINES.go), true);
        });
        at(STEP * 4, () => (countRef.current = null));
    }, [hold, setBase, clearBoard]);
    startPlayerRef.current = startPlayer;

    // ---- Q asks before taking over: a bubble, then a meter that drains; any input from the visitor cancels it ----
    const startAsk = useCallback(() => {
        askRef.current = { on: true, left: ASK_MS };
        setAsking(true);
        setBoard(null);
        note("asks", "asks to take over");
        say("Hey, can I take over?", ASK_MS);
    }, [say, note]);
    const cancelAsk = useCallback(() => {
        if (!askRef.current.on) return;
        askRef.current.on = false;
        setAsking(false);
        lastInput.current = performance.now();
        reaction.current = null;
        say("Okay, carry on!", 1400);
    }, [say]);
    cancelAskRef.current = cancelAsk;
    startAskRef.current = startAsk;
    /** the meter emptied: "My turn!", the high scores for a few seconds, then he plays */
    const takeOver = useCallback(() => {
        askRef.current.on = false;
        setAsking(false);
        setScoreModal(null);
        modeRef.current = "attract";
        setModeState("attract");
        setPaused(false);
        setBase("idle", "taking over");
        hold("fist", 1300, "my turn", "My turn!");
        setBoardKey((k) => k + 1);
        setBoard("attract");
        window.clearTimeout(attractTimer.current);
        attractTimer.current = window.setTimeout(() => {
            if (modeRef.current === "attract") startBotRef.current();
        }, ATTRACT_MS);
    }, [hold, setBase]);
    takeOverRef.current = takeOver;
    const startBotRef = useRef<() => void>(() => {});
    startBotRef.current = () => startBot(false);
    const togglePause = useCallback(() => {
        const e = engine.current;
        if (!e) return;
        e.pause();
        const p = e.getGameState().isPaused;
        setPaused(p);
        setBoard(p ? "pause" : null);
        if (p) setBoardKey((k) => k + 1);
    }, []);
    const togglePauseRef = useRef(togglePause);
    togglePauseRef.current = togglePause;

    // ---- the game loop ----
    useEffect(() => {
        const eng = new Engine();
        engine.current = eng;
        const b = new QtrsAutoplayer(eng);
        bot.current = b;
        let raf = 0;
        let last = 0;
        let prevLines = 0;
        let prevRow = -99;
        let prevName = "";
        let prevHoles = 0;
        let prevScore = 0;
        let oopsAt = 0;
        let flashUntil = 0;
        let prevOver = false;
        let nextAmbient = performance.now() + 9000;
        let running = false;
        let onScreen = true;
        let visible = !document.hidden;
        let fontOk = false;

        const frame = (t: number) => {
            raf = requestAnimationFrame(frame);
            const dt = Math.min(50, t - last || 16);
            last = t;
            const m = modeRef.current;
            if (m === "bot") b.tick(t);
            if (m !== "count" && m !== "attract") eng.update(dt);
            // the takeover meter drains only while frames run, so it waits while the tab is hidden
            const ask = askRef.current;
            if (ask.on && (m === "player" || m === "over")) {
                ask.left -= dt;
                if (ask.left <= 0) takeOverRef.current();
            }
            const s = eng.getGameState();
            const p = s.currentPiece;

            // his eyes follow the active piece: the top third of the well looks up, the middle centred, the bottom third down
            {
                const live = (m === "bot" || m === "player") && !s.gameOver && !s.isPaused && p;
                const zone = !live ? 1 : p.row < 7 ? 0 : p.row < 14 ? 1 : 2;
                if (zone !== gaze.current.zone && t - gaze.current.since >= 150) gaze.current = { zone, since: t };
            }
            // lines cleared since the last frame (works for gravity locks, soft drops and hard drops alike)
            if (s.lines > prevLines) {
                const n = Math.min(4, s.lines - prevLines);
                if (m === "bot" || m === "player") sfxRef.current(n >= 4 ? "tetris" : "clear", m === "bot");
                pop.current = { text: POP[n], until: t + 1300 };
                flashUntil = t + 200;
                reactRef.current("clear", n);
            }
            prevLines = s.lines;
            if (s.score < prevScore) {
                // a new game began (the visitor pressed Start, or the bot reset)
                prevRow = -99;
                prevName = "";
                prevHoles = 0;
            }
            prevScore = s.score;

            // a new piece means the last one landed: how did it sit?
            const fresh = p && (p.row < prevRow || p.name !== prevName);
            if (fresh && !s.gameOver && prevName) {
                // a piece locked: the thunk (a hard drop already played its own sound, so it skips the thunk)
                if (m === "bot" || m === "player") {
                    if (skipThunk.current) skipThunk.current = false;
                    else sfxRef.current("thunk", m === "bot");
                }
                const g = gridFromPlayfield(s.playfield);
                const mt = measure(g);
                if (mt.holes > prevHoles && m === "bot" && t - oopsAt > 7000) {
                    oopsAt = t;
                    reactRef.current("oops");
                }
                if (mt.maxHeight >= (m === "bot" ? 14 : 16) && t - risingAt.current > 7000) {
                    risingAt.current = t;
                    reactRef.current("rising");
                }
                prevHoles = mt.holes;
            }
            if (p) {
                prevRow = p.row;
                prevName = p.name;
            }

            if (s.gameOver && !prevOver) {
                if (m === "bot") {
                    reactRef.current("topout");
                    window.clearTimeout(resetTimer.current);
                    resetTimer.current = window.setTimeout(() => {
                        if (modeRef.current !== "bot") return;
                        eng.reset();
                        b.reset();
                        prevLines = 0;
                        prevRow = -99;
                        prevName = "";
                        prevHoles = 0;
                        pop.current = null;
                        say("Again!", 1400);
                    }, 2600);
                } else if (m === "player") {
                    sfxRef.current("gameover");
                    overAt.current = t;
                    modeRef.current = "over";
                    setModeState("over");
                    reactRef.current("playerOver", 0, s.lines);
                    handleOver(s);
                }
            }
            if (!s.gameOver && prevOver) {
                prevLines = 0;
                prevRow = -99;
                prevName = "";
                prevHoles = 0;
            }
            prevOver = s.gameOver;

            if (m === "bot" && !s.gameOver && t > nextAmbient) {
                nextAmbient = t + 9000 + Math.random() * 8000;
                say(pick(LINES.ambient), 1800);
            }
            let count: Count | null = null;
            const cr = countRef.current;
            if (cr && t - cr.t0 < STEP * 4) {
                const step = Math.max(0, Math.floor((t - cr.t0) / STEP));
                count = { text: COUNT[step], age: t - cr.t0 - step * STEP, reduced: reduced.current };
            }
            if (canvasRef.current && fontOk) draw(canvasRef.current, s, modeRef.current, t, pop.current, t < flashUntil, count, askRef.current.on ? Math.max(0, askRef.current.left / ASK_MS) : null, (m === "bot" || m === "player") && !s.gameOver && !s.isPaused && !count && !boardRef.current ? eng.getGhostPiecePosition() : null, qboyRef.current, qTopRef.current);
        };

        const update = () => {
            const should = visible && onScreen;
            if (should && !running) {
                running = true;
                last = performance.now();
                raf = requestAnimationFrame(frame);
            } else if (!should && running) {
                running = false;
                cancelAnimationFrame(raf);
            }
        };
        const onVis = () => {
            visible = !document.hidden;
            update();
        };
        document.addEventListener("visibilitychange", onVis);
        const io = new IntersectionObserver(
            (e) => {
                onScreen = e[e.length - 1].isIntersecting;
                update();
            },
            { threshold: 0 }
        );
        if (stageRef.current) io.observe(stageRef.current);
        // the screen's element changes when the layout flips between desktop and QBOY
        observeRef.current = () => {
            io.disconnect();
            if (stageRef.current) io.observe(stageRef.current);
        };

        // the pixel font: draw only once it is ready, so the first frames are never in a fallback face
        (async () => {
            try {
                const f = new FontFace("QtrsCGA", `url(${baseRefA.current}/fonts/Web437_IBM_CGA.woff)`);
                await f.load();
                document.fonts.add(f);
                await document.fonts.ready;
            } catch {
                /* the monospace fallback is fine */
            }
            fontOk = true;
        })();

        const handleOver = (s: GameState) => {
            if (s.score < 50) return;
            const final = { score: s.score, level: s.level, lines: s.lines };
            // does it make the top 10? then ask for initials (as the Q.T.R.S. page does)
            store
                .list()
                .then((lb) => {
                    if (lb.length < 10 || final.score > lb[lb.length - 1]?.score) setScoreModal(final);
                })
                .catch(() => setScoreModal(final));
            window.clearTimeout(boardTimer.current);
            boardTimer.current = window.setTimeout(() => {
                if (modeRef.current === "over") setBoard("over");
            }, 1000);
        };

        update();
        reactRef.current("botStart");

        if (process.env.NODE_ENV !== "production") {
            window.__qtrs = {
                engine: eng,
                bot: b,
                log: log.current,
                mode: () => modeRef.current,
                frame: () => frameRef.current,
                startPlayer: () => startPlayerRef.current(),
                ask: () => startAskRef.current(),
                setBoard: (b: null | "pause" | "over" | "attract") => setBoard(b),
                askLeft: (ms?: number) => { if (ms !== undefined) askRef.current.left = ms; return askRef.current.left; },
                react: (k: Parameters<typeof react>[0], n?: number, extra?: number) => reactRef.current(k, n, extra),
                say: (t: string, ms?: number) => doSay.current(t, ms),
                base: (b: Base) => setBase(b, "dev"),
                audioLog: audioLog.current,
                sfx: (n: string, demo?: boolean) => sfxRef.current(n, demo),
                audio: () => ({ music: musicEl.current, voice: voiceEl.current }),
            };
        }

        return () => {
            cancelAnimationFrame(raf);
            document.removeEventListener("visibilitychange", onVis);
            io.disconnect();
            window.clearTimeout(resetTimer.current);
            window.clearTimeout(boardTimer.current);
            window.clearTimeout(attractTimer.current);
            window.clearTimeout(bubbleTimer.current);
            countTimers.current.forEach((id) => window.clearTimeout(id));
            engine.current = null;
            bot.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---- keys, idle, size ----
    useEffect(() => {
        const mark = () => {
            lastInput.current = performance.now();
        };
        const onKey = (e: KeyboardEvent) => {
            const el = e.target as HTMLElement | null;
            mark();
            cancelAskRef.current(); // any key is the visitor answering
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
            // a focused button or link keeps its own Enter and Space
            if (el && (el.tagName === "BUTTON" || el.tagName === "A") && (e.code === "Enter" || e.code === "Space")) return;
            const m = modeRef.current;
            const eng = engine.current;
            if (m === "count") {
                // the countdown ignores everything (Enter, Space and Escape do not skip it); the page must not scroll either
                if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
                return;
            }
            if (m === "attract") {
                if (e.code === "Enter" || e.code === "Space") {
                    e.preventDefault();
                    startPlayerRef.current();
                }
                return;
            }
            if (m === "bot") {
                if (e.code === "Enter" || e.code === "Space") {
                    e.preventDefault();
                    startPlayerRef.current();
                }
                return;
            }
            if (m === "over") {
                if (e.code === "Escape") setBoard(null);
                if (e.code === "Enter" || (e.code === "Space" && performance.now() - overAt.current > 1200)) {
                    e.preventDefault();
                    startPlayerRef.current();
                }
                return;
            }
            if (!eng) return;
            switch (e.code) {
                case "ArrowLeft":
                case "KeyA":
                    if (eng.moveLeft()) sfxRef.current("move");
                    break;
                case "ArrowRight":
                case "KeyD":
                    if (eng.moveRight()) sfxRef.current("move");
                    break;
                case "ArrowUp":
                case "KeyW":
                    if (eng.rotate()) sfxRef.current("rotate");
                    break;
                case "ArrowDown":
                case "KeyS":
                    eng.softDrop();
                    break;
                case "Space":
                    if (!pausedRef.current) {
                        skipThunk.current = true;
                        sfxRef.current("harddrop");
                    }
                    eng.hardDrop();
                    break;
                case "KeyP":
                    togglePauseRef.current();
                    break;
                default:
                    return;
            }
            e.preventDefault();
        };
        window.addEventListener("keydown", onKey);
        window.addEventListener("pointerdown", mark);
        const idle = window.setInterval(() => {
            const m = modeRef.current;
            if ((m === "player" || m === "over") && !askRef.current.on && !pausedRef.current && !scoreModalRef.current && !document.hidden && performance.now() - lastInput.current > IDLE_MS) startAskRef.current();
        }, 1000);
        const resize = () => {
            const cw = innerRef.current?.clientWidth ?? window.innerWidth;
            const narrow = window.innerWidth <= 820;
            setTouch(window.matchMedia("(pointer: coarse)").matches);
            setQboy(narrow);
            if (narrow) {
                // QBOY: edge to edge, the device is the viewport. The largest whole-number scale the lens fits; the safe areas (the notch
                // above, the home indicator below) come from env() through a probe, or from ?safe=top,bottom in development
                let sat = 0, sab = 0, sim = false;
                if (process.env.NODE_ENV !== "production") {
                    const m = /[?&]safe=(\d+),(\d+)/.exec(window.location.search);
                    if (m) [sat, sab, sim] = [+m[1], +m[2], true];
                }
                const probe = document.getElementById("qboy-safe");
                if (!sim && probe) {
                    const cs = getComputedStyle(probe);
                    sat = parseFloat(cs.paddingTop) || 0;
                    sab = parseFloat(cs.paddingBottom) || 0;
                }
                const bodyW = window.innerWidth;
                // the controls are fixed CSS-pixel sizes (the 390 phone is the reference: one render pixel = 390 / 538 px) so a thumb finds them
                // in the same place on every phone: the D-pad hugs the bottom left, the face cluster the bottom right, and extra width goes between
                const u = 390 / 538;
                const tall = window.innerHeight / window.innerWidth >= 1.95;
                const padTop = tall ? Math.max(sat, 47) : Math.max(sat, 46); // the band above the lens holds START and SOUND, so it never gets thinner than 46
                const padBottom = 0;
                const bodyH = window.innerHeight;
                // the home indicator zone: the controls' bottom edges never go lower than this
                const zone = (tall ? Math.max(sab, 34) : sab) + 8;
                const CB_F = 60, CB_D = 63; // the face cluster's and the D-pad's bottom edge above the device's bottom edge (half of the old 119 and 125)
                const CLUSTER_H = 160; // the face cluster is the tallest control block
                const LENS_H = 68; // 34 px strip above (logo, code) and below (back, QTRS) the display
                // the screen's left edge lines up with START's left edge and its right edge with the SOUND switch's right edge, on every phone
                                const left = 12, right = 12; // one inset from the device edge for the lens, START and SOUND
                let lw = bodyW - left - right;
                // ONE aspect ratio: the game (144 x 160) fills the display inside the lens exactly, at whatever scale that is (not whole numbers)
                let sc = (lw - 28) / W;
                let lh = H * sc + LENS_H;
                // the extra height comes out of the gap above the face buttons; the controls only drop toward the home zone when the screen needs the room
                const room = bodyH - padTop - 8 - CLUSTER_H;
                const cbf = Math.max(zone, Math.min(CB_F, room - lh));
                if (lh > room - cbf) {
                    // a very short phone: the screen keeps its ratio and gives up width
                    sc = (room - cbf - LENS_H) / H;
                    lh = H * sc + LENS_H;
                    lw = W * sc + 28;
                }
                const cbd = cbf + (CB_D - CB_F);
                const qw = W; // the standard 144 x 160 screen: the well, the wall and a readouts panel
                // Q scales with the game, as one unit: his figure is a fixed fraction (26.6%, his height at the 390 x 844 reference) of the display's height
                // at every phone size, whole device pixels or not
                const fig = sprite.baselineY - sprite.headTopY;
                const kq = (0.266 * H * sc) / fig;
                const kdev = kq;
                const showQ = fig * kq <= 0.45 * H * sc;
                qTopRef.current = H - (fig * kq) / sc;
                setQdim({ u: Math.round(u * 1000) / 1000, uc: Math.round(u * 1000) / 1000, lw, lh, cbf, cbd, qw, kq, kdev, showQ, pt: padTop, pb: padBottom, sat, sab, sim });
                setScale(sc);
                return;
            }
            // beside each other: the screen as tall as the window allows (a whole-number scale keeps its pixels crisp), QBOT in what is left
            // the words take the left column (340 px and the gap), so the screen and QBOT share what is left
            const avail = cw - 380;
            let sc = Math.max(2, Math.min(4, Math.floor((window.innerHeight - 28 - 60 - 150 - 80) / H)));
            while (sc > 2 && W * sc + 32 + 40 + 240 + 24 > avail) sc--;
            setScale(sc);
            setBh(bezelH(sc));
            setPk(spriteScale(sc, Math.floor((avail - W * sc - 32 - 40 - 24) / sprite.cellW)));
        };
        resize();
        window.addEventListener("resize", resize);
        const ro = typeof ResizeObserver === "undefined" || !innerRef.current ? null : new ResizeObserver(resize);
        if (ro && innerRef.current) ro.observe(innerRef.current);
        return () => {
            ro?.disconnect();
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("pointerdown", mark);
            window.removeEventListener("resize", resize);
            window.clearInterval(idle);
        };
    }, []);

    // the QBOY's bezel prints are Google Sans (OFL), fetched only when the handheld shows; a missing file falls back to the page's font
    useEffect(() => {
        if (!qboy) return;
        [500, 700].forEach(async (w) => {
            try {
                const g = new FontFace("QtrsGoogleSans", `url(${baseRefA.current}/fonts/google-sans-${w}-latin.woff2)`, { weight: String(w) });
                await g.load();
                document.fonts.add(g);
            } catch {
                /* fallback */
            }
        });
    }, [qboy]);

    // ---- the sprite: one frame at a time, picked ~25 times a second from the reaction, the talking and the base pose ----
    useEffect(() => {
        const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
        reduced.current = mq.matches;
        const onMq = () => (reduced.current = mq.matches);
        mq.addEventListener?.("change", onMq);
        let nextBlink = performance.now() + 3000 + Math.random() * 3000;
        let blinkUntil = 0;
        let nextThink = performance.now() + 3500 + Math.random() * 4000;
        let thinkUntil = 0;
        let mouth = 1;
        let mouthAt = 0;
        // PixelLab's Q: the breathing loop, a still body while he talks (the mouth frames are frame 0 plus a mouth patch), and a blink.
        // Reactions keep the loop. Reduced motion holds frame 0 with no flaps and no blink.
        const SHAPES = ["closed", "small", "open", "oo"] as const;
        let shape = 0;
        let shapeAt = 0;
        let shapeEvery = 100;
        let breathStart = performance.now();
        let wasTalking = false;
        let reacting = false;
        let blinkAt = performance.now() + 3000 + Math.random() * 3000;
        let blinkEnd = 0;
        const choosePx = (t: number): number => {
            if (reduced.current) {
                const rr = reaction.current;
                return rr && rr.anim && t < rr.until ? spritePx.animations[rr.anim].first + PX_STILL[rr.anim] : IDLE_ANIM.first;
            }
            const r = reaction.current;
            if (r && r.anim && t < r.until) {
                // a reaction plays once at its own rate, then holds its last frame while the bubble is up (no mouth, no blink)
                reacting = true;
                const a = spritePx.animations[r.anim];
                return a.first + Math.min(a.count - 1, Math.floor(((t - r.start) / 1000) * a.fps));
            }
            if (reacting) {
                // back to breathing from frame 0
                reacting = false;
                breathStart = t;
            }
            const k = talk.current;
            const talking = !!k && t >= k.from && t < k.until;
            const frameMs = 1000 / IDLE_ANIM.fps;
            let idx = 0;
            if (talking) {
                wasTalking = true;
                if (t - shapeAt >= shapeEvery) {
                    // a new shape about every 90 to 110 ms, never the same twice in a row
                    shapeAt = t;
                    shapeEvery = 90 + Math.random() * 20;
                    const next = [0, 1, 2, 3].filter((v) => v !== shape);
                    shape = next[Math.floor(Math.random() * next.length)];
                }
            } else {
                if (wasTalking) {
                    // end on closed and breathe again from frame 0
                    wasTalking = false;
                    shape = 0;
                    breathStart = t;
                }
                idx = Math.floor((t - breathStart) / frameMs) % IDLE_ANIM.count;
            }
            // a blink (about 120 ms) every 3 to 6 s, only while the body is on frame 0 and the frame has time left, so the eyes line up
            const into = (t - breathStart) % frameMs;
            if (t >= blinkAt && idx === 0 && (talking || into < frameMs - 130)) {
                blinkEnd = t + 120;
                blinkAt = t + 3000 + Math.random() * 3000;
            }
            const blinking = t < blinkEnd && (talking || idx === 0);
            const name = talking ? SHAPES[shape] : "closed";
            if (blinking) return spritePx.blink[name];
            return talking ? spritePx.talk[name] : IDLE_ANIM.first + idx;
        };
        const choose = (t: number): number => {
            if (PX) return choosePx(t);
            const r = reaction.current;
            if (r && t < r.until) {
                if (r.bounce && !reduced.current) return Math.floor(t / 260) % 2 ? F.fist : F.cheer;
                return POSE_FRAME[r.pose];
            }
            const k = talk.current;
            if (k && !reduced.current) {
                if (t >= k.from && t < k.until) {
                    // 8 to 10 changes a second, never the same shape twice, closed often enough to read as speech
                    if (t - mouthAt >= 100) {
                        mouthAt = t;
                        const opts = [0, 1, 1, 2, 2, 3].filter((v) => v !== mouth);
                        mouth = opts[Math.floor(Math.random() * opts.length)];
                    }
                    return F.talk[mouth];
                }
                if (t >= k.until && t < k.until + 260) return F.talk[0];
            }
            const base: Base = pausedRef.current && modeRef.current === "player" ? "idle" : baseRef.current;
            if (reduced.current) return base === "idle" ? F.idle : base === "play" ? F.play : F.watch;
            // the eyes: up, centred or down for the base poses that have the variants (frames 1, 4 and 5)
            const look = (f: number) => {
                const e = EYES[String(f)];
                const z = gaze.current.zone;
                return e && z !== 1 ? (z === 0 ? e.up : e.down) : f;
            };
            if (base === "idle") {
                // idle holds frame 1 perfectly still; only the blink (an eye-only patch on frame 1) ever plays
                if (t >= nextBlink) {
                    blinkUntil = t + 170;
                    nextBlink = t + 3000 + Math.random() * 3000;
                }
                return t < blinkUntil ? F.blink : look(F.idle);
            }
            if (base === "play") {
                if (t >= nextThink) {
                    thinkUntil = t + 900 + Math.random() * 700;
                    nextThink = thinkUntil + 3500 + Math.random() * 4000;
                }
                return t < thinkUntil ? F.think : look(F.play);
            }
            return look(F.watch);
        };
        const apply = (f: number) => {
            frameRef.current = f;
            const el = spriteRef.current;
            if (!el) return;
            el.style.setProperty("--col", String(f % sprite.cols));
            el.style.setProperty("--row", String(Math.floor(f / sprite.cols)));
            el.dataset.frame = String(f + 1);
        };
        apply(PX ? IDLE_ANIM.first : F.idle);
        const id = window.setInterval(() => {
            const f = choose(performance.now());
            if (f !== frameRef.current) apply(f);
        }, 20);
        return () => {
            window.clearInterval(id);
            mq.removeEventListener?.("change", onMq);
        };
    }, []);

    // ---- pixel-exact placement: his box sits on a whole device pixel (the layout can leave a fraction, e.g. a centred column) ----
    const snapSprite = useCallback(() => {
        const el = spriteRef.current;
        if (!el) return;
        el.style.setProperty("--dx", "0");
        el.style.setProperty("--dy", "0");
        const dpr = window.devicePixelRatio || 1;
        const r = el.getBoundingClientRect();
        const x = r.left + window.scrollX, y = r.top + window.scrollY;
        el.style.setProperty("--dx", String(Math.round(x * dpr) / dpr - x));
        el.style.setProperty("--dy", String(Math.round(y * dpr) / dpr - y));
    }, []);
    useEffect(() => {
        let id = 0;
        const later = () => {
            cancelAnimationFrame(id);
            id = requestAnimationFrame(snapSprite);
        };
        later();
        window.addEventListener("resize", later);
        const ro = typeof ResizeObserver === "undefined" || !innerRef.current ? null : new ResizeObserver(later);
        if (ro && innerRef.current) ro.observe(innerRef.current);
        return () => {
            cancelAnimationFrame(id);
            window.removeEventListener("resize", later);
            ro?.disconnect();
        };
    }, [pk, bh, scale, snapSprite]);

    // ---- sound: restore the choice, the first-visit coach tip, pause with the tab and the game ----
    useEffect(() => {
        let on = false;
        let reminded = true;
        try {
            on = localStorage.getItem(SND_KEY) === "1";
            reminded = localStorage.getItem(COACH_KEY) === "1";
        } catch {
            /* storage can be off */
        }
        let t1 = 0;
        let t2 = 0;
        const retry = () => {
            // a stored "on" cannot autoplay until the first gesture
            ensureSfx();
            syncMusic();
        };
        if (on) {
            soundRef.current = true;
            setSoundOn(true);
            ensureAudio();
            syncMusic();
            window.addEventListener("pointerdown", retry, { once: true });
            window.addEventListener("keydown", retry, { once: true });
        } else if (!reminded) {
            t1 = window.setTimeout(() => {
                setCoach(true);
                try {
                    localStorage.setItem(COACH_KEY, "1");
                } catch {
                    /* storage can be off */
                }
                t2 = window.setTimeout(() => setCoach(false), 7000);
            }, 3000);
        }
        const onVis = () => syncMusic();
        document.addEventListener("visibilitychange", onVis);
        return () => {
            window.clearTimeout(t1);
            window.clearTimeout(t2);
            document.removeEventListener("visibilitychange", onVis);
            window.removeEventListener("pointerdown", retry);
            window.removeEventListener("keydown", retry);
            stopSound();
        };
    }, [ensureAudio, ensureSfx, syncMusic, stopSound]);
    useEffect(() => {
        syncMusic();
    }, [paused, syncMusic]);

    // ---- touch: swipe left or right to move, tap to turn, swipe down to drop (swipeDetection.ts), on the screen itself ----
    useEffect(() => {
        observeRef.current();
        if (!qboy) return;
        // the handheld never scrolls
        const h = document.documentElement, b = document.body;
        const was = [h.style.overflow, b.style.overflow, h.style.background, b.style.background];
        h.style.overflow = "hidden";
        b.style.overflow = "hidden";
        // a phone in a dark room: black behind the device, including the overscroll area
        h.style.background = "#000";
        b.style.background = "#000";
        window.dispatchEvent(new Event("resize")); // the safe-area probe exists now: measure again
        return () => {
            h.style.overflow = was[0];
            b.style.overflow = was[1];
            h.style.background = was[2];
            b.style.background = was[3];
        };
    }, [qboy]);

    const act = useCallback(
        (a: "left" | "right" | "down" | "rotate" | "drop") => {
            if (modeRef.current === "count") return;
            lastInput.current = performance.now();
            if (modeRef.current === "bot" || modeRef.current === "over" || modeRef.current === "attract") {
                startPlayerRef.current();
                return;
            }
            const e = engine.current;
            if (!e) return;
            if (a === "left") {
                if (e.moveLeft()) sfxRef.current("move");
            } else if (a === "right") {
                if (e.moveRight()) sfxRef.current("move");
            } else if (a === "down") e.softDrop();
            else if (a === "rotate") {
                if (e.rotate()) sfxRef.current("rotate");
            } else {
                if (!pausedRef.current) {
                    skipThunk.current = true;
                    sfxRef.current("harddrop");
                }
                e.hardDrop();
            }
        },
        []
    );
    useEffect(() => {
        const el = screenRef.current;
        if (!el || qboy) return; // QBOY has buttons, not swipes (a tap on the screen in the demo still takes over, through the canvas's click)
        const sw = new SwipeDetector();
        const start = (e: TouchEvent) => sw.handleTouchStart(e);
        const move = (e: TouchEvent) => {
            if (modeRef.current === "player") sw.handleTouchMove(e);
        };
        const end = (e: TouchEvent) => {
            const g = sw.handleTouchEnd(e);
            if (!g.direction) return;
            if (modeRef.current !== "player") {
                if (g.direction === "tap" || g.direction === "doubletap") act("rotate"); // a tap on the screen starts the game
                return;
            }
            if (g.direction === "left" || g.direction === "right") act(g.direction);
            else if (g.direction === "down") act("drop");
            else act("rotate"); // tap, double tap or swipe up
        };
        el.addEventListener("touchstart", start, { passive: true });
        el.addEventListener("touchmove", move, { passive: false });
        el.addEventListener("touchend", end, { passive: true });
        return () => {
            el.removeEventListener("touchstart", start);
            el.removeEventListener("touchmove", move);
            el.removeEventListener("touchend", end);
        };
    }, [act, qboy]);

    const onStartButton = () => {
        if (modeRef.current === "count") return;
        if (modeRef.current === "player") togglePause();
        else startPlayer();
    };

    // ---- QBOY's buttons: pointer events, a short buzz where the device has one, DAS then ARR for the repeating ones (the keyboard gets
    // the same from the operating system's key repeat, since the engine itself has no auto-repeat) ----
    const goBack = useCallback(() => {
        window.location.assign(home);
    }, [home]);
    const goBackRef = useRef(goBack);
    goBackRef.current = goBack;
    const onStartRef = useRef(onStartButton);
    onStartRef.current = onStartButton;
    const holdTimers = useRef({ das: 0, arr: 0 });
    const stopHold = useCallback(() => {
        window.clearTimeout(holdTimers.current.das);
        window.clearInterval(holdTimers.current.arr);
        setPressed(null);
    }, []);
    useEffect(() => stopHold, [stopHold]);
    const runPad = useCallback((name: PadName) => {
        lastInput.current = performance.now();
        cancelAskRef.current();
        const m = modeRef.current;
        if (m !== "player") {
            return;
        }
        const e = engine.current;
        if (!e) return;
        if (name === "left") {
            if (e.moveLeft()) sfxRef.current("move");
        } else if (name === "right") {
            if (e.moveRight()) sfxRef.current("move");
        } else if (name === "down") e.softDrop();
        else if (name === "up") {
            if (!pausedRef.current) {
                skipThunk.current = true;
                sfxRef.current("harddrop");
            }
            e.hardDrop();
        } else if (name === "n2" || name === "n3") {
            if (e.rotateCCW()) sfxRef.current("rotate"); // the left and right face buttons turn the piece counterclockwise
        } else if (e.rotate()) sfxRef.current("rotate"); // the top and bottom face buttons turn it clockwise
    }, []);
    const padDown = (name: PadName | "start" | "sound") => (e: React.PointerEvent<HTMLButtonElement>) => {
        e.preventDefault();
        stopHold();
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
            /* not every browser captures */
        }
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(8);
        setPressed(name);
        if (name === "start") onStartRef.current();
        else if (name === "sound") toggleSound();
        else {
            runPad(name);
            if (name === "left" || name === "right" || name === "down") {
                holdTimers.current.das = window.setTimeout(() => {
                    holdTimers.current.arr = window.setInterval(() => runPad(name), name === "down" ? 45 : 55);
                }, 170);
            }
        }
    };
    const padProps = (name: PadName | "start" | "sound") => ({
        onPointerDown: padDown(name),
        onPointerUp: stopHold,
        onPointerCancel: stopHold,
        onLostPointerCapture: stopHold,
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
        "data-pressed": pressed === name ? "true" : undefined,
    });

    const submitScore = async (initials: string) => {
        if (!scoreModal) return;
        setSubmitting(true);
        try {
            await store.submit({ initials, ...scoreModal });
            setScoreModal(null);
            setBoardKey((k) => k + 1);
            setBoard("over");
        } finally {
            setSubmitting(false);
        }
    };

    pausedRef.current = paused;
    boardRef.current = board;
    scoreModalRef.current = !!scoreModal;
    const label = mode === "bot" ? "Click to Play" : mode === "count" ? "Get ready" : mode === "over" ? "Play again" : paused ? "Resume" : "Pause";

    const goHome = (
        <a className={styles.home} href={home}>
            Go home
        </a>
    );
    const links = onRetry ? (
        <span className={styles.links}>
            {goHome}
            <button type="button" className={styles.homeBtn} onClick={onRetry}>
                Try again
            </button>
        </span>
    ) : (
        goHome
    );
    const keys = touch ? "Swipe left or right to move, tap to turn, swipe down to drop." : "Enter to start. Arrows or A and D to move, up or W to turn, down or S to soften the drop, Space to drop, P to pause.";
    // the controls as a list, one per line, for the left column (Q, 2026-10-20)
    const keyRows: [string, string][] = touch
        ? [["Swipe ← →", "Move"], ["Tap", "Turn"], ["Swipe ↓", "Drop"]]
        : [["Enter", "Start"], ["← → or A D", "Move"], ["↑ or W", "Turn"], ["↓ or S", "Soft drop"], ["Space", "Hard drop"], ["P", "Pause"]];
    const keyList = (
        <span key="keys" className={styles.keysLeft} role="list" aria-label="Controls">
            {keyRows.map(([k, v]) => (
                <span key={k} role="listitem" className={styles.keyRow}>
                    <kbd className={styles.kbd}>{k}</kbd>
                    <span>{v}</span>
                </span>
            ))}
        </span>
    );

    if (qboy) {
        const showAttract = mode === "bot" && !board && !asking;
        const pos = (x: number, y: number) => ({ "--x": x, "--y": y }) as CSSProperties;
        const dir = pressed === "up" || pressed === "down" || pressed === "left" || pressed === "right" ? pressed : undefined;
        // a round button as in Q's closeups: a cap in a dark socket ring with a short visible sidewall and a soft contact shadow to the
        // lower right (light from the upper left). Top and left caps are concave dishes (glossy: shaded along the top inner edge, a crisp
        // specular low in the dish); right and bottom caps are convex domes (matte). Pressed, the cap sinks nearly flush: the sidewall goes
        // and the upper-left socket wall deepens.
        // the faces: each cap stands in the sound slot's well (a light lip, a dark ring, a dark floor with an inner shadow); the sidewall is the cap's
        // footprint stacked downward, a soft cast shadow falls to the lower right inside the well. The convex cap itself is unchanged.
        const faceWell = (
            <>
                <circle cx="53" cy="56" r="50" fill="#000" opacity="0.22" filter="url(#qbBlur3)" />
                <circle cx="50" cy="51" r="49" fill="url(#qbSlotLip)" />
                <circle cx="50" cy="51" r="47.2" fill="#26262a" />
                <circle cx="50" cy="51" r="45.6" fill="url(#qbWellFloor)" />
            </>
        );
        const faceShadow = (r: number) => (
            <g clipPath="url(#qbFaceWellClip)">
                <circle cx="50" cy="51" r="46" fill="none" stroke="#000" strokeWidth="7" opacity="0.5" filter="url(#qbBlur3)" transform="translate(1.2 2.4)" />
                <g className={styles.fcast}>
                    <circle cx="53" cy="58" r={r} fill="#000" opacity="0.6" filter="url(#qbBlur3)" />
                    <circle cx="50" cy="57" r={r - 1} fill="#000" opacity="0.7" filter="url(#qbBlur1)" />
                </g>
            </g>
        );
        const capArt = (concave: boolean) =>
            concave ? (
                <svg className={styles.dish} viewBox="0 0 100 100" aria-hidden="true">
                    {faceWell}
                    {faceShadow(40.9)}
                    <g className={styles.wall}>
                            <circle cx="49.0" cy="48.5" r="40.9" fill="#77777a" />
                            <circle cx="49.15" cy="49.5" r="40.9" fill="#6a6a6d" />
                            <circle cx="49.3" cy="50.5" r="40.9" fill="#5d5d60" />
                            <circle cx="49.45" cy="51.5" r="40.9" fill="#505053" />
                            <circle cx="49.6" cy="52.5" r="40.9" fill="#444447" />
                            <circle cx="49.75" cy="53.5" r="40.9" fill="#3a3a3c" />
                            <circle cx="49.9" cy="54.5" r="40.9" fill="#303032" />
                            <circle cx="50.05" cy="55.5" r="40.9" fill="#28282a" />
                    </g>
                    <g className={styles.cap}>
                        <g transform="translate(49 48.5) scale(0.88) translate(-50 -50)">
                            <circle cx="50" cy="50" r="46.5" fill="url(#qbRimLight)" />
                            <circle cx="50" cy="50" r="36.5" fill="url(#qbSatinDish)" />
                            <circle cx="50" cy="50" r="36.5" fill="none" stroke="#4a4a4c" strokeWidth="1.4" opacity="0.55" clipPath="url(#qbTopLeftClip100)" />
                        </g>
                    </g>
                </svg>
            ) : (
                <svg className={styles.dish} viewBox="0 0 100 100" aria-hidden="true">
                    {faceWell}
                    {faceShadow(39.5)}
                    <g className={styles.wall}>
                            <circle cx="49.0" cy="48.5" r="39.5" fill="#77777a" />
                            <circle cx="49.15" cy="49.5" r="39.5" fill="#6a6a6d" />
                            <circle cx="49.3" cy="50.5" r="39.5" fill="#5d5d60" />
                            <circle cx="49.45" cy="51.5" r="39.5" fill="#505053" />
                            <circle cx="49.6" cy="52.5" r="39.5" fill="#444447" />
                            <circle cx="49.75" cy="53.5" r="39.5" fill="#3a3a3c" />
                            <circle cx="49.9" cy="54.5" r="39.5" fill="#303032" />
                            <circle cx="50.05" cy="55.5" r="39.5" fill="#28282a" />
                    </g>
                    <g className={styles.cap}>
                        <circle cx="49" cy="48.5" r="39.5" fill="url(#qbDome)" />
                        <ellipse className={styles.hl} cx="38" cy="32" rx="21" ry="12" fill="url(#qbSoft)" />
                        <circle cx="49" cy="48.5" r="39.5" fill="none" stroke="#fff" strokeWidth="1" opacity="0.35" />
                    </g>
                </svg>
            );
        const startArt = (
            <span className={styles.sRing} aria-hidden="true">
                <span className={styles.sSocket} />
                <span className={styles.sCap} />
            </span>
        );
        return (
            <div className={styles.qboyRoot} style={{ "--qtrs-plastic": `url(${base}/qboy-plastic.webp)`, "--qtrs-qboy-logo": `url(${base}/qboy-logo.svg)`, "--qtrs-logo": `url(${base}/qtrs-logo.svg)` } as CSSProperties}>
                <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
                    <defs>
                        <radialGradient id="qbContact" cx="50%" cy="50%" r="50%"><stop offset="0.8" stopColor="#000" stopOpacity="0.3" /><stop offset="1" stopColor="#000" stopOpacity="0" /></radialGradient>
                        <radialGradient id="qbSocket" cx="62%" cy="64%" r="70%"><stop offset="0.5" stopColor="#242425" /><stop offset="1" stopColor="#0f0f10" /></radialGradient>
                        <radialGradient id="qbDome" cx="35%" cy="29%" r="80%"><stop offset="0" stopColor="#f3f3f3" /><stop offset="0.4" stopColor="#d2d2d3" /><stop offset="0.8" stopColor="#a2a2a4" /><stop offset="1" stopColor="#8c8c8e" /></radialGradient>
                        <radialGradient id="qbConcave" cx="62%" cy="68%" r="82%"><stop offset="0" stopColor="#ececec" /><stop offset="0.5" stopColor="#cfcfd0" /><stop offset="0.85" stopColor="#a6a6a8" /><stop offset="1" stopColor="#7e7e80" /></radialGradient>
                        <radialGradient id="qbSoft" cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#fff" stopOpacity="0.55" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
                        <radialGradient id="qbMachined" cx="40%" cy="32%" r="80%"><stop offset="0" stopColor="#ededee" /><stop offset="0.6" stopColor="#c7c7c9" /><stop offset="1" stopColor="#9a9a9c" /></radialGradient>
                        <linearGradient id="qbCross" x1="0" y1="0" x2="0.7" y2="1"><stop offset="0" stopColor="#d6d6d7" /><stop offset="1" stopColor="#bcbcbd" /></linearGradient>
                        <radialGradient id="qbDpadShadow" cx="50%" cy="50%" r="60%"><stop offset="0.7" stopColor="#000" stopOpacity="0.28" /><stop offset="1" stopColor="#000" stopOpacity="0" /></radialGradient>
                        <linearGradient id="qbRimLight" x1="0.1" y1="0.05" x2="0.9" y2="0.95"><stop offset="0" stopColor="#fbfbfb" /><stop offset="0.55" stopColor="#d4d4d6" /><stop offset="1" stopColor="#a2a2a5" /></linearGradient>
                        <radialGradient id="qbSatinDish" cx="68%" cy="70%" r="85%"><stop offset="0" stopColor="#dedee0" /><stop offset="0.6" stopColor="#c1c1c3" /><stop offset="1" stopColor="#a4a4a7" /></radialGradient>
                        <clipPath id="qbTopLeftClip100"><rect x="0" y="0" width="50" height="50" /></clipPath>
                        <linearGradient id="qbStep" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#a7a7a9" /><stop offset="1" stopColor="#dcdcde" /></linearGradient>
                        <linearGradient id="qbCrossFlat" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#d9d9db" /><stop offset="1" stopColor="#c4c4c6" /></linearGradient>
                        <radialGradient id="qbDisc" cx="40%" cy="35%" r="75%"><stop offset="0" stopColor="#d7d7d9" /><stop offset="1" stopColor="#b4b4b7" /></radialGradient>
                        <linearGradient id="qbOrangeDeep" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d85f06" /><stop offset="0.3" stopColor="#f77a12" /><stop offset="1" stopColor="#f07210" /></linearGradient>
                        <linearGradient id="qbOrangeEdge" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#7a2d00" stopOpacity="0.55" /><stop offset="0.12" stopColor="#7a2d00" stopOpacity="0" /><stop offset="0.9" stopColor="#7a2d00" stopOpacity="0" /><stop offset="1" stopColor="#7a2d00" stopOpacity="0.5" /></linearGradient>
                        <linearGradient id="qbFalloff" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#5a1f00" stopOpacity="0" /><stop offset="1" stopColor="#5a1f00" stopOpacity="0.55" /></linearGradient>
                        <linearGradient id="qbEdgeHi" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity="0.95" /><stop offset="0.45" stopColor="#fff" stopOpacity="0.7" /><stop offset="0.6" stopColor="#fff" stopOpacity="0" /></linearGradient>
                        <linearGradient id="qbEdgeLo" x1="0" y1="0" x2="1" y2="1"><stop offset="0.4" stopColor="#6c6c6f" stopOpacity="0" /><stop offset="0.55" stopColor="#6c6c6f" stopOpacity="0.45" /><stop offset="1" stopColor="#5a5a5d" stopOpacity="0.6" /></linearGradient>
                        <clipPath id="qbFaceWellClip"><circle cx="50" cy="51" r="45.6" /></clipPath>
                        <linearGradient id="qbTiltUp" gradientUnits="userSpaceOnUse" x1="97.5" y1="0" x2="97.5" y2="195"><stop offset="0" stopColor="#000" stopOpacity="0.34" /><stop offset="0.5" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#fff" stopOpacity="0.22" /></linearGradient>
                        <linearGradient id="qbTiltDown" gradientUnits="userSpaceOnUse" x1="97.5" y1="195" x2="97.5" y2="0"><stop offset="0" stopColor="#000" stopOpacity="0.34" /><stop offset="0.5" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#fff" stopOpacity="0.22" /></linearGradient>
                        <linearGradient id="qbTiltLeft" gradientUnits="userSpaceOnUse" x1="0" y1="97.5" x2="195" y2="97.5"><stop offset="0" stopColor="#000" stopOpacity="0.34" /><stop offset="0.5" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#fff" stopOpacity="0.22" /></linearGradient>
                        <linearGradient id="qbTiltRight" gradientUnits="userSpaceOnUse" x1="195" y1="97.5" x2="0" y2="97.5"><stop offset="0" stopColor="#000" stopOpacity="0.34" /><stop offset="0.5" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#fff" stopOpacity="0.22" /></linearGradient>
                        <clipPath id="qbSwClip"><rect x="4" y="4.5" width="104" height="40" rx="20" /></clipPath>
                        <filter id="qbSwBlur" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="1.6" /></filter>
                        <linearGradient id="qbSlotGrey" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#b9b9bc" /><stop offset="0.35" stopColor="#d2d2d4" /><stop offset="1" stopColor="#dedee0" /></linearGradient>
                        <linearGradient id="qbInnerShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#000" stopOpacity="0.38" /><stop offset="0.28" stopColor="#000" stopOpacity="0.06" /><stop offset="1" stopColor="#000" stopOpacity="0" /></linearGradient>
                        <filter id="qbBlur1" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1" /></filter>
                        <filter id="qbBlur3" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" /></filter>
                        <linearGradient id="qbWellFloor" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#050506" /><stop offset="1" stopColor="#1b1b1d" /></linearGradient>
                        <radialGradient id="qbDish" gradientUnits="userSpaceOnUse" cx="97.5" cy="97.5" r="46"><stop offset="0" stopColor="#000" stopOpacity="0.07" /><stop offset="1" stopColor="#000" stopOpacity="0" /></radialGradient>
                        <pattern id="qbTex" width="200" height="200" patternUnits="userSpaceOnUse"><image href={`${base}/qboy-plastic.webp`} width="200" height="200" /></pattern>
                        <clipPath id="qbWellClip"><path d={plusPath(3.4, 11.6, 6.6)} /></clipPath>
                        <radialGradient id="qbCrossDish" cx="50%" cy="50%" r="72%"><stop offset="0" stopColor="#b3b3b5" /><stop offset="0.45" stopColor="#c8c8ca" /><stop offset="1" stopColor="#dedee0" /></radialGradient>
                        <radialGradient id="qbDimpleLow" cx="50%" cy="60%" r="60%"><stop offset="0" stopColor="#a4a4a6" /><stop offset="1" stopColor="#bcbcbe" /></radialGradient>
                        <clipPath id="qbBotRightClip"><rect x="97.5" y="97.5" width="97.5" height="97.5" /></clipPath>
                        <linearGradient id="qbSlotLip" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7d7d7f" /><stop offset="1" stopColor="#e8e8e9" /></linearGradient>
                        <linearGradient id="qbOrange" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f77d12" /><stop offset="1" stopColor="#e6620a" /></linearGradient>
                        <linearGradient id="qbTab" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ebebec" /><stop offset="1" stopColor="#b4b4b6" /></linearGradient>
                        <clipPath id="qbArmUp"><rect x="0" y="0" width="195" height="65" /></clipPath>
                        <clipPath id="qbArmDown"><rect x="0" y="130" width="195" height="65" /></clipPath>
                        <clipPath id="qbArmLeft"><rect x="0" y="0" width="65" height="195" /></clipPath>
                        <clipPath id="qbArmRight"><rect x="130" y="0" width="65" height="195" /></clipPath>
                    </defs>
                </svg>
                <div id="qboy-safe" className={styles.safeProbe} aria-hidden="true" />
                <div className={styles.qboyBody} style={{ "--s": scale, "--u": qdim.u, "--lw": qdim.lw + "px", "--lh": qdim.lh + "px", "--cbf": qdim.cbf + "px", "--cbd": qdim.cbd + "px", "--qw": qdim.qw, "--pt": qdim.pt + "px", "--pb": qdim.pb + "px", ...(qdim.sim ? { "--sat": qdim.sat + "px", "--sab": qdim.sab + "px" } : {}) } as CSSProperties}>
                    <div className={styles.qboyBand} style={{ "--u": qdim.u } as CSSProperties}>
                        <div className={styles.bandL}>
                            <button type="button" className={styles.bandStart} aria-label={mode === "bot" ? "Start: play" : mode === "over" ? "Start: play again" : paused ? "Start: resume" : "Start: pause"} {...padProps("start")}>
                                {startArt}
                            </button>
                            <span className={styles.bandLbl}>{mode === "player" && !paused ? "Pause" : "Start"}</span>
                        </div>
                        <div className={styles.bandR}>
                            <span className={styles.bandLbl}>Sound</span>
                            <button type="button" role="switch" aria-checked={soundOn} className={styles.bandSw} aria-label="Sound" {...padProps("sound")}>
                                <svg viewBox="0 0 112 48" aria-hidden="true">
                                    <rect x="0.5" y="0.5" width="111" height="47" rx="23.5" fill="url(#qbSlotLip)" />
                                    <rect x="2.2" y="2.2" width="107.6" height="43.6" rx="21.8" fill="#26262a" />
                                    {/* the interior is clipped to the slot alone; the slot's lip and the tab render free */}
                                    <g clipPath="url(#qbSwClip)">
                                        {soundOn ? (
                                            <>
                                                <rect x="4" y="4.5" width="104" height="40" fill="url(#qbOrangeDeep)" />
                                                <rect x="4" y="4.5" width="104" height="40" fill="url(#qbOrangeEdge)" />
                                            </>
                                        ) : (
                                            <rect x="4" y="4.5" width="104" height="40" fill="url(#qbSlotGrey)" />
                                        )}
                                        <rect x="4" y="4.5" width="104" height="40" fill="url(#qbInnerShade)" />
                                        <rect x="4" y="4.5" width="104" height="40" rx="20" fill="none" stroke="#000" strokeWidth="3" opacity="0.4" filter="url(#qbSwBlur)" />
                                        <g className={styles.knob} data-on={soundOn ? "true" : "false"}>
                                            <rect x="-4" y="6" width="26" height="36" fill="url(#qbFalloff)" className={styles.fall} opacity={soundOn ? 1 : 0.45} />
                                            <rect x="9" y="10" width="58" height="36" rx="18" fill="#000" opacity="0.45" filter="url(#qbSwBlur)" />
                                        </g>
                                    </g>
                                    <g className={styles.knob} data-on={soundOn ? "true" : "false"}>
                                        <rect x="5.5" y="6" width="58" height="36" rx="18" fill="url(#qbTab)" />
                                        <rect x="6.3" y="6.8" width="56.4" height="34.4" rx="17.2" fill="none" stroke="#fff" strokeWidth="1.6" opacity="0.75" />
                                        <rect x="5.5" y="6" width="58" height="36" rx="18" fill="none" stroke="#6f6f72" strokeWidth="0.9" />
                                        {[20.5, 27.5, 34.5, 41.5, 48.5].map((x) => (
                                            <g key={x}>
                                                <rect x={x - 1.6} y="13" width="3.2" height="22" rx="1.4" fill="#8f8f92" />
                                                <rect x={x - 1.6} y="13" width="1.2" height="22" rx="0.6" fill="#fff" opacity="0.75" />
                                                <rect x={x + 0.6} y="13" width="1" height="22" rx="0.5" fill="#000" opacity="0.35" />
                                            </g>
                                        ))}
                                    </g>
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div className={styles.qboyLens}>
                        <div ref={stageRef} className={styles.qboyScreenBox}>
                            <div ref={screenRef} className={styles.screen + (mode === "bot" ? " " + styles.demo : "")} onPointerDown={() => cancelAskRef.current()}>
                                <canvas
                                    ref={canvasRef}
                                    width={qdim.qw}
                                    height={H}
                                    aria-label="Q.T.R.S. game screen"
                                    role="img"
                                    onClick={() => {
                                        if (modeRef.current === "bot") startPlayerRef.current();
                                    }}
                                />
                                {qdim.showQ && (
                                    <div className={styles.qboyQ} style={{ "--k": qdim.kq, "--figc": 91.5, "--cw": sprite.cellW, "--ch": sprite.cellH, "--cols": sprite.cols, "--rows": sprite.rows, "--base": sprite.baselineY } as CSSProperties}>
                                        <div ref={spriteRef} className={styles.sprite} role="img" aria-label="QBOT, a pixel-art portrait of Q" style={{ backgroundImage: `url(${spriteSrcMono})` }} />
                                    </div>
                                )}
                                {bubble && (
                                    <div key={bubble.id} className={styles.qboyBubble} style={{ "--qfig": (sprite.baselineY - sprite.headTopY) * qdim.kq + "px" } as CSSProperties} role="status" aria-live="polite">
                                        {bubble.text}
                                    </div>
                                )}
                                {showAttract && (
                                    <div className={styles.qboyPress} aria-hidden="true">
                                        <span>PRESS</span>
                                        <span>START</span>
                                    </div>
                                )}
                                {board && (
                                    <div className={styles.overlay}>
                                        <PixelScores
                                        store={store}
                                            key={board + boardKey}
                                            kicker={board === "pause" ? "PAUSED" : board === "attract" ? "QBOT IS NEXT" : undefined}
                                            onClose={board === "over" ? () => setBoard(null) : undefined}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                        <i className={styles.lensSheen} />
                        <span className={styles.lensLogo} role="img" aria-label="QBOY" />
                        <span className={styles.lensCode}>{code === "qtrs" ? "Q.T.R.S." : "ER " + code}</span>
                        <a
                            className={styles.lensBack}
                            href={home}
                            aria-label="Home"
                            onClick={(e) => {
                                e.preventDefault();
                                goBack();
                            }}
                        >
                            <span>&larr; Home</span>
                        </a>
                        <span className={styles.lensQtrs} role="img" aria-label="QTRS" />
                    </div>
                    <div className={styles.qboyCtl} style={{ "--u": qdim.uc } as CSSProperties}>
                        <div className={styles.dpad} data-dir={dir} role="group" aria-label="Directional pad">
                            <svg className={styles.dpadArt} viewBox="0 0 195 195" aria-hidden="true">
                                {/* the well: the sound slot's recess, following the cross: a light lip (crisp at the bottom), a dark top inner edge, a dark floor with an inner shadow */}
                                <path d={plusPath(-3, 17, 11)} fill="#000" opacity="0.2" filter="url(#qbBlur3)" />
                                <path d={plusPath(0, 15, 10)} fill="url(#qbSlotLip)" />
                                <path d={plusPath(1.8, 13.2, 8.2)} fill="#26262a" />
                                <path d={plusPath(3.4, 11.6, 6.6)} fill="url(#qbWellFloor)" />
                                <g clipPath="url(#qbWellClip)">
                                    <path d={plusPath(0, 15, 10)} fill="none" stroke="#000" strokeWidth="9" opacity="0.55" filter="url(#qbBlur3)" transform="translate(1.5 3)" />
                                    <g className={styles.dpadCast}>
                                        <path d={plusPath(8.4, 9, 6)} fill="#000" opacity="0.6" filter="url(#qbBlur3)" transform="translate(4 7)" />
                                        <path d={plusPath(8.4, 9, 6)} fill="#000" opacity="0.7" filter="url(#qbBlur1)" transform="translate(0.5 8)" />
                                    </g>
                                </g>
                                <g className={styles.dpadTop}>
                                    {/* the sidewall: the plate's footprint stacked downward, from the cap-edge tone to dark grey at the base */}
                                    <g transform="translate(0 -3)">
                                    <path d={plusPath(8.4, 9, 6)} fill="#2e2e30" transform="translate(0 6)" />
                                    <path d={plusPath(8.4, 9, 6)} fill="#3c3c3e" transform="translate(0 5)" />
                                    <path d={plusPath(8.4, 9, 6)} fill="#505053" transform="translate(0 4)" />
                                    <path d={plusPath(8.4, 9, 6)} fill="#6f6f72" transform="translate(0 3)" />
                                    <path d={plusPath(8.4, 9, 6)} fill="#8f8f92" transform="translate(0 2)" />
                                    <path d={plusPath(8.4, 9, 6)} fill="#a9a9ac" transform="translate(0 1)" />
                                    <path d={plusPath(8.4, 9, 6)} fill="#b8b8bb" transform="translate(0 0)" />
                                    </g>
                                    <g transform="translate(0 -3)">
                                        <path d={plusPath(8.4, 9, 6)} fill="url(#qbCrossFlat)" />
                                        <path d={plusPath(8.4, 9, 6)} fill="url(#qbTex)" opacity="0.55" style={{ mixBlendMode: "soft-light" }} />
                                        <path d={plusPath(8.4, 9, 6)} fill="url(#qbDish)" />
                                        <path d={plusPath(10.6, 7, 4)} fill="none" stroke="url(#qbEdgeHi)" strokeWidth="4.4" opacity="0.95" />
                                        <path d={plusPath(8.4, 9, 6)} fill="none" stroke="url(#qbEdgeLo)" strokeWidth="2" transform="translate(-0.6 -0.8)" />
                                        <path className={styles.tilt} data-arm="up" d={plusPath(8.4, 9, 6)} fill="url(#qbTiltUp)" />
                                        <path className={styles.tilt} data-arm="down" d={plusPath(8.4, 9, 6)} fill="url(#qbTiltDown)" />
                                        <path className={styles.tilt} data-arm="left" d={plusPath(8.4, 9, 6)} fill="url(#qbTiltLeft)" />
                                        <path className={styles.tilt} data-arm="right" d={plusPath(8.4, 9, 6)} fill="url(#qbTiltRight)" />
                                        <circle cx="97.5" cy="97.5" r="19.8" fill="#fff" opacity="0.7" transform="translate(0 1.2)" />
                                        <circle cx="97.5" cy="97.5" r="19.2" fill="#2a2a2c" />
                                        <circle cx="97.5" cy="97.5" r="17.9" fill="url(#qbDisc)" />
                                        <path d="M80.5 99A17 17 0 0 0 112 107" fill="none" stroke="#fff" strokeWidth="1.2" opacity="0.55" />
                                        <path d="M82 92A16.5 16.5 0 0 1 108 85" fill="none" stroke="#000" strokeWidth="1.1" opacity="0.28" />
                                    </g>
                                </g>
                            </svg>
                            <button type="button" className={styles.dUp} aria-label="Hard drop (up)" {...padProps("up")} />
                            <button type="button" className={styles.dLeft} aria-label="Move left" {...padProps("left")} />
                            <button type="button" className={styles.dRight} aria-label="Move right" {...padProps("right")} />
                            <button type="button" className={styles.dDown} aria-label="Soft drop (down)" {...padProps("down")} />
                            <span className={styles.armIco} style={{ left: "50%", top: "15.5%" }}><ArrowDownToLine /></span>
                            <span className={styles.armIco} style={{ left: "17%", top: "48.5%" }}><ArrowLeft /></span>
                            <span className={styles.armIco} style={{ left: "83%", top: "48.5%" }}><ArrowRight /></span>
                            <span className={styles.armIco} style={{ left: "50%", top: "81.5%" }}><ArrowDown /></span>
                        </div>
                        <div className={styles.faces}>
                        {([
                            ["n1", 395, 55, true, "Rotate clockwise"],
                            ["n2", 328, 125, true, "Rotate counterclockwise"],
                            ["n3", 462, 120, false, "Rotate counterclockwise"],
                            ["n4", 395, 190, false, "Rotate clockwise"],
                        ] as const).map(([n, x, y, concave, label]) => (
                            <button key={n} type="button" className={styles.face + (concave ? " " + styles.concave : "")} style={pos(x - 285, y - 12)} aria-label={label} {...padProps(n)}>
                                {capArt(concave)}
                                <span className={styles.capIco}>{n === "n1" || n === "n4" ? <RotateCw /> : <RotateCcw />}</span>
                            </button>
                        ))}
                        </div>
                    </div>
                </div>
                {scoreModal && mode === "over" && (
                    <ScoreSubmissionModal isOpen score={scoreModal.score} level={scoreModal.level} lines={scoreModal.lines} onSubmit={submitScore} onClose={() => setScoreModal(null)} isSubmitting={submitting} />
                )}
            </div>
        );
    }

    return (
        <div className={styles.page}>
            <div className={styles.inner} ref={innerRef}>
                <div className={styles.head}>
                    <span className={styles.tag}>{title.toUpperCase()}</span>
                    <h1 className={styles.title}>{lines[0]}</h1>
                    <p className={styles.lede}>{lines[1]}</p>
                    {links}
                    {keyList}
                </div>

                <div className={styles.game}>
                    <div ref={stageRef} className={styles.bezel} style={{ "--s": scale, touchAction: mode === "player" ? "none" : "pan-y" } as CSSProperties}>
                        <div className={styles.bezelText} style={scale < 3 ? { fontSize: 8, lineHeight: "8px" } : undefined}>
                            <span>
                                <i className={styles.led} />
                                Q.T.R.S.
                            </span>
                            <span>{mode === "bot" ? "QBOT PLAYING" : "YOUR GAME"}</span>
                        </div>
                        <div ref={screenRef} className={styles.screen + (mode === "bot" ? " " + styles.demo : "")} onPointerDown={() => cancelAskRef.current()}>
                            <canvas
                                ref={canvasRef}
                                width={W}
                                height={H}
                                aria-label="Q.T.R.S. game screen"
                                role="img"
                                onClick={() => {
                                    // a click or tap on the board while QBOT plays takes over, as Press Start does
                                    if (modeRef.current === "bot") startPlayerRef.current();
                                }}
                            />
                            {board && (
                                <div className={styles.overlay}>
                                    <PixelScores
                                        store={store}
                                        key={board + boardKey}
                                        kicker={board === "pause" ? "PAUSED" : board === "attract" ? "QBOT IS NEXT" : undefined}
                                        onClose={board === "over" ? () => setBoard(null) : undefined}
                                    />
                                </div>
                            )}
                        </div>
                        <div className={styles.startRow} style={scale < 3 ? { fontSize: 8, lineHeight: "8px" } : undefined}>
                            <button ref={startRef} type="button" className={styles.start} onClick={onStartButton}>
                                {label}
                            </button>
                            {asking && (
                                <button type="button" className={styles.start} onClick={() => cancelAsk()}>
                                    Keep playing
                                </button>
                            )}
                            <span className={styles.soundWrap}>
                                {coach && <span className={styles.coach} role="status">Turn on sound to hear QBOT.</span>}
                                <button type="button" className={styles.sound} aria-pressed={soundOn} aria-label={soundOn ? "Turn sound off" : "Turn sound on"} onClick={toggleSound}>
                                    <svg viewBox="0 0 12 8" width="24" height="16" shapeRendering="crispEdges" aria-hidden="true">
                                        <path fill="currentColor" d="M0 3h2v2H0zM2 2h1v4H2zM3 1h1v6H3zM4 0h1v8H4z" />
                                        {soundOn ? <path fill="currentColor" d="M6 3h1v2H6zM8 1h1v6H8zM10 0h1v8h-1z" /> : <path fill="currentColor" d="M7 2h1v1H7zM8 3h1v2H8zM9 2h1v1H9zM7 5h1v1H7zM9 5h1v1H9z" />}
                                    </svg>
                                    {soundOn ? "SOUND ON" : "SOUND OFF"}
                                </button>
                            </span>
                            {mode !== "bot" && mode !== "over" && <span className={styles.hint}>{mode === "count" ? "3, 2, 1" : "P to pause"}</span>}
                        </div>
                    </div>
                    <p className={styles.keys + " " + styles.keysUnder}>{keys}</p>
                </div>

                <div className={styles.qbot} data-mode={mode} style={{ "--s": scale, "--k": pk, "--cw": sprite.cellW, "--ch": sprite.cellH, "--cols": sprite.cols, "--rows": sprite.rows, "--base": sprite.baselineY, "--top": sprite.minTopY, "--bh": bh + "px" } as CSSProperties}>
                    <div className={styles.bubbleSlot}>
                        {bubble && (
                            <div key={bubble.id} className={styles.bubble} role="status" aria-live="polite">
                                {bubble.text}
                            </div>
                        )}
                    </div>
                    <div ref={spriteRef} className={styles.sprite} role="img" aria-label="QBOT, a pixel-art portrait of Q" style={{ backgroundImage: `url(${spriteSrc})` }} />
                </div>
            </div>
            {scoreModal && mode === "over" && (
                <ScoreSubmissionModal isOpen score={scoreModal.score} level={scoreModal.level} lines={scoreModal.lines} onSubmit={submitScore} onClose={() => setScoreModal(null)} isSubmitting={submitting} />
            )}
        </div>
    );
}
