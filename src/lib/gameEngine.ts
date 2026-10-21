/**
 * The Q.T.R.S. game engine: board, tetrominoes, rotation with wall kicks, line clears, scoring and level speed. No React in here.
 * Credit: the playfield/tetromino/gravity logic began from Steven Lambert's
 * "Basic Tetris HTML and JavaScript Game" (MIT),
 * https://gist.github.com/straker/3c98304f8a6a9e20f2f8e1e1b86b0bc4
 * Ported to TypeScript and extended (levels, line-clear animation, leaderboard) here.
 */

export interface Position {
    row: number;
    col: number;
}

export interface Tetromino {
    name: string;
    matrix: number[][];
    row: number;
    col: number;
}

export interface GameState {
    playfield: (string | number)[][];
    currentPiece: Tetromino | null;
    score: number;
    level: number;
    lines: number;
    gameOver: boolean;
    isPaused: boolean;
    nextPiece: Tetromino | null;
    // Animation states
    clearingLines: number[];
    isClearingLines: boolean;
}

// Tetromino definitions following Tetris Guideline
export const tetrominos: Record<string, number[][]> = {
    I: [
        [0, 0, 0, 0],
        [1, 1, 1, 1],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
    ],
    J: [
        [1, 0, 0],
        [1, 1, 1],
        [0, 0, 0],
    ],
    L: [
        [0, 0, 1],
        [1, 1, 1],
        [0, 0, 0],
    ],
    O: [
        [1, 1],
        [1, 1],
    ],
    S: [
        [0, 1, 1],
        [1, 1, 0],
        [0, 0, 0],
    ],
    Z: [
        [1, 1, 0],
        [0, 1, 1],
        [0, 0, 0],
    ],
    T: [
        [0, 1, 0],
        [1, 1, 1],
        [0, 0, 0],
    ],
};

// Tetromino colors using Tailwind color names for theming
export const tetrominoColors: Record<string, string> = {
    T: "chart-2",
    O: "chart-1",
    S: "chart-4",
    L: "chart-5",
    J: "chart-3",
    I: "foreground",
    Z: "destructive",
};

export class TetrisGame {
    private playfield: (string | number)[][];
    private tetrominoSequence: string[] = [];
    private currentPiece: Tetromino | null = null;
    private nextPiece: Tetromino | null = null;
    private score = 0;
    private level = 1;
    private lines = 0;
    private gameOver = false;
    private isPaused = false;
    private gravityTimer = 0; // Accumulates gravity over time
    private frameTime = 1000 / 60; // 60fps = ~16.67ms per frame

    // Player-friendly gravity curve - much more gradual progression
    // Original was too aggressive, this gives players more time to think
    private readonly gravityTable: Record<number, number> = {
        1: 0.01667, // Level 1: Same as before (very slow)
        2: 0.018, // Level 2: Slightly faster
        3: 0.02, // Level 3: Still gentle
        4: 0.023, // Level 4: Noticeable but manageable
        5: 0.027, // Level 5: Moderate speed
        6: 0.032, // Level 6: Getting faster
        7: 0.038, // Level 7: Challenging but fair
        8: 0.045, // Level 8: Requires quick thinking
        9: 0.055, // Level 9: Fast but not overwhelming
        10: 0.068, // Level 10: High speed
        11: 0.085, // Level 11: Very fast
        12: 0.105, // Level 12: Expert level
        13: 0.13, // Level 13: Master level
        14: 0.16, // Level 14: Grandmaster
        15: 0.2, // Level 15: Legendary (was 2.36, now much more reasonable)
        16: 0.25, // Level 16: New level
        17: 0.32, // Level 17: New level
        18: 0.4, // Level 18: New level
        19: 0.5, // Level 19: New level
        20: 0.65, // Level 20: New level
        21: 0.8, // Level 21: Ultra level
        22: 0.95, // Level 22: Ultra level
        23: 1.1, // Level 23: Ultra level
        24: 1.25, // Level 24: Ultra level
        25: 1.4, // Level 25: Ultra level
    };

    // Animation states
    private clearingLines: number[] = [];
    private clearingTimer = 0;
    private clearingDuration = 400; // 400ms flash duration
    private lastLinesCleared = 0; // Track last line clear for update() return

    constructor() {
        this.playfield = this.createEmptyPlayfield();
        this.generateSequence();
        this.currentPiece = this.getNextTetromino();
        this.nextPiece = this.getNextTetromino();
    }

    private createEmptyPlayfield(): (string | number)[][] {
        const playfield: Array<Array<string | number>> = [];
        // Tetris playfield is 10x20, with a few rows offscreen
        for (let row = -2; row < 20; row++) {
            playfield[row] = new Array<string | number>(10);
            for (let col = 0; col < 10; col++) {
                playfield[row][col] = 0 as number;
            }
        }
        return playfield;
    }

    // Generate random sequence following Tetris Guideline
    private generateSequence(): void {
        const sequence = ["I", "J", "L", "O", "S", "T", "Z"];

        while (sequence.length) {
            const rand = Math.floor(Math.random() * sequence.length);
            const name = sequence.splice(rand, 1)[0];
            this.tetrominoSequence.push(name);
        }
    }

