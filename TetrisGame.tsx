"use client";

/**
 * /Users/qmanning/Local Sites/qmanning-next/src/components/tetris/TetrisGame.tsx
 * Last Change: Created main Tetris game React component with canvas rendering
 * v1
 */

import React, { useRef, useEffect, useState, useCallback } from "react";
import { useStableCallback } from "@/hooks/react-safety";
import {
    TetrisGame as TetrisGameEngine,
    tetrominoColors,
} from "@/lib/tetris/gameEngine";
import {
    ArrowBigLeft,
    ArrowBigRight,
    RotateCcw,
    ArrowDownToLine,
} from "lucide-react";

import ScoreSubmissionModal from "./ScoreSubmissionModal";

interface TetrisGameProps {
    width?: number;
    height?: number;
    className?: string;
    onGameOver?: (score: number, level: number, lines: number) => void;
    onScoreUpdate?: (score: number, level: number, lines: number) => void;
    onAchievement?: (achievementText: string) => void;
    onScoreSubmitted?: (rank: number, initials: string) => void;
    onGameRestart?: () => void;
    onGameStart?: () => void;
    autoScale?: boolean;
    enableLeaderboard?: boolean;
    minScoreForSubmission?: number;
    /** Tile mode: hides the score/lines/level row to save vertical space. */
    compact?: boolean;
    /** Level the engine starts (and restarts) at. Applied after construction/reset since the engine has no public setter. */
    startLevel?: number;
    /** Whether to draw the ghost (landing-preview) piece. */
    showGhost?: boolean;
    /** Ghost fill alpha; the outline alpha is derived as min(1, ghostOpacity * 4). */
    ghostOpacity?: number;
    /** Whether line clears show the "Nice Clear!" / "OMG! Q.T.R.S.!" celebration pill. */
    showCelebrations?: boolean;
}

// The engine (src/lib/tetris/gameEngine.ts) has no public level setter, so a
// non-default starting level is applied by writing its private field directly
// right after construction/reset — same moment restartGame() calls reset().
function applyStartLevel(engine: TetrisGameEngine, startLevel: number) {
    const level = Math.max(1, Math.floor(startLevel) || 1);
    (engine as unknown as { level: number }).level = level;
}

// Get computed CSS color values (Canvas doesn't support CSS variables directly)
const getComputedColor = (cssVariable: string): string => {
    if (typeof window !== "undefined") {
        const computed = getComputedStyle(
            document.documentElement
        ).getPropertyValue(cssVariable);
        return computed.trim() || "#666";
    }
    return "#666";
};

