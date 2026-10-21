/**
 * The high-score store behind the game. Two backends, picked by the `leaderboard` prop:
 *  - an endpoint (a URL, or { list, submit }) you run yourself, or
 *  - nothing: the scores stay in this browser's localStorage (top 10, no server needed).
 *
 * Endpoint contract:
 *   GET  {list}?limit=10  ->  { leaderboard: [{ initials: "ABC", score: 1200 }, ...] }   (best first)
 *   POST {submit}  { initials, score, level, lines }  ->  any 2xx
 */
export interface ScoreRow {
    initials: string;
    score: number;
}

export interface ScoreEntry extends ScoreRow {
    level: number;
    lines: number;
}

export type LeaderboardConfig = string | { list: string; submit: string };

export interface ScoreStore {
    list(): Promise<ScoreRow[]>;
    submit(entry: ScoreEntry): Promise<void>;
}

const LOCAL_KEY = "qtrs-scores";
const TOP = 10;

function readLocal(): ScoreRow[] {
    try {
        const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
        if (!Array.isArray(raw)) return [];
        return raw
            .filter((r) => r && typeof r.initials === "string" && typeof r.score === "number")
            .sort((a, b) => b.score - a.score)
            .slice(0, TOP);
    } catch {
        return [];
    }
}

const localStore: ScoreStore = {
    async list() {
        return readLocal();
    },
    async submit(entry) {
        const rows = [...readLocal(), { initials: entry.initials, score: entry.score }].sort((a, b) => b.score - a.score).slice(0, TOP);
        try {
            localStorage.setItem(LOCAL_KEY, JSON.stringify(rows));
        } catch {
            /* storage can be off: the score is simply not kept */
        }
    },
};

export function createScoreStore(config?: LeaderboardConfig): ScoreStore {
    if (!config) return localStore;
    const list = typeof config === "string" ? config : config.list;
    const submit = typeof config === "string" ? config : config.submit;
    return {
        async list() {
            const r = await fetch(`${list}${list.includes("?") ? "&" : "?"}limit=${TOP}`);
            if (!r.ok) throw new Error("Could not load the leaderboard");
            const d = await r.json();
            return (Array.isArray(d.leaderboard) ? d.leaderboard : []).slice(0, TOP);
        },
        async submit(entry) {
            const r = await fetch(submit, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(entry),
            });
            if (!r.ok) throw new Error("Failed to submit score");
        },
    };
}
