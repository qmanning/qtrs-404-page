/**
 * Swipe gesture detection for the phone controls.
 */

export interface TouchPoint {
    x: number;
    y: number;
    time: number;
}

export interface SwipeGesture {
    direction: "left" | "right" | "up" | "down" | "tap" | "doubletap" | null;
    distance: number;
    duration: number;
    velocity: number;
}

export interface SwipeConfig {
    minSwipeDistance: number;
    maxSwipeTime: number;
    minSwipeVelocity: number;
    doubleTapMaxTime: number;
    doubleTapMaxDistance: number;
    tapMaxDistance: number;
    tapMaxTime: number;
}

const defaultConfig: SwipeConfig = {
    minSwipeDistance: 25, // Reduced from 30 for better mobile sensitivity
    maxSwipeTime: 800, // Reduced from 1000 for faster response
    minSwipeVelocity: 0.05, // Reduced from 0.1 for better mobile detection
    doubleTapMaxTime: 300, // Maximum time between taps for double tap
    doubleTapMaxDistance: 25, // Increased from 20 for better mobile tolerance
    tapMaxDistance: 15, // Increased from 10 for better mobile tolerance
    tapMaxTime: 250, // Increased from 200 for better mobile tolerance
};

export class SwipeDetector {
    private config: SwipeConfig;
    private startPoint: TouchPoint | null = null;
    private lastTap: TouchPoint | null = null;
    private isTracking = false;

    constructor(config: Partial<SwipeConfig> = {}) {
        this.config = { ...defaultConfig, ...config };
    }

    public handleTouchStart(event: TouchEvent): void {
        const touch = event.touches[0];
        if (!touch) return;

        this.startPoint = {
            x: touch.clientX,
            y: touch.clientY,
            time: Date.now(),
        };
        this.isTracking = true;

        // Don't prevent default on touch start - let the browser handle it
        // This allows proper touch event initialization
    }

    public handleTouchMove(event: TouchEvent): void {
        if (!this.isTracking || !this.startPoint) return;

        const touch = event.touches[0];
        if (!touch) return;

        const deltaX = Math.abs(touch.clientX - this.startPoint.x);
        const deltaY = Math.abs(touch.clientY - this.startPoint.y);

        // Only prevent default if we've moved enough to potentially be a swipe
        // This prevents page scrolling during game swipes while allowing normal touch behavior
        if (deltaX > 15 || deltaY > 15) {
            event.preventDefault();
        }
    }

    public handleTouchEnd(event: TouchEvent): SwipeGesture {
        if (!this.startPoint || !this.isTracking) {
            return this.createNullGesture();
        }

        const touch = event.changedTouches[0];
        if (!touch) {
            return this.createNullGesture();
        }

        const endPoint: TouchPoint = {
            x: touch.clientX,
            y: touch.clientY,
            time: Date.now(),
        };

        this.isTracking = false;

        const deltaX = endPoint.x - this.startPoint.x;
        const deltaY = endPoint.y - this.startPoint.y;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        const duration = endPoint.time - this.startPoint.time;
        const velocity = distance / duration;

        // Check for double tap
        if (this.isDoubleTap(endPoint)) {
            this.lastTap = null; // Reset after successful double tap
            return {
                direction: "doubletap",
                distance,
                duration,
                velocity,
            };
        }

        // Check for single tap
        if (this.isTap(distance, duration)) {
            this.lastTap = endPoint;
            return {
                direction: "tap",
                distance,
                duration,
                velocity,
            };
        }

        // Check for swipe
        if (this.isSwipe(distance, duration, velocity)) {
            const direction = this.getSwipeDirection(deltaX, deltaY);
            return {
                direction,
                distance,
                duration,
                velocity,
            };
        }

        return this.createNullGesture();
    }

    private isDoubleTap(currentPoint: TouchPoint): boolean {
        if (!this.lastTap) return false;

        const timeDelta = currentPoint.time - this.lastTap.time;
        const distance = Math.sqrt(
            Math.pow(currentPoint.x - this.lastTap.x, 2) +
                Math.pow(currentPoint.y - this.lastTap.y, 2)
        );

        return (
            timeDelta <= this.config.doubleTapMaxTime &&
            distance <= this.config.doubleTapMaxDistance
        );
    }

    private isTap(distance: number, duration: number): boolean {
        return (
            distance <= this.config.tapMaxDistance &&
            duration <= this.config.tapMaxTime
        );
    }

    private isSwipe(
        distance: number,
        duration: number,
        velocity: number
    ): boolean {
        return (
            distance >= this.config.minSwipeDistance &&
            duration <= this.config.maxSwipeTime &&
            velocity >= this.config.minSwipeVelocity
        );
    }

    private getSwipeDirection(
        deltaX: number,
        deltaY: number
    ): "left" | "right" | "up" | "down" {
        const absDeltaX = Math.abs(deltaX);
        const absDeltaY = Math.abs(deltaY);

        if (absDeltaX > absDeltaY) {
            // Horizontal swipe
            return deltaX > 0 ? "right" : "left";
        } else {
            // Vertical swipe
            return deltaY > 0 ? "down" : "up";
        }
    }

    private createNullGesture(): SwipeGesture {
        return {
            direction: null,
            distance: 0,
            duration: 0,
            velocity: 0,
        };
    }

    public reset(): void {
        this.startPoint = null;
        this.lastTap = null;
        this.isTracking = false;
    }
}

// React hook for swipe detection
export interface SwipeHandlers {
    onSwipeLeft: () => void;
    onSwipeRight: () => void;
    onSwipeUp: () => void;
    onSwipeDown: () => void;
    onDoubleTap: () => void;
    onTap?: () => void;
}

export function createSwipeHandlers(
    handlers: SwipeHandlers,
    config: Partial<SwipeConfig> = {}
) {
    const detector = new SwipeDetector(config);

    return {
        onTouchStart: (event: TouchEvent) => {
            detector.handleTouchStart(event);
        },
        onTouchMove: (event: TouchEvent) => {
            detector.handleTouchMove(event);
        },
        onTouchEnd: (event: TouchEvent) => {
            const gesture = detector.handleTouchEnd(event);

            switch (gesture.direction) {
                case "left":
                    handlers.onSwipeLeft();
                    break;
                case "right":
                    handlers.onSwipeRight();
                    break;
                case "up":
                    handlers.onSwipeUp();
                    break;
                case "down":
                    handlers.onSwipeDown();
                    break;
                case "doubletap":
                    handlers.onDoubleTap();
                    break;
                case "tap":
                    handlers.onTap?.();
                    break;
            }
        },
    };
}

export default SwipeDetector;