    private getNextTetromino(): Tetromino {
        if (this.tetrominoSequence.length === 0) {
            this.generateSequence();
        }

        const name = this.tetrominoSequence.pop()!;
        const matrix = tetrominos[name];

        // I and O start centered, all others start in left-middle
        const col =
            Math.floor(this.playfield[0].length / 2) -
            Math.ceil(matrix[0].length / 2);

        // I starts on row 21 (-1), all others start on row 22 (-2)
        const row = name === "I" ? -1 : -2;

        return {
            name,
            matrix: matrix.map((row) => [...row]), // Deep copy
            row,
            col,
        };
    }

    // Rotate matrix 90 degrees clockwise
    private rotateMatrix(matrix: number[][]): number[][] {
        const N = matrix.length - 1;
        return matrix.map((row, i) => row.map((val, j) => matrix[N - j][i]));
    }

    // Check if position is valid
    private isValidMove(
        matrix: number[][],
        cellRow: number,
        cellCol: number
    ): boolean {
        for (let row = 0; row < matrix.length; row++) {
            for (let col = 0; col < matrix[row].length; col++) {
                if (
                    matrix[row][col] &&
                    // Outside game bounds
                    (cellCol + col < 0 ||
                        cellCol + col >= this.playfield[0].length ||
                        cellRow + row >= this.playfield.length ||
                        // Collides with another piece
                        (this.playfield[cellRow + row] &&
                            this.playfield[cellRow + row][cellCol + col]))
                ) {
                    return false;
                }
            }
        }
        return true;
    }

    // Place tetromino on playfield
    private placeTetromino(): { linesCleared: number; isGameOver: boolean } {
        if (!this.currentPiece) return { linesCleared: 0, isGameOver: false };

        for (let row = 0; row < this.currentPiece.matrix.length; row++) {
            for (
                let col = 0;
                col < this.currentPiece.matrix[row].length;
                col++
            ) {
                if (this.currentPiece.matrix[row][col]) {
                    // Game over if piece has any part offscreen
                    if (this.currentPiece.row + row < 0) {
                        this.gameOver = true;
                        return { linesCleared: 0, isGameOver: true };
                    }

                    this.playfield[this.currentPiece.row + row][
                        this.currentPiece.col + col
                    ] = this.currentPiece.name;
                }
            }
        }

        // Check for line clears
        const linesCleared = this.clearLines();

        // Get next piece
        this.currentPiece = this.nextPiece;
        this.nextPiece = this.getNextTetromino();

        return { linesCleared, isGameOver: false };
    }

    // Clear completed lines
    private clearLines(): number {
        let linesCleared = 0;

        for (let row = this.playfield.length - 1; row >= 0; ) {
            if (
                this.playfield[row] &&
                this.playfield[row].every((cell) => !!cell)
            ) {
                // Drop every row above this one
                for (let r = row; r >= 0; r--) {
                    for (let c = 0; c < this.playfield[r].length; c++) {
                        this.playfield[r][c] = this.playfield[r - 1]
                            ? this.playfield[r - 1][c]
                            : 0;
                    }
                }
                linesCleared++;
            } else {
                row--;
            }
        }

        if (linesCleared > 0) {
            this.lines += linesCleared;
            this.updateScore(linesCleared);
            this.updateLevel();
            this.lastLinesCleared = linesCleared; // Store for update() return
        }

        return linesCleared;
    }

    // Update score based on lines cleared
    private updateScore(linesCleared: number): void {
        const basePoints = [0, 40, 100, 300, 1200]; // Single, Double, Triple, Tetris
        this.score += basePoints[linesCleared] * this.level;
    }

    // Update level based on lines cleared
    private updateLevel(): void {
        const newLevel = Math.floor(this.lines / 10) + 1;
        if (newLevel > this.level) {
            this.level = newLevel;
            // Level progression now uses gravity table - no dropInterval needed
        }
    }

    // Get current gravity in G units (cells per frame)
    private getCurrentGravity(): number {
        // Use level from gravity table, fallback to level 25 for higher levels
        const tableLevel = Math.min(this.level, 25);
        return this.gravityTable[tableLevel] || this.gravityTable[25];
    }

    // Public game actions
    public moveLeft(): boolean {
        if (!this.currentPiece || this.gameOver || this.isPaused) return false;

        const newCol = this.currentPiece.col - 1;
        if (
            this.isValidMove(
                this.currentPiece.matrix,
                this.currentPiece.row,
                newCol
            )
        ) {
            this.currentPiece.col = newCol;
            return true;
        }
        return false;
    }

    public moveRight(): boolean {
        if (!this.currentPiece || this.gameOver || this.isPaused) return false;

        const newCol = this.currentPiece.col + 1;
        if (
            this.isValidMove(
                this.currentPiece.matrix,
                this.currentPiece.row,
                newCol
            )
        ) {
            this.currentPiece.col = newCol;
            return true;
        }
        return false;
    }

