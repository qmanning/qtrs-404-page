"use client";

import React, { useState } from "react";
import { X, Trophy, Star } from "lucide-react";
import styles from "./ScoreSubmissionModal.module.css";

interface ScoreSubmissionModalProps {
    isOpen: boolean;
    score: number;
    level: number;
    lines: number;
    onSubmit: (initials: string) => Promise<void>;
    onClose: () => void;
    isSubmitting?: boolean;
}

/** Asks for 1 to 3 letters or digits after a score that makes the top 10. Plain elements, styled by its own CSS module (no UI kit needed). */
export default function ScoreSubmissionModal({ isOpen, score, level, lines, onSubmit, onClose, isSubmitting = false }: ScoreSubmissionModalProps) {
    const [initials, setInitials] = useState("");
    const [error, setError] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!initials.trim()) {
            setError("Please enter your initials");
            return;
        }
        if (initials.length < 1 || initials.length > 3) {
            setError("Initials must be 1-3 characters");
            return;
        }
        if (!/^[A-Za-z0-9]+$/.test(initials)) {
            setError("Only letters and numbers allowed");
            return;
        }
        setError("");
        try {
            await onSubmit(initials.toUpperCase());
        } catch {
            setError("Failed to submit score. Please try again.");
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInitials(e.target.value.toUpperCase().slice(0, 3));
        if (error) setError("");
    };

    if (!isOpen) return null;

    return (
        <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="qtrs-score-title">
            <div className={styles.card}>
                <div className={styles.header}>
                    <div className={styles.headerTitle}>
                        <Trophy size={24} />
                        <h2 id="qtrs-score-title">Great Score!</h2>
                    </div>
                    <button type="button" className={styles.close} onClick={onClose} disabled={isSubmitting} aria-label="Close">
                        <X size={20} />
                    </button>
                </div>

                <div className={styles.scoreBlock}>
                    <div className={styles.scoreLine}>
                        <Star size={20} />
                        <span className={styles.score}>{score.toLocaleString()}</span>
                        <Star size={20} />
                    </div>
                    <div className={styles.stats}>
                        <div>
                            <div className={styles.statLabel}>Level</div>
                            <div className={styles.statValue}>{level}</div>
                        </div>
                        <div>
                            <div className={styles.statLabel}>Lines</div>
                            <div className={styles.statValue}>{lines}</div>
                        </div>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className={styles.form}>
                    <label htmlFor="qtrs-initials" className={styles.label}>
                        Enter your initials (1-3 characters):
                    </label>
                    <input
                        id="qtrs-initials"
                        type="text"
                        value={initials}
                        onChange={handleInputChange}
                        placeholder="ABC"
                        maxLength={3}
                        className={styles.input}
                        disabled={isSubmitting}
                        autoFocus
                        autoComplete="off"
                    />
                    {error && <p className={styles.error}>{error}</p>}
                    <div className={styles.actions}>
                        <button type="button" className={styles.skip} onClick={onClose} disabled={isSubmitting}>
                            Skip
                        </button>
                        <button type="submit" className={styles.submit} disabled={isSubmitting || !initials.trim()}>
                            {isSubmitting ? "Submitting..." : "Submit Score"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