export default function TetrisGame({
    width = 320,
    height = 640,
    className = "",
    onGameOver,
    onScoreUpdate,
    onAchievement,
    onScoreSubmitted,
    onGameRestart,
    onGameStart,
    autoScale = true,
    enableLeaderboard = true,
    minScoreForSubmission = 1000,
    compact = false,
    startLevel = 1,
    showGhost = true,
    ghostOpacity = 0.18,
    showCelebrations = true,
}: TetrisGameProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const gameRef = useRef<TetrisGameEngine | null>(null);
    const animationRef = useRef<number | null>(null);
    const lastTimeRef = useRef<number>(0);
    const hasUserInteractedRef = useRef<boolean>(false);

    const [gameState, setGameState] = useState({
        score: 0,
        level: 1,
        lines: 0,
        gameOver: false,
        isPaused: false,
    });

    const [highScore, setHighScore] = useState(0);

    const [topScorerInitials, setTopScorerInitials] = useState("---");
    const [isHydrated, setIsHydrated] = useState(false);

    const [celebrationText, setCelebrationText] = useState<string>("");
    const [celebrationPhase, setCelebrationPhase] = useState<
        "hidden" | "sliding-in" | "showing" | "sliding-out"
    >("hidden");
    const celebrationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const [scale, setScale] = useState(1);
    const [isMobile, setIsMobile] = useState(false);

    // Visual debugging state for mobile
    const [debugInfo, setDebugInfo] = useState({
        mobileDetectionStatus: "",
        buttonControlsActive: false,
    });

    // Score submission modal state
    const [showScoreModal, setShowScoreModal] = useState(false);
    const [isSubmittingScore, setIsSubmittingScore] = useState(false);
    const [finalGameState, setFinalGameState] = useState<{
        score: number;
        level: number;
        lines: number;
    } | null>(null);
    const [previousGameOverState, setPreviousGameOverState] = useState(false);

    // Initialize game (after startGameLoop is declared below)

    // Handle hydration and load localStorage data
    useEffect(() => {
        setIsHydrated(true);
        // Load high score from localStorage after hydration
        const savedScore = localStorage.getItem("tetris-high-score");
        if (savedScore) {
            setHighScore(parseInt(savedScore, 10));
        }
        // Load top scorer initials from localStorage after hydration
        const savedInitials = localStorage.getItem("tetris-top-scorer");
        if (savedInitials) {
            setTopScorerInitials(savedInitials);
        }
    }, []);

    // Fetch top scorer on mount (after hydration)
    const fetchTopScorerStable = useStableCallback(() => fetchTopScorer());
    useEffect(() => {
        if (isHydrated) {
            fetchTopScorerStable();
        }
    }, [isHydrated, fetchTopScorerStable]);

    // Handle mobile detection and scaling
    useEffect(() => {
        const checkMobile = () => {
            const mobile = window.innerWidth <= 768;
            setIsMobile(mobile);

            // Set visual debug info instead of console logs
            setDebugInfo((prev) => ({
                ...prev,
                mobileDetectionStatus: `Window: ${
                    window.innerWidth
                }px, Mobile: ${mobile ? "YES" : "NO"}`,
            }));

            if (autoScale && mobile) {
                const availableWidth = window.innerWidth - 32; // padding
                const availableHeight = window.innerHeight - 200; // nav + instructions

                const scaleByWidth = availableWidth / width;
                const scaleByHeight = availableHeight / height;

                setScale(Math.min(scaleByWidth, scaleByHeight, 0.9));
            } else {
                setScale(1);
            }
        };

        checkMobile();
        window.addEventListener("resize", checkMobile);
        return () => {
            window.removeEventListener("resize", checkMobile);
            if (celebrationTimeoutRef.current) {
                clearTimeout(celebrationTimeoutRef.current);
            }
        };
    }, [width, height, autoScale]);

    // Update debug info when mobile detection changes
    useEffect(() => {
        if (isMobile) {
            setDebugInfo((prev) => ({
                ...prev,
                mobileDetectionStatus:
                    "Mobile detected - Button controls enabled",
                buttonControlsActive: true,
            }));
        } else {
            setDebugInfo((prev) => ({
                ...prev,
                mobileDetectionStatus:
                    "Desktop detected - Keyboard controls enabled",
                buttonControlsActive: false,
            }));
        }
    }, [isMobile]);

    const grid = Math.floor(width / 10); // Block size: the playfield is 10x20, so the whole board always fits the canvas

    const gameLoop = useStableCallback((currentTime: number) => {
        if (!gameRef.current) return;

        const deltaTime = currentTime - lastTimeRef.current;
        lastTimeRef.current = currentTime;

        const result = gameRef.current.update(deltaTime);
        const state = gameRef.current.getGameState();

        // Debug logging
        if (result.linesCleared !== undefined) {
            // console.log("Update result:", result);
        }

        setGameState({
            score: state.score,
            level: state.level,
            lines: state.lines,
            gameOver: state.gameOver,
            isPaused: state.isPaused,
        });

        // Handle achievements and line clearing effects
        if (result.linesCleared > 0 && showCelebrations) {
            const celebrationMessages = {
                1: "Nice Clear!",
                2: "Double!",
                3: "Triple!",
                4: "OMG! Q.T.R.S.!",
            };

            const message =
                celebrationMessages[
                    result.linesCleared as keyof typeof celebrationMessages
                ] || "Amazing!";

            // console.log("Lines cleared:", result.linesCleared);
            setCelebrationText(message);
            setCelebrationPhase("sliding-in");

            if (celebrationTimeoutRef.current) {
                clearTimeout(celebrationTimeoutRef.current);
            }

            // Animation sequence: slide-in -> show -> slide-out -> hidden
            setTimeout(() => setCelebrationPhase("showing"), 300); // After slide-in animation
            setTimeout(() => setCelebrationPhase("sliding-out"), 2000); // Show for 1.7 seconds
            celebrationTimeoutRef.current = setTimeout(() => {
                setCelebrationPhase("hidden");
                setCelebrationText("");
            }, 2300); // After slide-out animation
        }

        // Notify parent components
        onScoreUpdate?.(state.score, state.level, state.lines);

        if (state.gameOver) {
            // Only process game over if the player actually played (score > 0 or lines > 0)
            // This prevents false triggers from hot reload/compilation
            if (
                hasUserInteractedRef.current &&
                (state.score > 0 || state.lines > 0)
            ) {
                // Store final game state for potential score submission
                setFinalGameState({
                    score: state.score,
                    level: state.level,
                    lines: state.lines,
                });

                // Update high score if current score is higher
                if (state.score > highScore) {
                    setHighScore(state.score);
                    if (typeof window !== "undefined") {
                        localStorage.setItem(
                            "tetris-high-score",
                            state.score.toString()
                        );
                    }
                }

                // Show score submission modal only if score qualifies for top 10 and leaderboard is enabled
                if (enableLeaderboard && state.score >= minScoreForSubmission) {
                    // Check if this score would qualify for top 10
                    fetch("/api/tetris/leaderboard?limit=10")
                        .then((response) => response.json())
                        .then((leaderboardData) => {
                            const leaderboard =
                                leaderboardData.leaderboard || [];

                            // If leaderboard has less than 10 scores, or this score is higher than the 10th score
                            if (
                                leaderboard.length < 10 ||
                                state.score >
                                    leaderboard[leaderboard.length - 1]?.score
                            ) {
                                setShowScoreModal(true);
                            }
                        })
                        .catch((error) => {
                            console.error(
                                "Error checking leaderboard position:",
                                error
                            );
                            // Fallback: show modal if score is high enough
                            if (state.score >= minScoreForSubmission) {
                                setShowScoreModal(true);
                            }
                        });
                }

                // Only call onGameOver when the game transitions from not-over to over
                // AND the game has actually been played (not just from hot reload)
                if (!previousGameOverState && hasUserInteractedRef.current) {
                    onGameOver?.(state.score, state.level, state.lines);
                }
            }

            // Update the previous game over state for next frame
            setPreviousGameOverState(state.gameOver);
        }

        draw(state);

        if (!state.gameOver) {
            animationRef.current = requestAnimationFrame(gameLoop);
        }
    });

    const startGameLoop = useStableCallback(() => {
        if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
        }
        lastTimeRef.current = performance.now();
        animationRef.current = requestAnimationFrame(gameLoop);
    });

    // Initialize game (after startGameLoop is declared)
    useEffect(() => {
        gameRef.current = new TetrisGameEngine();
        applyStartLevel(gameRef.current, startLevel);
        startGameLoop();

        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [startGameLoop]);

    const draw = useCallback(
        (state: any) => {
            const canvas = canvasRef.current;
            if (!canvas) return;

            const context = canvas.getContext("2d");
            if (!context) return;

            // Clear canvas
            context.clearRect(0, 0, canvas.width, canvas.height);

            // Draw playfield
            for (let row = 0; row < 20; row++) {
                for (let col = 0; col < 10; col++) {
                    if (state.playfield[row] && state.playfield[row][col]) {
                        const pieceName = state.playfield[row][col];
                        const colorName = tetrominoColors[pieceName];

                        context.fillStyle =
                            getComputedColor(`--${colorName}`) || "#666";

                        // Draw with grid effect (1px smaller)
                        context.fillRect(
                            col * grid,
                            row * grid,
                            grid - 1,
                            grid - 1
                        );
                    }
                }
            }

            // Draw ghost piece (drop shadow)
            if (showGhost && gameRef.current && state.currentPiece) {
                const ghostPiece = gameRef.current.getGhostPiecePosition();
                if (ghostPiece && ghostPiece.row !== state.currentPiece.row) {
                    // Only draw ghost if it's different from current piece position

                    // Ghost = the landing spot. A black overlay is invisible on the dark
                    // board, so draw it in the piece's own color: faint fill + 1px outline.
                    const ghostColor =
                        getComputedColor(`--${tetrominoColors[ghostPiece.name]}`) || "#888";
                    context.fillStyle = ghostColor;
                    context.strokeStyle = ghostColor;
                    context.lineWidth = 1;
                    const prevAlpha = context.globalAlpha;

                    for (let row = 0; row < ghostPiece.matrix.length; row++) {
                        for (
                            let col = 0;
                            col < ghostPiece.matrix[row].length;
                            col++
                        ) {
                            if (ghostPiece.matrix[row][col]) {
                                const drawRow = ghostPiece.row + row;
                                const drawCol = ghostPiece.col + col;

                                // Only draw if within visible area
                                if (drawRow >= 0) {
                                    context.globalAlpha = ghostOpacity;
                                    context.fillRect(
                                        drawCol * grid,
                                        drawRow * grid,
                                        grid - 1,
                                        grid - 1
                                    );
                                    context.globalAlpha = Math.min(1, ghostOpacity * 4);
                                    context.strokeRect(
                                        drawCol * grid + 0.5,
                                        drawRow * grid + 0.5,
                                        grid - 2,
                                        grid - 2
                                    );
                                }
                            }
                        }
                    }
                    context.globalAlpha = prevAlpha;
                }
            }

            // Draw current piece
            if (state.currentPiece) {
                const piece = state.currentPiece;
                const colorName = tetrominoColors[piece.name];
                context.fillStyle =
                    getComputedColor(`--${colorName}`) || "#666";

                for (let row = 0; row < piece.matrix.length; row++) {
                    for (let col = 0; col < piece.matrix[row].length; col++) {
                        if (piece.matrix[row][col]) {
                            const drawRow = piece.row + row;
                            const drawCol = piece.col + col;

                            // Only draw if within visible area
                            if (drawRow >= 0) {
                                context.fillRect(
                                    drawCol * grid,
                                    drawRow * grid,
                                    grid - 1,
                                    grid - 1
                                );
                            }
                        }
                    }
                }
            }

            // Draw game over overlay
            if (state.gameOver) {
                context.fillStyle = "rgba(252, 211, 77, 0.9)"; // Tailwind yellow-300 with opacity
                context.fillRect(0, canvas.height / 2 - 40, canvas.width, 80);

                context.fillStyle = "#000";
                context.font =
                    "16px 'Space Grotesk', system-ui, -apple-system, sans-serif";
                context.textAlign = "center";
                context.textBaseline = "middle";
                context.fillText(
                    "Game Over!",
                    canvas.width / 2,
                    canvas.height / 2
                );
            }

            // Draw pause overlay
            if (state.isPaused && !state.gameOver) {
                context.fillStyle = "rgba(0, 0, 0, 0.7)";
                context.fillRect(0, 0, canvas.width, canvas.height);

                context.fillStyle = "#fff";
                context.font =
                    "24px 'Space Grotesk', system-ui, -apple-system, sans-serif";
                context.textAlign = "center";
                context.textBaseline = "middle";
                context.fillText("PAUSED", canvas.width / 2, canvas.height / 2);
            }
        },
        [grid, showGhost, ghostOpacity]
    );

    // Keyboard controls
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (!gameRef.current) return;

            const { code } = event;

            // Prevent default for game keys
            if (
                [
                    "ArrowLeft",
                    "ArrowRight",
                    "ArrowUp",
                    "ArrowDown",
                    "Space",
                    "KeyA",
                    "KeyS",
                    "KeyD",
                    "KeyW",
                    "KeyP",
                ].includes(code)
            ) {
                event.preventDefault();
            }

            // Mark that the user has interacted with the game
            if (!hasUserInteractedRef.current) {
                hasUserInteractedRef.current = true;
                // Notify parent component that user has started playing
                onGameStart?.();
            }

            switch (code) {
                case "ArrowLeft":
                case "KeyA":
                    gameRef.current.moveLeft();
                    break;
                case "ArrowRight":
                case "KeyD":
                    gameRef.current.moveRight();
                    break;
                case "ArrowUp":
                case "KeyW":
                    gameRef.current.rotate();
                    break;
                case "Space":
                    gameRef.current.hardDrop();
                    break;
                case "ArrowDown":
                case "KeyS":
                    gameRef.current.softDrop();
                    break;
                case "KeyP":
                    gameRef.current.pause();
                    break;
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    // Remove swipe controls - replaced with button controls
    // const swipeHandlers: SwipeHandlers = { ... };
    // const touchHandlers = createSwipeHandlers(swipeHandlers);

    // Apply touch handlers directly to canvas element - REMOVED
    // useEffect(() => { ... }, [isMobile, touchHandlers]);

    const restartGame = () => {
        if (gameRef.current) {
            gameRef.current.reset();
            applyStartLevel(gameRef.current, startLevel);
            startGameLoop();
            onGameRestart?.();
            hasUserInteractedRef.current = false;

            // Reset all modal and game state
            setShowScoreModal(false);
            setFinalGameState(null);
            setIsSubmittingScore(false);
            setPreviousGameOverState(false);

            // Reset celebration state
            setCelebrationText("");
            setCelebrationPhase("hidden");
            if (celebrationTimeoutRef.current) {
                clearTimeout(celebrationTimeoutRef.current);
            }
        }
    };

    const togglePause = () => {
        gameRef.current?.pause();
    };

    const handleUserInteraction = () => {
        if (!hasUserInteractedRef.current) {
            hasUserInteractedRef.current = true;
            onGameStart?.();
        }
    };

    const handleScoreSubmission = async (initials: string) => {
        if (!finalGameState) return;

        setIsSubmittingScore(true);
        try {
            const response = await fetch("/api/tetris/scores", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    initials,
                    score: finalGameState.score,
                    level: finalGameState.level,
                    lines: finalGameState.lines,
                }),
            });

            if (!response.ok) {
                throw new Error("Failed to submit score");
            }

            const result = await response.json();

            // Update top scorer initials if this is a new high score
            if (finalGameState && finalGameState.score >= highScore) {
                setTopScorerInitials(initials);
                if (typeof window !== "undefined") {
                    localStorage.setItem("tetris-top-scorer", initials);
                }
            }

            // Close modal and notify parent
            setShowScoreModal(false);
            onScoreSubmitted?.(result.score.rank, initials);

            // Refresh top scorer info in case this submission changed the leaderboard
            fetchTopScorer();
        } catch (error) {
            console.error("Error submitting score:", error);
            throw error; // Re-throw so modal can show error
        } finally {
            setIsSubmittingScore(false);
        }
    };

    const handleCloseModal = () => {
        setShowScoreModal(false);
        setFinalGameState(null);
    };

    const fetchTopScorer = async () => {
        try {
            const response = await fetch("/api/tetris/leaderboard?limit=1");
            if (response.ok) {
                const data = await response.json();
                if (data.leaderboard && data.leaderboard.length > 0) {
                    const topScore = data.leaderboard[0];
                    const newHighScore = topScore.score;
                    const newTopInitials = topScore.initials;

                    // Update high score if the leaderboard score is higher than local storage
                    if (newHighScore > highScore) {
                        setHighScore(newHighScore);
                        setTopScorerInitials(newTopInitials);

                        if (typeof window !== "undefined") {
                            localStorage.setItem(
                                "tetris-high-score",
                                newHighScore.toString()
                            );
                            localStorage.setItem(
                                "tetris-top-scorer",
                                newTopInitials
                            );
                        }
                    }
                } else {
                    // No records in leaderboard - reset to default state
                    setHighScore(0);
                    setTopScorerInitials("---");

                    if (typeof window !== "undefined") {
                        localStorage.removeItem("tetris-high-score");
                        localStorage.removeItem("tetris-top-scorer");
                    }
                }
            }
        } catch (error) {
            console.error("Failed to fetch top scorer:", error);
        }
    };

    const scaledWidth = width * scale;
    const scaledHeight = height * scale;

    return (
        <div className={`tetris-game flex flex-col items-center ${className}`}>
            {/* Game Stats (hidden in compact/tile mode) */}
            {!compact && (
            <div
                className="grid grid-cols-4 gap-2 mb-4 text-sm font-medium"
                style={{ width: scaledWidth }}
            >
                <div className="text-center">
                    <div className="text-muted-foreground text-xs">Score</div>
                    <div className="text-sm font-bold">
                        {gameState.score.toLocaleString()}
                    </div>
                </div>
                <div className="text-center">
                    <div className="text-muted-foreground text-xs">Lines</div>
                    <div className="text-sm font-bold">{gameState.lines}</div>
                </div>
                <div className="text-center">
                    <div className="text-muted-foreground text-xs">Level</div>
                    <div className="text-sm font-bold">{gameState.level}</div>
                </div>
                <div className="text-center">
                    <div className="text-muted-foreground text-xs">High</div>
                    <div className="text-sm font-bold">{topScorerInitials}</div>
                </div>
            </div>
            )}

            {/* Game Canvas with Celebration Overlay */}
            <div className="relative">
                {/* Game Canvas Container */}
                <div
                    className="relative bg-background border-2 border-border rounded-lg tetris-canvas-container"
                    style={{
                        width: scaledWidth,
                        height: scaledHeight,
                        touchAction: "none", // Prevent touch scrolling on container
                        WebkitOverflowScrolling: "touch", // Enable smooth scrolling if needed
                    }}
                >
                    <canvas
                        ref={canvasRef}
                        width={width}
                        height={height}
                        className="block"
                        style={{
                            width: scaledWidth,
                            height: scaledHeight,
                            imageRendering: "pixelated",
                            touchAction: "none", // Prevent default touch behaviors like scrolling/zooming
                            WebkitTouchCallout: "none", // Prevent iOS callout
                            WebkitUserSelect: "none", // Prevent text selection
                            userSelect: "none",
                        }}
                    />

                    {/* Celebration Text Overlay */}
                    {celebrationPhase !== "hidden" && (
                        <div
                            className="absolute top-0 left-0 right-0 flex items-center justify-center pointer-events-none z-10 transition-all duration-150 ease-out"
                            style={{
                                transform:
                                    celebrationPhase === "sliding-in"
                                        ? "translateY(-28px)"
                                        : celebrationPhase === "showing"
                                        ? "translateY(12px)"
                                        : celebrationPhase === "sliding-out"
                                        ? "translateY(-68px)"
                                        : "translateY(-28px)",
                                opacity:
                                    celebrationPhase === "sliding-in"
                                        ? 0
                                        : celebrationPhase === "showing"
                                        ? 1
                                        : celebrationPhase === "sliding-out"
                                        ? 0
                                        : 0,
                            }}
                        >
                            <div
                                className={`${compact ? "text-[11px] px-2 py-1 border shadow-[2px_2px_0px_0px_#000000]" : "text-xl px-4 py-2 border-2 shadow-[4px_4px_0px_0px_#000000]"} whitespace-nowrap font-bold bg-white text-black rounded-full border-black mx-2 transition-transform duration-150 ease-out ${
                                    celebrationPhase === "sliding-in"
                                        ? "animate-bounce"
                                        : ""
                                }`}
                            >
                                {celebrationText}
                            </div>
                        </div>
                    )}
                </div>

                {/* Mobile Control Buttons - Left Side (150px to the left) */}
                {isMobile && (
                    <div
                        className="absolute top-1/2 -translate-y-1/2 left-0 -translate-x-full"
                        style={{ left: "-12px" }}
                    >
                        <div className="flex flex-col gap-8">
                            {/* Left Button */}
                            <button
                                onClick={() => {
                                    handleUserInteraction();
                                    if (
                                        gameRef.current &&
                                        !gameState.gameOver &&
                                        !gameState.isPaused
                                    ) {
                                        gameRef.current.moveLeft();
                                    }
                                }}
                                className="w-14 h-14 flex items-center justify-center text-foreground/50 border border-foreground/5 rounded-full hover:text-accent/50 hover:border-accent/5 active:text-accent/50 active:border-accent/5 transition-all duration-150"
                                disabled={
                                    gameState.gameOver || gameState.isPaused
                                }
                            >
                                <ArrowBigLeft className="w-8 h-8" />
                            </button>

                            {/* Hard Drop Button */}
                            <button
                                onClick={() => {
                                    handleUserInteraction();
                                    if (
                                        gameRef.current &&
                                        !gameState.gameOver &&
                                        !gameState.isPaused
                                    ) {
                                        gameRef.current.hardDrop();
                                    }
                                }}
                                className="w-14 h-14 flex items-center justify-center text-foreground/25 border border-foreground/5 rounded-full hover:text-accent/50 hover:border-accent/5 active:text-accent/50 active:border-accent/5 transition-all duration-150"
                                disabled={
                                    gameState.gameOver || gameState.isPaused
                                }
                            >
                                <ArrowDownToLine className="w-8 h-8" />
                            </button>
                        </div>
                    </div>
                )}

                {/* Mobile Control Buttons - Right Side (150px to the right) */}
                {isMobile && (
                    <div
                        className="absolute top-1/2 -translate-y-1/2 right-0 translate-x-full"
                        style={{ right: "-12px" }}
                    >
                        <div className="flex flex-col gap-8">
                            {/* Right Button */}
                            <button
                                onClick={() => {
                                    handleUserInteraction();
                                    if (
                                        gameRef.current &&
                                        !gameState.gameOver &&
                                        !gameState.isPaused
                                    ) {
                                        gameRef.current.moveRight();
                                    }
                                }}
                                className="w-14 h-14 flex items-center justify-center text-foreground/50 border border-foreground/5 rounded-full hover:text-accent/50 hover:border-accent/5 active:text-accent/50 active:border-accent/5 transition-all duration-150"
                                disabled={
                                    gameState.gameOver || gameState.isPaused
                                }
                            >
                                <ArrowBigRight className="w-8 h-8" />
                            </button>

                            {/* Rotate Button */}
                            <button
                                onClick={() => {
                                    handleUserInteraction();
                                    if (
                                        gameRef.current &&
                                        !gameState.gameOver &&
                                        !gameState.isPaused
                                    ) {
                                        gameRef.current.rotate();
                                    }
                                }}
                                className="w-14 h-14 flex items-center justify-center text-foreground/25 border border-foreground/5 rounded-full hover:text-accent/50 hover:border-accent/5 active:text-accent/50 active:border-accent/5 transition-all duration-150"
                                disabled={
                                    gameState.gameOver || gameState.isPaused
                                }
                            >
                                <RotateCcw className="w-8 h-8" />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Game Controls */}
            <div className="flex gap-4 mt-4">
                {gameState.gameOver ? (
                    <button
                        onClick={restartGame}
                        className="h26-try"
                    >
                        Play Again
                    </button>
                ) : (
                    <button
                        onClick={togglePause}
                        className="h26-try h26-ghost"
                    >
                        {gameState.isPaused ? "Resume" : "Pause"}
                    </button>
                )}
            </div>

            {/* Score Submission Modal */}
            {enableLeaderboard &&
                finalGameState &&
                gameState.gameOver &&
                hasUserInteractedRef.current &&
                showScoreModal && (
                    <ScoreSubmissionModal
                        isOpen={showScoreModal}
                        score={finalGameState.score}
                        level={finalGameState.level}
                        lines={finalGameState.lines}
                        onSubmit={handleScoreSubmission}
                        onClose={handleCloseModal}
                        isSubmitting={isSubmittingScore}
                    />
                )}
        </div>
    );
}