    // Rotate 90 degrees counterclockwise: three clockwise turns applied in one step (no wall kicks, as with rotate())
    public rotateCCW(): boolean {
        if (!this.currentPiece || this.gameOver || this.isPaused) return false;

        const rotatedMatrix = this.rotateMatrix(this.rotateMatrix(this.rotateMatrix(this.currentPiece.matrix)));
        if (
            this.isValidMove(
                rotatedMatrix,
                this.currentPiece.row,
                this.currentPiece.col
            )
        ) {
            this.currentPiece.matrix = rotatedMatrix;
            return true;
        }
        return false;
    }

    public rotate(): boolean {
        if (!this.currentPiece || this.gameOver || this.isPaused) return false;

        const rotatedMatrix = this.rotateMatrix(this.currentPiece.matrix);
        if (
            this.isValidMove(
                rotatedMatrix,
                this.currentPiece.row,
                this.currentPiece.col
            )
        ) {
            this.currentPiece.matrix = rotatedMatrix;
            return true;
        }
        return false;
    }

    public softDrop(): boolean {
        if (!this.currentPiece || this.gameOver || this.isPaused) return false;

        const newRow = this.currentPiece.row + 1;
        if (
            this.isValidMove(
                this.currentPiece.matrix,
                newRow,
                this.currentPiece.col
            )
        ) {
            this.currentPiece.row = newRow;
            this.score += 1; // Soft drop gives points
            return true;
        } else {
            // Piece can't move down, place it
            const result = this.placeTetromino();
            if (result.isGameOver) {
                this.gameOver = true;
            }
            return false;
        }
    }

    public hardDrop(): { linesCleared: number; dropDistance: number } {
        if (!this.currentPiece || this.gameOver || this.isPaused) {
            return { linesCleared: 0, dropDistance: 0 };
        }

        let dropDistance = 0;
        while (
            this.isValidMove(
                this.currentPiece.matrix,
                this.currentPiece.row + 1,
                this.currentPiece.col
            )
        ) {
            this.currentPiece.row++;
            dropDistance++;
        }

        this.score += dropDistance * 2; // Hard drop gives 2 points per cell

        const result = this.placeTetromino();
        if (result.isGameOver) {
            this.gameOver = true;
        }

        return { linesCleared: result.linesCleared, dropDistance };
    }

    public pause(): void {
        this.isPaused = !this.isPaused;
    }

    public update(deltaTime: number): { linesCleared: number } {
        if (this.gameOver || this.isPaused || !this.currentPiece) {
            return { linesCleared: 0 };
        }

        // Check if we have lines that were cleared this frame
        const linesThisFrame = this.lastLinesCleared;
        this.lastLinesCleared = 0; // Reset after reading

        // Implement gravity using accumulation system as recommended in GameDev StackExchange
        const currentGravity = this.getCurrentGravity();
        const gravityIncrement = currentGravity * (deltaTime / this.frameTime);

        this.gravityTimer += gravityIncrement;

        // Drop piece for each accumulated gravity unit
        while (this.gravityTimer >= 1.0) {
            this.gravityTimer -= 1.0;
            this.softDrop();
        }

        return { linesCleared: linesThisFrame };
    }

    // Calculate ghost piece position (where current piece would land)
    public getGhostPiecePosition(): Tetromino | null {
        if (!this.currentPiece || this.gameOver || this.isPaused) {
            return null;
        }

        // Create a copy of the current piece
        const ghostPiece: Tetromino = {
            ...this.currentPiece,
            matrix: this.currentPiece.matrix.map((row) => [...row]),
        };

        // Drop the ghost piece down until it can't move further
        while (
            this.isValidMove(
                ghostPiece.matrix,
                ghostPiece.row + 1,
                ghostPiece.col
            )
        ) {
            ghostPiece.row++;
        }

        return ghostPiece;
    }

    public getGameState(): GameState {
        return {
            playfield: this.playfield.map((row) => [...row]),
            currentPiece: this.currentPiece
                ? {
                      ...this.currentPiece,
                      matrix: this.currentPiece.matrix.map((row) => [...row]),
                  }
                : null,
            score: this.score,
            level: this.level,
            lines: this.lines,
            gameOver: this.gameOver,
            isPaused: this.isPaused,
            nextPiece: this.nextPiece
                ? {
                      ...this.nextPiece,
                      matrix: this.nextPiece.matrix.map((row) => [...row]),
                  }
                : null,
            // Animation state exposure for UI; defaults when idle
            clearingLines: this.clearingLines.slice(),
            isClearingLines: this.clearingLines.length > 0,
        };
    }

    public reset(): void {
        this.playfield = this.createEmptyPlayfield();
        this.tetrominoSequence = [];
        this.score = 0;
        this.level = 1;
        this.lines = 0;
        this.gameOver = false;
        this.isPaused = false;
        this.gravityTimer = 0;

        this.generateSequence();
        this.currentPiece = this.getNextTetromino();
        this.nextPiece = this.getNextTetromino();
    }
}

export default TetrisGame;
